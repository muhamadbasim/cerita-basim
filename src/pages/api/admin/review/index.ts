import type { APIContext } from 'astro';

export const prerender = false;

/**
 * GET /api/admin/review — List the review queue (staging drafts from agents)
 *
 * Auth: ADMIN_TOKEN via x-admin-token header or ?admin_token= query param
 *
 * Returns JSON array of pending drafts with trust badge info:
 * {
 *   drafts: Array<{
 *     slug, title, agent_id, source, body_length, warnings_count,
 *     created_at, trust_badge
 *   }>
 * }
 *
 * Requirements: AGP-010
 */

/** Verify ADMIN_TOKEN from header or query param */
function verifyAdmin(request: Request, adminToken: string): boolean {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('admin_token');
  const headerToken = request.headers.get('x-admin-token');
  return queryToken === adminToken || headerToken === adminToken;
}

/** Helper to create JSON responses */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Compute warnings count from a draft's body and tags.
 * Uses the same heuristics as agent-quality but only returns the count.
 */
function countWarnings(bodyMd: string, tagsJson: string): number {
  const TAG_WHITELIST = ['produk', 'teknis', 'karier', 'catatan', 'eksperimen'];
  const URL_REGEX = /https?:\/\/[^\s)]+/g;
  const BLACKLIST_WORDS = ['casino', 'viagra', 'crypto-pump', 'click here'];

  let count = 0;

  // Tag whitelist check
  try {
    const tags: string[] = JSON.parse(tagsJson || '[]');
    if (tags.some(t => !TAG_WHITELIST.includes(t))) {
      count++;
    }
  } catch {
    // Invalid JSON tags — count as a warning
    count++;
  }

  // Excessive URLs check (>10)
  const urlMatches = bodyMd.match(URL_REGEX) || [];
  if (urlMatches.length > 10) {
    count++;
  }

  // Blacklist words check
  const lower = bodyMd.toLowerCase();
  if (BLACKLIST_WORDS.some(w => lower.includes(w))) {
    count++;
  }

  // Repetition check (same line repeated >3 times)
  const lines = bodyMd.split('\n').filter(l => l.trim().length > 0);
  const freq = new Map<string, number>();
  for (const line of lines) {
    freq.set(line, (freq.get(line) || 0) + 1);
  }
  if ([...freq.values()].some(c => c > 3)) {
    count++;
  }

  return count;
}

export async function GET({ request, locals }: APIContext) {
  const env = (locals as any).runtime.env;
  const adminToken: string = env.ADMIN_TOKEN;
  const db: D1Database = env.DB;

  if (!verifyAdmin(request, adminToken)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // Query staging drafts (status='draft' AND source != 'manual') with agent_stats join
  // ORDER BY created_at DESC (newest first)
  const result = await db
    .prepare(
      `SELECT
        p.slug,
        p.title,
        p.source AS agent_id,
        p.source,
        p.body_md,
        p.tags,
        p.created_at,
        COALESCE(s.total_submitted, 0) AS total_submitted,
        COALESCE(s.total_approved, 0) AS total_approved
      FROM posts p
      LEFT JOIN agent_stats s ON p.source = s.agent_id
      WHERE p.status = 'draft' AND p.source != 'manual'
      ORDER BY p.created_at DESC`
    )
    .all<{
      slug: string;
      title: string;
      agent_id: string;
      source: string;
      body_md: string;
      tags: string;
      created_at: number;
      total_submitted: number;
      total_approved: number;
    }>();

  const drafts = (result.results ?? []).map((row) => {
    // Trust badge: trust_ratio ≥ 0.8 AND total_approved ≥ 3
    const trustRatio = row.total_submitted > 0
      ? row.total_approved / row.total_submitted
      : 0;
    const isTrusted = trustRatio >= 0.8 && row.total_approved >= 3;

    return {
      slug: row.slug,
      title: row.title,
      agent_id: row.agent_id,
      source: row.source,
      body_length: row.body_md.length,
      warnings_count: countWarnings(row.body_md, row.tags),
      created_at: row.created_at,
      trust_badge: isTrusted,
    };
  });

  return jsonResponse(200, { drafts });
}
