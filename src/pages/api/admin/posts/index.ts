import type { APIContext } from 'astro';
import { getDB, queryAll, execute, queryFirst } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const prerender = false;

/**
 * GET /api/admin/posts — list all dynamic posts (draft + published)
 * POST /api/admin/posts — create new post
 */

export async function GET({ request, locals }: APIContext) {
  const env = locals.runtime.env;
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const db = getDB(locals);
  const url = new URL(request.url);
  const status = url.searchParams.get('status'); // optional filter

  let sql = `SELECT id, slug, title, description, tags, status, featured, author, source, published_at, created_at, updated_at FROM posts`;
  const params: unknown[] = [];

  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;

  const posts = await queryAll(db, sql, params);
  return new Response(JSON.stringify({ posts, count: posts.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, locals }: APIContext) {
  const env = locals.runtime.env;
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  let body: {
    slug?: string;
    title: string;
    description: string;
    body_md: string;
    tags?: string[];
    cover?: string;
    status?: 'draft' | 'published';
    featured?: boolean;
    author?: string;
    source?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!body.title || !body.description || !body.body_md) {
    return new Response(JSON.stringify({ error: 'Missing required fields: title, description, body_md' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate slug from title if not provided
  const slug = body.slug || body.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

  const db = getDB(locals);

  // Check slug uniqueness
  const existing = await queryFirst(db, `SELECT id FROM posts WHERE slug = ?`, [slug]);
  if (existing) {
    return new Response(JSON.stringify({ error: 'Slug already exists', slug }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const status = body.status || 'draft';
  const publishedAt = status === 'published' ? Date.now() : null;
  const tags = JSON.stringify(body.tags || []);

  await execute(
    db,
    `INSERT INTO posts (slug, title, description, body_md, tags, cover, status, featured, author, source, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [slug, body.title, body.description, body.body_md, tags, body.cover || null, status, body.featured ? 1 : 0, body.author || 'Basim', body.source || 'api', publishedAt]
  );

  const post = await queryFirst(db, `SELECT * FROM posts WHERE slug = ?`, [slug]);

  return new Response(JSON.stringify({ success: true, post, url: `/cerita/${slug}` }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
