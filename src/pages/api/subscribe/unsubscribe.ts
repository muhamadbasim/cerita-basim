import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';

export const prerender = false;

// GET /api/subscribe/unsubscribe?token=...
export async function GET({ request, locals }: APIContext) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Token tidak ditemukan.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const db = getDB(locals);
  const subscriber = await queryFirst<{ id: number; status: string }>(
    db,
    `SELECT id, status FROM subscribers WHERE unsub_tok = ?`,
    [token]
  );

  if (!subscriber) {
    return new Response('Token tidak valid.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  // Already unsubscribed — idempotent
  if (subscriber.status === 'unsubscribed') {
    return Response.redirect(new URL('/unsubscribed', request.url).href, 302);
  }

  // Unsubscribe — one click, no confirmation needed
  await execute(
    db,
    `UPDATE subscribers SET status = 'unsubscribed', unsubed_at = ? WHERE id = ?`,
    [Date.now(), subscriber.id]
  );

  return Response.redirect(new URL('/unsubscribed', request.url).href, 302);
}
