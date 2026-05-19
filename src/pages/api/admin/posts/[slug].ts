import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const prerender = false;

/**
 * GET /api/admin/posts/:slug — get single post
 * PATCH /api/admin/posts/:slug — update post (title, body, status, etc.)
 * DELETE /api/admin/posts/:slug — delete post
 */

export async function GET({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const db = getDB(locals);
  const post = await queryFirst(db, `SELECT * FROM posts WHERE slug = ?`, [params.slug]);

  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ post }), { headers: { 'Content-Type': 'application/json' } });
}

export async function PATCH({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const db = getDB(locals);
  const existing = await queryFirst<{ id: number; status: string }>(db, `SELECT id, status FROM posts WHERE slug = ?`, [params.slug]);

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  let body: Partial<{
    title: string;
    description: string;
    body_md: string;
    tags: string[];
    cover: string;
    status: 'draft' | 'published' | 'archived';
    featured: boolean;
  }>;

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.body_md !== undefined) { updates.push('body_md = ?'); values.push(body.body_md); }
  if (body.tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(body.tags)); }
  if (body.cover !== undefined) { updates.push('cover = ?'); values.push(body.cover); }
  if (body.featured !== undefined) { updates.push('featured = ?'); values.push(body.featured ? 1 : 0); }

  if (body.status !== undefined) {
    updates.push('status = ?');
    values.push(body.status);
    // Set published_at when transitioning to published
    if (body.status === 'published' && existing.status !== 'published') {
      updates.push('published_at = ?');
      values.push(Date.now());
    }
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(params.slug);

  if (updates.length === 1) { // only updated_at
    return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await execute(db, `UPDATE posts SET ${updates.join(', ')} WHERE slug = ?`, values);

  const post = await queryFirst(db, `SELECT * FROM posts WHERE slug = ?`, [params.slug]);
  return new Response(JSON.stringify({ success: true, post }), { headers: { 'Content-Type': 'application/json' } });
}

export async function DELETE({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const db = getDB(locals);
  const existing = await queryFirst(db, `SELECT id FROM posts WHERE slug = ?`, [params.slug]);

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await execute(db, `DELETE FROM posts WHERE slug = ?`, [params.slug]);
  return new Response(JSON.stringify({ success: true, deleted: params.slug }), { headers: { 'Content-Type': 'application/json' } });
}
