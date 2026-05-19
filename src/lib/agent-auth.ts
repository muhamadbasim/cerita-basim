/**
 * Agent token verification for the Agent Publish feature.
 * Handles SHA-256 token hashing, lookup in `agents` table,
 * revocation check, agent_id matching, and backward compat with ADMIN_TOKEN.
 *
 * Requirements: AGP-034, AGP-035, AGP-001
 */

/** Result of agent token verification */
export interface AgentAuthResult {
  valid: boolean;
  agent_id?: string;
  legacy?: boolean;
  reason?: 'invalid_or_revoked' | 'agent_id_mismatch';
}

/** Minimal Env shape needed by agent-auth */
export interface AgentAuthEnv {
  ADMIN_TOKEN: string;
}

/**
 * Hash a token string using SHA-256, returning lowercase hex.
 * Uses the Web Crypto API available in Cloudflare Workers.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify an agent token against the agents registry.
 *
 * Flow:
 * 1. Backward compat — if token matches env.ADMIN_TOKEN, accept as legacy-webhook
 * 2. Hash incoming token with SHA-256
 * 3. Look up hash in `agents` table where revoked_at IS NULL
 * 4. Verify agent_id in payload matches the agent record
 * 5. Update last_used_at on success
 *
 * @param token - The raw bearer token from X-Agent-Token header
 * @param agentId - The agent_id from the request payload
 * @param db - D1 database binding
 * @param env - Environment with ADMIN_TOKEN
 */
export async function verifyAgentToken(
  token: string,
  agentId: string,
  db: D1Database,
  env: AgentAuthEnv
): Promise<AgentAuthResult> {
  // 1. Backward compat: if token === ADMIN_TOKEN, allow with legacy agent_id
  if (token === env.ADMIN_TOKEN) {
    return { valid: true, agent_id: agentId || 'legacy-webhook', legacy: true };
  }

  // 2. Hash incoming token
  const tokenHash = await hashToken(token);

  // 3. Lookup in agents table — only non-revoked agents
  const agent = await db
    .prepare('SELECT agent_id, revoked_at FROM agents WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(tokenHash)
    .first<{ agent_id: string; revoked_at: number | null }>();

  if (!agent) {
    return { valid: false, reason: 'invalid_or_revoked' };
  }

  // 4. Verify agent_id matches
  if (agent.agent_id !== agentId) {
    return { valid: false, reason: 'agent_id_mismatch' };
  }

  // 5. Update last_used_at on successful verification
  await db
    .prepare('UPDATE agents SET last_used_at = ? WHERE agent_id = ?')
    .bind(Date.now(), agentId)
    .run();

  return { valid: true, agent_id: agent.agent_id, legacy: false };
}
