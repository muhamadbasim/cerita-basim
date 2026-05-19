import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyAgentToken, hashToken, type AgentAuthEnv } from './agent-auth';

// --- Mock D1 helpers ---

function createMockDb(options: {
  agent?: { agent_id: string; revoked_at: number | null } | null;
} = {}) {
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(options.agent ?? null);
  const bindFn = vi.fn().mockReturnValue({ first: firstFn, run: runFn });
  const prepareFn = vi.fn().mockReturnValue({ bind: bindFn });

  return {
    prepare: prepareFn,
    _bind: bindFn,
    _first: firstFn,
    _run: runFn,
  };
}

const TEST_ENV: AgentAuthEnv = {
  ADMIN_TOKEN: 'super-secret-admin-token-12345',
};

describe('agent-auth', () => {
  describe('hashToken', () => {
    it('returns a 64-char lowercase hex string', async () => {
      const hash = await hashToken('test-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic — same input produces same hash', async () => {
      const hash1 = await hashToken('my-agent-token');
      const hash2 = await hashToken('my-agent-token');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', async () => {
      const hash1 = await hashToken('token-a');
      const hash2 = await hashToken('token-b');
      expect(hash1).not.toBe(hash2);
    });

    it('hash is NOT equal to the plaintext token', async () => {
      const token = 'plaintext-token';
      const hash = await hashToken(token);
      expect(hash).not.toBe(token);
    });
  });

  describe('verifyAgentToken', () => {
    describe('backward compat with ADMIN_TOKEN', () => {
      it('accepts ADMIN_TOKEN with provided agent_id', async () => {
        const db = createMockDb();
        const result = await verifyAgentToken(
          TEST_ENV.ADMIN_TOKEN,
          'openclaw',
          db as unknown as D1Database,
          TEST_ENV
        );

        expect(result).toEqual({
          valid: true,
          agent_id: 'openclaw',
          legacy: true,
        });
        // Should NOT query the database
        expect(db.prepare).not.toHaveBeenCalled();
      });

      it('defaults to legacy-webhook when agent_id is empty', async () => {
        const db = createMockDb();
        const result = await verifyAgentToken(
          TEST_ENV.ADMIN_TOKEN,
          '',
          db as unknown as D1Database,
          TEST_ENV
        );

        expect(result).toEqual({
          valid: true,
          agent_id: 'legacy-webhook',
          legacy: true,
        });
      });
    });

    describe('token hash lookup', () => {
      it('returns valid when token hash matches a non-revoked agent', async () => {
        const token = 'valid-agent-token-abc123';
        const db = createMockDb({
          agent: { agent_id: 'hermes', revoked_at: null },
        });

        const result = await verifyAgentToken(
          token,
          'hermes',
          db as unknown as D1Database,
          TEST_ENV
        );

        expect(result).toEqual({
          valid: true,
          agent_id: 'hermes',
          legacy: false,
        });
      });

      it('returns invalid when no agent found (invalid token)', async () => {
        const db = createMockDb({ agent: null });

        const result = await verifyAgentToken(
          'unknown-token',
          'hermes',
          db as unknown as D1Database,
          TEST_ENV
        );

        expect(result).toEqual({
          valid: false,
          reason: 'invalid_or_revoked',
        });
      });

      it('returns invalid when agent_id does not match token record', async () => {
        const db = createMockDb({
          agent: { agent_id: 'openclaw', revoked_at: null },
        });

        const result = await verifyAgentToken(
          'some-token',
          'hermes', // mismatch — token belongs to openclaw
          db as unknown as D1Database,
          TEST_ENV
        );

        expect(result).toEqual({
          valid: false,
          reason: 'agent_id_mismatch',
        });
      });
    });

    describe('last_used_at update', () => {
      it('updates last_used_at on successful verification', async () => {
        const token = 'valid-token';
        const db = createMockDb({
          agent: { agent_id: 'openclaw', revoked_at: null },
        });

        await verifyAgentToken(token, 'openclaw', db as unknown as D1Database, TEST_ENV);

        // The second prepare call should be the UPDATE
        expect(db.prepare).toHaveBeenCalledTimes(2);
        const secondCall = db.prepare.mock.calls[1][0];
        expect(secondCall).toContain('UPDATE agents SET last_used_at');
      });

      it('does NOT update last_used_at on failed verification', async () => {
        const db = createMockDb({ agent: null });

        await verifyAgentToken('bad-token', 'hermes', db as unknown as D1Database, TEST_ENV);

        // Only the SELECT query, no UPDATE
        expect(db.prepare).toHaveBeenCalledTimes(1);
      });
    });

    describe('SQL query correctness', () => {
      it('queries with hashed token and checks revoked_at IS NULL', async () => {
        const db = createMockDb({ agent: null });

        await verifyAgentToken('my-token', 'agent1', db as unknown as D1Database, TEST_ENV);

        const query = db.prepare.mock.calls[0][0];
        expect(query).toContain('token_hash');
        expect(query).toContain('revoked_at IS NULL');
      });

      it('binds the SHA-256 hash of the token to the query', async () => {
        const token = 'specific-token-value';
        const expectedHash = await hashToken(token);
        const db = createMockDb({ agent: null });

        await verifyAgentToken(token, 'agent1', db as unknown as D1Database, TEST_ENV);

        expect(db._bind).toHaveBeenCalledWith(expectedHash);
      });
    });
  });
});
