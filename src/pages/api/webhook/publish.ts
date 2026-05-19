import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';

export const prerender = false;

/**
 * POST /api/webhook/publish — receive content from external agents/services
 *
 * Auth: X-Webhook-Token header must match ADMIN_TOKEN env var
 *
 * Body: {
 *   slug?: string,        // auto-generated from title if omitted
 *   title: string,
 *   description: string,
 *   body_md: string,      // markdown content
 *   tags?: string[],
 *   cover?: string,
 *   status?: "draft" | "published",  // default: "published"
 *   author?: string,      // default: "Basim"
 *   source?: string,      // e.g. "openclaw", "hermes", "zapier"
 * }
 *
 * Returns: { success, post, url }
 */
export async function POST({ request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Auth via webhook token
  const token = request.headers.get('x-webhook-token') || request.headers.get('x-admin-token');
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized', hint: 'Set X-Webhook-Token header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    slug?: string;
    title: string;
    description: string;
    body_md: string;
    tags?: string[];
    cover?: string;
    status?: 'draft' | 'published';
    author?: string;
    source?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate required fields
  if (!body.title || !body.description || !body.body_md) {
    return new Response(JSON.stringify({ error: 'Missing required fields: title, description, body_md' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.body_md.length < 50) {
    return new Response(JSON.stringify({ error: 'body_md too short (min 50 chars)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate slug
  const slug = body.slug || body.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

  const db = getDB(locals);

  // Check slug uniqueness — if exists, append timestamp
  let finalSlug = slug;
  const existing = await queryFirst(db, `SELECT id FROM posts WHERE slug = ?`, [slug]);
  if (existing) {
    finalSlug = `${slug}-${Date.now().toString(36)}`;
  }

  const status = body.status || 'published'; // webhook default = published (agent wants it live)
  const publishedAt = status === 'published' ? Date.now() : null;
  const tags = JSON.stringify(body.tags || []);
  const source = body.source || 'webhook';

  await execute(
    db,
    `INSERT INTO posts (slug, title, description, body_md, tags, cover, status, featured, author, source, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [finalSlug, body.title, body.description, body.body_md, tags, body.cover || null, status, body.author || 'Basim', source, publishedAt]
  );

  const post = await queryFirst(db, `SELECT * FROM posts WHERE slug = ?`, [finalSlug]);

  return new Response(JSON.stringify({
    success: true,
    post,
    url: `https://cerita.basim.id/cerita/${finalSlug}`,
    message: status === 'published' ? 'Post published and live.' : 'Post saved as draft.',
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
