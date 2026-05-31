import type { MiddlewareHandler } from 'astro';

/**
 * Security headers for SSR responses.
 *
 * The static `public/_headers` file only applies to static assets served
 * directly by Cloudflare Pages. SSR/HTML responses are produced by the
 * Worker and bypass `_headers`, so the same protections are applied here.
 *
 * Keep the CSP in sync with public/_headers.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://cerita.basim.id https://imagedelivery.net https://*.r2.cloudflarestorage.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();

  // Only decorate real document/data responses we own. Skip if a header was
  // already set upstream so per-route intent (e.g. redirects) is preserved.
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  const { pathname } = context.url;
  // Admin and API surfaces must never be cached or indexed.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (!response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', 'no-store');
    }
  }

  return response;
};
