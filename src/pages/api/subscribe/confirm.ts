import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';

export const prerender = false;

// GET /api/subscribe/confirm?token=...
export async function GET({ request, locals }: APIContext) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Token tidak ditemukan.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const db = getDB(locals);
  const subscriber = await queryFirst<{ id: number; status: string; created_at: number }>(
    db,
    `SELECT id, status, created_at FROM subscribers WHERE confirm_tok = ?`,
    [token]
  );

  if (!subscriber) {
    return new Response('Token tidak valid atau sudah digunakan.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  // Check expiry (7 days)
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - subscriber.created_at > sevenDays) {
    return new Response('Token sudah kedaluwarsa. Silakan subscribe ulang.', { status: 410, headers: { 'Content-Type': 'text/plain' } });
  }

  // Already active — idempotent
  if (subscriber.status === 'active') {
    return Response.redirect(new URL('/subscribe/thanks', request.url).href, 302);
  }

  // Activate
  await execute(
    db,
    `UPDATE subscribers SET status = 'active', confirmed_at = ?, confirm_tok = NULL WHERE id = ?`,
    [Date.now(), subscriber.id]
  );

  return Response.redirect(new URL('/subscribe/thanks', request.url).href, 302);
}
