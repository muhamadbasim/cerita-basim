import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const prerender = false;

/**
 * DELETE /api/admin/agents/:agent_id — Revoke an agent token (soft delete)
 *
 * Sets revoked_at = now() on the agent record. Once revoked, all subsequent
 * submissions using that agent's token will return HTTP 401.
 *
 * Requirements: AGP-033, AGP-040
 */
export async function DELETE({ params, request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Verify ADMIN_TOKEN
  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  const agentId = params.agent_id;
  if (!agentId) {
    return new Response(
      JSON.stringify({ error: 'missing_agent_id', message: 'Agent ID is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const db = getDB(locals);

  // Check agent exists
  const agent = await queryFirst<{ agent_id: string; revoked_at: number | null }>(
    db,
    `SELECT agent_id, revoked_at FROM agents WHERE agent_id = ?`,
    [agentId]
  );

  if (!agent) {
    return new Response(
      JSON.stringify({ error: 'agent_not_found', agent_id: agentId }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (agent.revoked_at !== null) {
    return new Response(
      JSON.stringify({ error: 'already_revoked', agent_id: agentId, revoked_at: agent.revoked_at }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = Date.now();

  // Soft delete: set revoked_at timestamp
  await execute(
    db,
    `UPDATE agents SET revoked_at = ? WHERE agent_id = ?`,
    [now, agentId]
  );

  // Audit log: record the revoke action
  await execute(
    db,
    `INSERT INTO agent_audit (action, agent_id, draft_id, slug, actor, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['revoke', agentId, null, null, 'admin', '{}', now]
  );

  return new Response(
    JSON.stringify({ success: true, agent_id: agentId, revoked_at: now }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
