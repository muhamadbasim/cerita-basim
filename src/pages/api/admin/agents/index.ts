import type { APIContext } from 'astro';
import { hashToken } from '@lib/agent-auth';

export const prerender = false;

/**
 * GET /api/admin/agents — List all registered agents with stats
 * POST /api/admin/agents — Create a new agent token
 *
 * Auth: ADMIN_TOKEN via x-admin-token header or ?admin_token= query param
 *
 * GET Response: { agents: AgentWithStats[] }
 * POST Body: { agent_id: string, display_name: string, notes?: string }
 * POST Response: { success: true, agent_id, token (plaintext, shown ONCE) }
 *
 * Requirements: AGP-030, AGP-031, AGP-032, AGP-040
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
 * GET /api/admin/agents
 * Lists all agents with their stats and trust ratio.
 */
export async function GET({ request, locals }: APIContext) {
  const env = (locals as any).runtime.env;
  const adminToken: string = env.ADMIN_TOKEN;
  const db: D1Database = env.DB;

  if (!verifyAdmin(request, adminToken)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const agents = await db
    .prepare(
      `SELECT
        a.agent_id,
        a.display_name,
        a.created_at,
        a.last_used_at,
        a.revoked_at,
        COALESCE(s.total_submitted, 0) AS total_submitted,
        COALESCE(s.total_approved, 0) AS total_approved,
        COALESCE(s.total_rejected, 0) AS total_rejected,
        COALESCE(s.total_edited_before_approve, 0) AS total_edited_before_approve
      FROM agents a
      LEFT JOIN agent_stats s ON a.agent_id = s.agent_id
      ORDER BY a.created_at DESC`
    )
    .all<{
      agent_id: string;
      display_name: string;
      created_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
      total_submitted: number;
      total_approved: number;
      total_rejected: number;
      total_edited_before_approve: number;
    }>();

  const results = (agents.results ?? []).map((agent) => ({
    agent_id: agent.agent_id,
    display_name: agent.display_name,
    created_at: agent.created_at,
    last_used_at: agent.last_used_at,
    revoked_at: agent.revoked_at,
    total_submitted: agent.total_submitted,
    total_approved: agent.total_approved,
    total_rejected: agent.total_rejected,
    total_edited_before_approve: agent.total_edited_before_approve,
    trust_ratio:
      agent.total_submitted > 0
        ? agent.total_approved / agent.total_submitted
        : 0,
  }));

  return jsonResponse(200, { agents: results });
}

/**
 * POST /api/admin/agents
 * Creates a new agent with a generated token.
 * Returns the plaintext token ONCE — it is never stored or retrievable again.
 */
export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime.env;
  const adminToken: string = env.ADMIN_TOKEN;
  const db: D1Database = env.DB;

  if (!verifyAdmin(request, adminToken)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // Parse request body
  let body: { agent_id?: string; display_name?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  // Validate required fields
  if (!body.agent_id || body.agent_id.trim().length === 0) {
    return jsonResponse(400, {
      error: 'validation_failed',
      fields: { agent_id: 'agent_id is required' },
    });
  }

  if (!body.display_name || body.display_name.trim().length === 0) {
    return jsonResponse(400, {
      error: 'validation_failed',
      fields: { display_name: 'display_name is required' },
    });
  }

  // Check if agent_id already exists
  const existing = await db
    .prepare('SELECT agent_id FROM agents WHERE agent_id = ?')
    .bind(body.agent_id)
    .first();

  if (existing) {
    return jsonResponse(409, {
      error: 'agent_already_exists',
      agent_id: body.agent_id,
    });
  }

  // Generate 32-byte random token (AGP-031)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const plaintextToken = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Compute SHA-256 hash for storage (AGP-031 — only hash stored, never plaintext)
  const tokenHash = await hashToken(plaintextToken);

  const now = Date.now();

  // INSERT into agents table (AGP-030)
  await db
    .prepare(
      `INSERT INTO agents (agent_id, display_name, token_hash, created_at, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(body.agent_id, body.display_name, tokenHash, now, body.notes || null)
    .run();

  // INSERT into agent_stats with zeroed counters (AGP-021)
  await db
    .prepare(
      `INSERT INTO agent_stats (agent_id, total_submitted, total_approved, total_rejected, total_edited_before_approve)
       VALUES (?, 0, 0, 0, 0)`
    )
    .bind(body.agent_id)
    .run();

  // INSERT agent_audit (action='create_agent') (AGP-040)
  await db
    .prepare(
      `INSERT INTO agent_audit (action, agent_id, actor, metadata, created_at)
       VALUES ('create_agent', ?, 'admin', '{}', ?)`
    )
    .bind(body.agent_id, now)
    .run();

  // Return plaintext token ONCE (AGP-032)
  return jsonResponse(201, {
    success: true,
    agent_id: body.agent_id,
    display_name: body.display_name,
    token: plaintextToken,
    created_at: now,
  });
}
