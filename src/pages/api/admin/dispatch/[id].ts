import type { APIContext } from 'astro';
import { getDB, queryFirst } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const prerender = false;

// GET /api/admin/dispatch/:id — poll dispatch progress
export async function GET({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;

  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing dispatch id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDB(locals);
  const dispatch = await queryFirst<{ id: number; post_slug: string; status: string; total: number; sent: number; failed: number; triggered_at: number }>(
    db,
    `SELECT id, post_slug, status, total, sent, failed, triggered_at FROM dispatches WHERE id = ?`,
    [id]
  );

  if (!dispatch) {
    return new Response(JSON.stringify({ error: 'Dispatch not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify(dispatch), {
    headers: { 'Content-Type': 'application/json' },
  });
}
