import type { APIRoute } from 'astro';
import { ADMIN_SESSION_COOKIE } from '@/lib/access';

export const prerender = false;

/**
 * Clears the admin session cookie and redirects to /admin/login.
 * Accept both GET (so a plain link works) and POST.
 */
const handler: APIRoute = async () => {
  const expired = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': expired,
    },
  });
};

export const GET = handler;
export const POST = handler;
