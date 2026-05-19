import type { APIRoute } from 'astro';
import { ADMIN_SESSION_COOKIE } from '@/lib/access';

export const prerender = false;

/**
 * POST /api/admin/login
 *
 * Body (form-encoded or JSON): { token: string, next?: string }
 *
 * Verifies the submitted token against env.ADMIN_TOKEN. On success, sets an
 * HttpOnly Secure SameSite=Lax cookie `cb_admin` with the token value and
 * redirects to `next` (default /admin/dashboard).
 *
 * On failure, redirects back to /admin/login?error=1 (preserves `next`).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env ?? {};
  const adminToken: string | undefined = env.ADMIN_TOKEN;

  if (!adminToken) {
    return new Response(JSON.stringify({ error: 'admin_token_not_configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let token = '';
  let next = '/admin/dashboard';

  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json() as { token?: string; next?: string };
      token = (body.token || '').trim();
      next = sanitizeNext(body.next) || next;
    } else {
      const form = await request.formData();
      token = String(form.get('token') || '').trim();
      next = sanitizeNext(String(form.get('next') || '')) || next;
    }
  } catch {
    // fall through with empty token → unauthorized
  }

  if (!token || !timingSafeEqual(token, adminToken)) {
    const back = '/admin/login?error=1' + (next ? '&next=' + encodeURIComponent(next) : '');
    return new Response(null, { status: 302, headers: { Location: back } });
  }

  // Cookie is the token itself, but kept HttpOnly + Secure + SameSite=Lax so it
  // can never be read by JS and won't leak cross-site. Maxage 7 days.
  const cookie = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(adminToken)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=' + 60 * 60 * 24 * 7,
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': cookie,
    },
  });
};

function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return '';
  // Only allow same-origin paths starting with /admin to prevent open-redirect.
  if (raw.startsWith('/admin')) return raw;
  return '';
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
