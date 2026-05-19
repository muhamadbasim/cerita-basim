import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';
import { getKV } from '@/lib/kv';
import { requireAdmin } from '@/lib/access';

export const prerender = false;

// PATCH /api/admin/comments/:id
export async function PATCH({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Auth check
  const authError = await requireAdmin(request, env.ADMIN_EMAIL);
  if (authError) return authError;

  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing comment id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: { status: 'approved' | 'rejected' | 'spam' };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!['approved', 'rejected', 'spam'].includes(body.status)) {
    return new Response(JSON.stringify({ error: 'Status must be: approved, rejected, or spam' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDB(locals);

  // Get comment
  const comment = await queryFirst<{ id: number; email_hash: string; post_slug: string; status: string }>(
    db,
    `SELECT id, email_hash, post_slug, status FROM comments WHERE id = ?`,
    [id]
  );

  if (!comment) {
    return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const approvedAt = body.status === 'approved' ? Date.now() : null;

  await execute(
    db,
    `UPDATE comments SET status = ?, approved_at = ? WHERE id = ?`,
    [body.status, approvedAt, id]
  );

  // If approving, add email to trusted list
  if (body.status === 'approved') {
    // Check if already trusted
    const existing = await queryFirst(db, `SELECT email_hash FROM trusted_emails WHERE email_hash = ?`, [comment.email_hash]);
    if (!existing) {
      await execute(
        db,
        `INSERT INTO trusted_emails (email_hash, comment_id) VALUES (?, ?)`,
        [comment.email_hash, comment.id]
      );
    }

    // Invalidate comment cache for this post
    const kv = getKV(locals);
    await kv.delete(`cache:comments:${comment.post_slug}`);
  }

  return new Response(JSON.stringify({ success: true, id: comment.id, status: body.status }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
