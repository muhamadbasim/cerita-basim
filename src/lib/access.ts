/**
 * Cloudflare Access JWT verification for admin routes.
 * Validates the CF_Authorization cookie against Cloudflare's JWKS.
 *
 * Fallback: if ADMIN_TOKEN env var is set, accept query param `?admin_token=<token>`
 * as alternative auth. Useful before Cloudflare Access is set up at zero trust dashboard.
 */

const CF_ACCESS_CERTS_URL = 'https://cerita.basim.id/cdn-cgi/access/certs';

interface AccessPayload {
  email: string;
  sub: string;
  iat: number;
  exp: number;
}

export async function verifyAccessJWT(
  request: Request,
  adminEmail: string,
  adminToken?: string
): Promise<{ authenticated: boolean; email?: string; error?: string }> {
  // Fallback 1: shared admin token via query param or header (dev/pre-CF-Access)
  if (adminToken) {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('admin_token');
    const headerToken = request.headers.get('x-admin-token');
    if (queryToken === adminToken || headerToken === adminToken) {
      return { authenticated: true, email: adminEmail };
    }
  }

  // Get Cloudflare Access token from cookie or header
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/CF_Authorization=([^;]+)/);
  const token = match?.[1] || request.headers.get('cf-access-jwt-assertion');

  if (!token) {
    return { authenticated: false, error: 'no_token' };
  }

  try {
    const payload = decodeJWTPayload(token);

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
  } catch (e) {
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
 * Middleware helper: returns 401 redirect if not authenticated.
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

  return null; // Authenticated — proceed
}
