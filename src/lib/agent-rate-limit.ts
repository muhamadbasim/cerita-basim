/**
 * Rate limiting and pending draft limits for agent submissions.
 * Uses KV for hourly rate limiting and D1 for pending count.
 * Requirements: AGP-050 (rate limit per agent), AGP-052 (max pending drafts)
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  retry_after?: number;
}

export interface PendingLimitResult {
  allowed: boolean;
  pending_count: number;
  max_pending: number;
}

export interface RateLimitEnv {
  AGENT_PUBLISH_RATE_LIMIT_PER_HOUR?: string | number;
}

export interface PendingLimitEnv {
  AGENT_PUBLISH_MAX_PENDING?: string | number;
}

/**
 * Check hourly rate limit for an agent using KV.
 * Key format: `ratelimit:agent:<agent_id>` with TTL 3600s.
 *
 * @param agentId - The agent identifier
 * @param kv - Cloudflare KV namespace
 * @param env - Environment with optional AGENT_PUBLISH_RATE_LIMIT_PER_HOUR
 * @returns RateLimitResult indicating if the request is allowed
 */
export async function checkRateLimit(
  agentId: string,
  kv: KVNamespace,
  env: RateLimitEnv
): Promise<RateLimitResult> {
  const key = `ratelimit:agent:${agentId}`;
  const limit = Number(env.AGENT_PUBLISH_RATE_LIMIT_PER_HOUR) || 10;

  const raw = await kv.get(key);
  const current = raw ? parseInt(raw, 10) : 0;

  if (current >= limit) {
    // KV doesn't expose TTL remaining directly, so we estimate.
    // The key was set with expirationTtl: 3600, so worst case is 3600s.
    // In practice, the caller should use the retry_after as a hint.
    return { allowed: false, retry_after: 3600 };
  }

  // Increment counter with 1-hour TTL
  await kv.put(key, String(current + 1), { expirationTtl: 3600 });

  return { allowed: true, remaining: limit - current - 1 };
}

/**
 * Check if an agent has reached the maximum number of pending (unreviewed) drafts.
 * Counts posts with status='draft' AND source=agentId in D1.
 *
 * @param agentId - The agent identifier
 * @param db - D1 database instance
 * @param env - Environment with optional AGENT_PUBLISH_MAX_PENDING
 * @returns PendingLimitResult indicating if the agent can submit more drafts
 */
export async function checkPendingLimit(
  agentId: string,
  db: D1Database,
  env: PendingLimitEnv
): Promise<PendingLimitResult> {
  const maxPending = Number(env.AGENT_PUBLISH_MAX_PENDING) || 50;

  const result = await db
    .prepare(`SELECT COUNT(*) as count FROM posts WHERE status = 'draft' AND source = ?`)
    .bind(agentId)
    .first<{ count: number }>();

  const pendingCount = result?.count ?? 0;

  if (pendingCount >= maxPending) {
    return { allowed: false, pending_count: pendingCount, max_pending: maxPending };
  }

  return { allowed: true, pending_count: pendingCount, max_pending: maxPending };
}
