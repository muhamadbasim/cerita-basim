import type { APIContext } from 'astro';
import { getDB, queryFirst, execute } from '@/lib/db';
import { requireAdmin } from '@/lib/access';
import { renderAgentMarkdown } from '@lib/markdown-safe';

export const prerender = false;

/**
 * GET /api/admin/review/:slug — Get draft detail with rendered HTML preview
 * PATCH /api/admin/review/:slug — Approve, reject, or edit a draft
 *
 * Auth: ADMIN_TOKEN via x-admin-token header or ?admin_token= query param
 *
 * GET Response: { draft: DraftDetail, html: string, linkWarnings: string[] }
 *
 * PATCH Body: { action: 'approve' | 'reject' | 'edit', reason?: string, updates?: {...} }
 * PATCH Response varies by action:
 *   approve → 200 { success, url: /cerita/d/:slug }
 *   reject  → 200 { success, deleted: true }
 *   edit    → 200 { success, updated: true }
 *
 * Requirements: AGP-012, AGP-013, AGP-014, AGP-015, AGP-016, AGP-040, AGP-021
 */

/** Helper to create JSON responses */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface PostRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  body_md: string;
  tags: string;
  cover: string | null;
  status: string;
  source: string;
  published_at: number | null;
  created_at: number;
}

/**
 * GET /api/admin/review/:slug
 * Fetches draft by slug, renders markdown preview, returns full detail + rendered HTML.
 * Requirements: AGP-012
 */
export async function GET({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Verify ADMIN_TOKEN
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const slug = params.slug;
  if (!slug) {
    return jsonResponse(400, { error: 'missing_slug', message: 'Slug parameter is required' });
  }

  const db = getDB(locals);

  // Fetch draft by slug
  const post = await queryFirst<PostRow>(
    db,
    `SELECT id, slug, title, description, body_md, tags, cover, status, source, published_at, created_at
     FROM posts WHERE slug = ?`,
    [slug]
  );

  if (!post) {
    return jsonResponse(404, { error: 'draft_not_found', slug });
  }

  // If already published, return 409
  if (post.status === 'published') {
    return jsonResponse(409, { error: 'already_published', slug, published_at: post.published_at });
  }

  // Render markdown preview via renderAgentMarkdown
  const { html, linkWarnings } = await renderAgentMarkdown(post.body_md);

  // Parse tags from JSON string
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(post.tags || '[]');
  } catch {
    parsedTags = [];
  }

  return jsonResponse(200, {
    draft: {
      id: post.id,
      slug: post.slug,
      title: post.title,
      description: post.description,
      body_md: post.body_md,
      tags: parsedTags,
      cover: post.cover,
      status: post.status,
      source: post.source,
      published_at: post.published_at,
      created_at: post.created_at,
    },
    html,
    linkWarnings,
  });
}

/**
 * PATCH /api/admin/review/:slug
 * Approve, reject, or edit a draft.
 * Requirements: AGP-013, AGP-014, AGP-015, AGP-016, AGP-040, AGP-021
 */
export async function PATCH({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Verify ADMIN_TOKEN
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const slug = params.slug;
  if (!slug) {
    return jsonResponse(400, { error: 'missing_slug', message: 'Slug parameter is required' });
  }

  // Parse request body
  let body: {
    action?: string;
    reason?: string;
    updates?: {
      title?: string;
      description?: string;
      body_md?: string;
      tags?: string[];
    };
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { action, reason, updates } = body;

  if (!action || !['approve', 'reject', 'edit'].includes(action)) {
    return jsonResponse(400, {
      error: 'invalid_action',
      message: "action must be 'approve', 'reject', or 'edit'",
    });
  }

  const db = getDB(locals);

  // Fetch the post to verify it exists and is a draft
  const post = await queryFirst<PostRow>(
    db,
    `SELECT id, slug, title, description, body_md, tags, cover, status, source, published_at, created_at
     FROM posts WHERE slug = ?`,
    [slug]
  );

  if (!post) {
    return jsonResponse(404, { error: 'draft_not_found', slug });
  }

  if (post.status === 'published') {
    return jsonResponse(409, { error: 'already_published', slug, published_at: post.published_at });
  }

  const now = Date.now();

  if (action === 'approve') {
    // AGP-013: UPDATE posts SET status='published', published_at=now()
    await execute(
      db,
      `UPDATE posts SET status = 'published', published_at = ? WHERE slug = ?`,
      [now, slug]
    );

    // AGP-040: INSERT agent_audit (action='approve')
    await execute(
      db,
      `INSERT INTO agent_audit (action, agent_id, draft_id, slug, actor, metadata, created_at)
       VALUES ('approve', ?, ?, ?, 'admin', '{}', ?)`,
      [post.source, post.id, slug, now]
    );

    // AGP-021: UPDATE agent_stats (total_approved += 1, last_approve_at)
    await execute(
      db,
      `UPDATE agent_stats SET total_approved = total_approved + 1, last_approve_at = ? WHERE agent_id = ?`,
      [now, post.source]
    );

    return jsonResponse(200, {
      success: true,
      action: 'approve',
      url: `/cerita/d/${slug}`,
    });
  }

  if (action === 'reject') {
    // AGP-015: DELETE from posts (hard delete)
    await execute(db, `DELETE FROM posts WHERE slug = ?`, [slug]);

    // AGP-040: INSERT agent_audit (action='reject')
    const metadata = reason ? JSON.stringify({ reason }) : '{}';
    await execute(
      db,
      `INSERT INTO agent_audit (action, agent_id, draft_id, slug, actor, metadata, created_at)
       VALUES ('reject', ?, ?, ?, 'admin', ?, ?)`,
      [post.source, post.id, slug, metadata, now]
    );

    // AGP-021: UPDATE agent_stats (total_rejected += 1)
    await execute(
      db,
      `UPDATE agent_stats SET total_rejected = total_rejected + 1 WHERE agent_id = ?`,
      [post.source]
    );

    return jsonResponse(200, {
      success: true,
      action: 'reject',
      deleted: true,
    });
  }

  // action === 'edit'
  if (!updates || Object.keys(updates).length === 0) {
    return jsonResponse(400, {
      error: 'missing_updates',
      message: "action 'edit' requires an 'updates' object with at least one field",
    });
  }

  // AGP-014: UPDATE posts with provided fields
  const setClauses: string[] = [];
  const bindValues: unknown[] = [];

  if (updates.title !== undefined) {
    setClauses.push('title = ?');
    bindValues.push(updates.title);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    bindValues.push(updates.description);
  }
  if (updates.body_md !== undefined) {
    setClauses.push('body_md = ?');
    bindValues.push(updates.body_md);
  }
  if (updates.tags !== undefined) {
    setClauses.push('tags = ?');
    bindValues.push(JSON.stringify(updates.tags));
  }

  if (setClauses.length === 0) {
    return jsonResponse(400, {
      error: 'missing_updates',
      message: 'No valid fields provided in updates',
    });
  }

  bindValues.push(slug);
  await execute(
    db,
    `UPDATE posts SET ${setClauses.join(', ')} WHERE slug = ?`,
    bindValues
  );

  // AGP-040: INSERT agent_audit (action='edit')
  const editMetadata = JSON.stringify({ fields: Object.keys(updates) });
  await execute(
    db,
    `INSERT INTO agent_audit (action, agent_id, draft_id, slug, actor, metadata, created_at)
     VALUES ('edit', ?, ?, ?, 'admin', ?, ?)`,
    [post.source, post.id, slug, editMetadata, now]
  );

  // AGP-021: UPDATE agent_stats (total_edited_before_approve += 1)
  await execute(
    db,
    `UPDATE agent_stats SET total_edited_before_approve = total_edited_before_approve + 1 WHERE agent_id = ?`,
    [post.source]
  );

  return jsonResponse(200, {
    success: true,
    action: 'edit',
    updated: true,
  });
}
