import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from '../../../../src/pages/api/admin/agents/[agent_id]';
import type { APIContext } from 'astro';

// --- Mock D1 helpers ---

function createMockDb(options: {
  agent?: { agent_id: string; revoked_at: number | null } | null;
} = {}) {
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(options.agent ?? null);
  const allFn = vi.fn().mockResolvedValue({ results: [] });
  const bindFn = vi.fn().mockReturnValue({ first: firstFn, run: runFn, all: allFn });
  const prepareFn = vi.fn().mockReturnValue({ bind: bindFn });

  return {
    prepare: prepareFn,
    _bind: bindFn,
    _first: firstFn,
    _run: runFn,
  };
}

function createContext(options: {
  agentId?: string;
  adminToken?: string;
  headerToken?: string;
  db?: ReturnType<typeof createMockDb>;
}): APIContext {
  const db = options.db ?? createMockDb();
  const headers = new Headers();
  if (options.headerToken) {
    headers.set('x-admin-token', options.headerToken);
  }

  const request = new Request('http://localhost/api/admin/agents/test-agent', {
    method: 'DELETE',
    headers,
  });

  return {
    params: { agent_id: options.agentId ?? 'test-agent' },
    request,
    locals: {
      runtime: {
        env: {
          ADMIN_EMAIL: 'admin@basim.id',
          ADMIN_TOKEN: options.adminToken ?? 'admin-secret-token',
          DB: db,
        },
      },
    },
  } as unknown as APIContext;
}

describe('DELETE /api/admin/agents/[agent_id]', () => {
  describe('authentication', () => {
    it('returns 401 when no admin token provided', async () => {
      const ctx = createContext({ headerToken: undefined });
      const response = await DELETE(ctx);

      expect(response.status).toBe(401);
      const body: any = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 when wrong admin token provided', async () => {
      const ctx = createContext({
        adminToken: 'correct-token',
        headerToken: 'wrong-token',
      });
      const response = await DELETE(ctx);

      expect(response.status).toBe(401);
    });

    it('authenticates with valid admin token in header', async () => {
      const db = createMockDb({ agent: { agent_id: 'test-agent', revoked_at: null } });
      const ctx = createContext({
        adminToken: 'my-admin-token',
        headerToken: 'my-admin-token',
        db,
      });
      const response = await DELETE(ctx);

      expect(response.status).toBe(200);
    });
  });

  describe('agent not found', () => {
    it('returns 404 when agent_id does not exist', async () => {
      const db = createMockDb({ agent: null });
      const ctx = createContext({
        agentId: 'nonexistent-agent',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await DELETE(ctx);

      expect(response.status).toBe(404);
      const body: any = await response.json();
      expect(body.error).toBe('agent_not_found');
      expect(body.agent_id).toBe('nonexistent-agent');
    });
  });

  describe('already revoked', () => {
    it('returns 409 when agent is already revoked', async () => {
      const db = createMockDb({
        agent: { agent_id: 'revoked-agent', revoked_at: 1700000000000 },
      });
      const ctx = createContext({
        agentId: 'revoked-agent',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await DELETE(ctx);

      expect(response.status).toBe(409);
      const body: any = await response.json();
      expect(body.error).toBe('already_revoked');
      expect(body.agent_id).toBe('revoked-agent');
      expect(body.revoked_at).toBe(1700000000000);
    });
  });

  describe('successful revocation', () => {
    it('returns 200 with agent_id and revoked_at on success', async () => {
      const db = createMockDb({ agent: { agent_id: 'hermes', revoked_at: null } });
      const ctx = createContext({
        agentId: 'hermes',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await DELETE(ctx);

      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.success).toBe(true);
      expect(body.agent_id).toBe('hermes');
      expect(body.revoked_at).toBeTypeOf('number');
    });

    it('executes UPDATE agents SET revoked_at for soft delete', async () => {
      const db = createMockDb({ agent: { agent_id: 'openclaw', revoked_at: null } });
      const ctx = createContext({
        agentId: 'openclaw',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      await DELETE(ctx);

      // First prepare: SELECT to check agent exists
      // Second prepare: UPDATE agents SET revoked_at
      // Third prepare: INSERT agent_audit
      expect(db.prepare).toHaveBeenCalledTimes(3);

      const updateCall = db.prepare.mock.calls[1][0];
      expect(updateCall).toContain('UPDATE agents SET revoked_at');
      expect(updateCall).toContain('WHERE agent_id');
    });

    it('inserts audit log with action=revoke', async () => {
      const db = createMockDb({ agent: { agent_id: 'hermes', revoked_at: null } });
      const ctx = createContext({
        agentId: 'hermes',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      await DELETE(ctx);

      // Third prepare call is the INSERT into agent_audit
      const auditCall = db.prepare.mock.calls[2][0];
      expect(auditCall).toContain('INSERT INTO agent_audit');

      // Check the bound values include 'revoke' action and agent_id
      const bindCalls = db._bind.mock.calls[2];
      expect(bindCalls).toContain('revoke');
      expect(bindCalls).toContain('hermes');
      expect(bindCalls).toContain('admin');
    });
  });
});
