import type { APIContext } from 'astro';
import { verifyAgentToken } from '@lib/agent-auth';
import { checkRateLimit, checkPendingLimit } from '@lib/agent-rate-limit';
import { runQualityChecks } from '@lib/agent-quality';

export const prerender = false;

/**
 * POST /api/agent/drafts — Agent submits a draft for review
 *
 * Auth: X-Agent-Token header (agent token or ADMIN_TOKEN for backward compat)
 *
 * Body: {
 *   title: string,         // non-empty, ≤200 char
 *   description: string,   // non-empty, ≤500 char
 *   body_md: string,       // ≥100 char, ≤50,000 char
 *   agent_id: string,      // non-empty, must match token record
 *   slug?: string,         // optional, auto-generated from title if omitted
 *   tags?: string[],       // optional, from whitelist
 *   cover?: string,        // optional URL
 * }
 *
 * Headers:
 *   X-Agent-Token: <token>       (required)
 *   Idempotency-Key: <key>       (optional, caches response for 24h)
 *
 * Returns: 201 { success, draft_id, slug, review_url, status: 'draft', warnings? }
 *
 * Requirements: AGP-001, AGP-002, AGP-003, AGP-004, AGP-005, AGP-006, AGP-050, AGP-051, AGP-052
 */
export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime.env;
  const db: D1Database = env.DB;
  const kv: KVNamespace = env.KV;

  // Extract auth token
  const token = request.headers.get('x-agent-token');
  if (!token) {
    return jsonResponse(401, { error: 'unauthorized', hint: 'Set X-Agent-Token header' });
  }

  // Parse JSON body
  let body: {
    title?: string;
    description?: string;
    body_md?: string;
    agent_id?: string;
    slug?: string;
    tags?: string[];
    cover?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  // Verify agent token (AGP-001, AGP-034, AGP-035)
  const agentId = body.agent_id || '';
  const authResult = await verifyAgentToken(token, agentId, db, env);
  if (!authResult.valid) {
    return jsonResponse(401, { error: 'unauthorized', reason: authResult.reason });
  }

  const verifiedAgentId = authResult.agent_id!;

  // Check idempotency key — return cached response if exists (AGP-051)
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) {
    const cacheKey = `idempotency:${verifiedAgentId}:${idempotencyKey}`;
    const cached = await kv.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Check rate limit (AGP-050)
  const rateResult = await checkRateLimit(verifiedAgentId, kv, env);
  if (!rateResult.allowed) {
    return jsonResponse(429, {
      error: 'rate_limited',
      retry_after: rateResult.retry_after,
    });
  }

  // Check pending limit (AGP-052)
  const pendingResult = await checkPendingLimit(verifiedAgentId, db, env);
  if (!pendingResult.allowed) {
    return jsonResponse(429, {
      error: 'pending_limit_reached',
      pending_count: pendingResult.pending_count,
    });
  }

  // Validate required fields (AGP-002)
  const fieldErrors: Record<string, string> = {};

  if (!body.title || body.title.trim().length === 0) {
    fieldErrors.title = 'Title is required';
  } else if (body.title.length > 200) {
    fieldErrors.title = 'Title must be ≤200 characters';
  }

  if (!body.description || body.description.trim().length === 0) {
    fieldErrors.description = 'Description is required';
  } else if (body.description.length > 500) {
    fieldErrors.description = 'Description must be ≤500 characters';
  }

  if (!body.body_md || body.body_md.length < 100) {
    fieldErrors.body_md = 'Body must be ≥100 characters';
  } else if (body.body_md.length > 50000) {
    fieldErrors.body_md = 'Body must be ≤50,000 characters';
  }

  if (!body.agent_id || body.agent_id.trim().length === 0) {
    fieldErrors.agent_id = 'agent_id is required';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return jsonResponse(400, { error: 'validation_failed', fields: fieldErrors });
  }

  // Generate slug from title (AGP-003)
  const baseSlug = (body.slug || body.title!)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  // Ensure slug is not empty after sanitization
  const slugCandidate = baseSlug || `draft-${Date.now().toString(36)}`;

  // Check slug uniqueness — on collision append timestamp36
  let finalSlug = slugCandidate;
  const existing = await db
    .prepare('SELECT id FROM posts WHERE slug = ?')
    .bind(slugCandidate)
    .first();
  if (existing) {
    finalSlug = `${slugCandidate.slice(0, 80 - 1 - Date.now().toString(36).length)}-${Date.now().toString(36)}`;
  }

  // Run quality checks (AGP-005) — non-blocking warnings
  const warnings = runQualityChecks({
    title: body.title!,
    description: body.description!,
    body_md: body.body_md!,
    agent_id: verifiedAgentId,
    slug: finalSlug,
    tags: body.tags,
    cover: body.cover,
  });

  // INSERT into posts with status='draft' (AGP-004)
  const tags = JSON.stringify(body.tags || []);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO posts (slug, title, description, body_md, tags, cover, status, source, published_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL)`
    )
    .bind(finalSlug, body.title!, body.description!, body.body_md!, tags, body.cover || null, verifiedAgentId)
    .run();

  // Get the inserted draft ID
  const inserted = await db
    .prepare('SELECT id FROM posts WHERE slug = ?')
    .bind(finalSlug)
    .first<{ id: number }>();

  const draftId = inserted?.id ?? 0;

  // INSERT into agent_audit (action='submit') (AGP-040)
  await db
    .prepare(
      `INSERT INTO agent_audit (action, agent_id, draft_id, slug, actor, metadata, created_at)
       VALUES ('submit', ?, ?, ?, ?, '{}', ?)`
    )
    .bind(verifiedAgentId, draftId, finalSlug, `agent:${verifiedAgentId}`, now)
    .run();

  // UPDATE agent_stats (total_submitted += 1, last_submit_at) (AGP-021)
  await db
    .prepare(
      `INSERT INTO agent_stats (agent_id, total_submitted, last_submit_at)
       VALUES (?, 1, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         total_submitted = total_submitted + 1,
         last_submit_at = ?`
    )
    .bind(verifiedAgentId, now, now)
    .run();

  // Build response (AGP-006)
  const responseBody: Record<string, unknown> = {
    success: true,
    draft_id: draftId,
    slug: finalSlug,
    review_url: `/admin/review/${finalSlug}`,
    status: 'draft',
  };

  if (warnings.length > 0) {
    responseBody.warnings = warnings;
  }

  const responseJson = JSON.stringify(responseBody);

  // Cache response for idempotency (AGP-051)
  if (idempotencyKey) {
    const cacheKey = `idempotency:${verifiedAgentId}:${idempotencyKey}`;
    await kv.put(cacheKey, responseJson, { expirationTtl: 86400 }); // 24h
  }

  return new Response(responseJson, {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Helper to create JSON responses */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
