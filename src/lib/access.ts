/**
 * Admin authentication for /admin/* routes.
 *
 * Three accepted methods (in order of preference):
 * 1. Session cookie `cb_admin` set by /api/admin/login (recommended for browser)
 * 2. Cloudflare Access JWT cookie `CF_Authorization` (if Zero Trust is configured)
 * 3. Shared admin token via `?admin_token=` query param or `x-admin-token` header
 *    (legacy/dev — token is matched against env.ADMIN_TOKEN)
 */

const SESSION_COOKIE = 'cb_admin';

interface AccessPayload {
  email: string;
  sub: string;
  iat: number;
  exp: number;
}

function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match?.[1];
}

/**
 * Constant-time string compare to avoid timing leaks on token check.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyAccessJWT(
  request: Request,
  adminEmail: string,
  adminToken?: string
): Promise<{ authenticated: boolean; email?: string; error?: string }> {
  // 1. Session cookie set by /api/admin/login (token-derived)
  if (adminToken) {
    const sessionCookie = getCookie(request, SESSION_COOKIE);
    if (sessionCookie && safeEqual(sessionCookie, adminToken)) {
      return { authenticated: true, email: adminEmail };
    }
  }

  // 2. Shared admin token via query param or header
  if (adminToken) {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('admin_token');
    const headerToken = request.headers.get('x-admin-token');
    if ((queryToken && safeEqual(queryToken, adminToken)) ||
        (headerToken && safeEqual(headerToken, adminToken))) {
      return { authenticated: true, email: adminEmail };
    }
  }

  // 3. Cloudflare Access JWT cookie (if Zero Trust is set up)
  const cfToken = getCookie(request, 'CF_Authorization') || request.headers.get('cf-access-jwt-assertion');

  if (!cfToken) {
    return { authenticated: false, error: 'no_token' };
  }

  try {
    const payload = decodeJWTPayload(cfToken);

    if (!payload || !payload.email) {
      return { authenticated: false, error: 'invalid_payload' };
    }

    if (payload.exp && payload.exp < Date.now() / 1000) {
      return { authenticated: false, error: 'token_expired' };
    }

    if (payload.email.toLowerCase() !== adminEmail.toLowerCase()) {
      return { authenticated: false, error: 'unauthorized_email' };
    }

    return { authenticated: true, email: payload.email };
  } catch {
    return { authenticated: false, error: 'verification_failed' };
  }
}

function decodeJWTPayload(token: string): AccessPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload as AccessPayload;
  } catch {
    return null;
  }
}

/**
 * Middleware helper for API endpoints: returns JSON 401 if not authenticated, null if OK.
 * Use for /api/admin/* — clients are programmatic, JSON makes sense.
 */
export async function requireAdmin(
  request: Request,
  adminEmail: string,
  adminToken?: string
): Promise<Response | null> {
  const result = await verifyAccessJWT(request, adminEmail, adminToken);

  if (!result.authenticated) {
    return new Response(JSON.stringify({ error: 'unauthorized', detail: result.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

/**
 * Middleware helper for Astro pages: returns 302 redirect to /admin/login if not
 * authenticated, null if OK. Use for /admin/* HTML pages so the user gets a real
 * login form instead of a JSON blob.
 */
export async function requireAdminPage(
  request: Request,
  adminEmail: string,
  adminToken?: string
): Promise<Response | null> {
  const result = await verifyAccessJWT(request, adminEmail, adminToken);

  if (!result.authenticated) {
    const url = new URL(request.url);
    const next = url.pathname + url.search;
    const loginUrl = '/admin/login?next=' + encodeURIComponent(next);
    return new Response(null, {
      status: 302,
      headers: { Location: loginUrl },
    });
  }

  return null;
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
