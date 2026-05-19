/**
 * Property-based tests for agent-auth module.
 *
 * Uses fast-check to verify universal properties of token verification,
 * hash security, and revocation behavior.
 *
 * **Validates: Requirements AGP-001, AGP-034, AGP-035**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { verifyAgentToken, hashToken, type AgentAuthEnv } from './agent-auth';

// --- Test helpers ---

const TEST_ENV: AgentAuthEnv = {
  ADMIN_TOKEN: 'admin-token-for-property-tests-xyz789',
};

/**
 * Creates a mock D1Database that simulates the agents table lookup.
 * The `agents` map holds agent_id → { token_hash, revoked_at } records.
 */
function createMockDbWithAgents(
  agents: Map<string, { token_hash: string; revoked_at: number | null }>
) {
  const runFn = vi.fn().mockResolvedValue({ success: true });

  const prepareFn = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('SELECT')) {
      return {
        bind: (hash: string) => ({
          first: async () => {
            for (const [agentId, record] of agents.entries()) {
              if (record.token_hash === hash && record.revoked_at === null) {
                return { agent_id: agentId, revoked_at: null };
              }
            }
            return null;
          },
        }),
      };
    }
    // UPDATE last_used_at
    return {
      bind: (..._args: unknown[]) => ({ run: runFn }),
    };
  });

  return { prepare: prepareFn } as unknown as D1Database;
}

// --- Arbitraries ---

/** Generates non-empty token strings (simulating 32-byte hex tokens) */
const arbToken = fc.stringMatching(/^[a-f0-9]{16,64}$/);

/** Generates non-empty agent_id strings */
const arbAgentId = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,29}$/);

// ============================================================
// Property 1: Token verification correctness
// ============================================================

describe('Property 1: Token verification correctness', () => {
  /**
   * **Validates: Requirements AGP-001, AGP-034**
   *
   * For any valid hash + non-revoked + matching agent_id → accept;
   * all other combos → reject.
   */

  it('accepts when token hash exists, not revoked, and agent_id matches', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbAgentId, async (token, agentId) => {
        // Pre-compute the hash and register the agent
        const tokenHash = await hashToken(token);
        const agents = new Map([[agentId, { token_hash: tokenHash, revoked_at: null }]]);
        const db = createMockDbWithAgents(agents);

        // Ensure token is not the ADMIN_TOKEN (that's a different path)
        fc.pre(token !== TEST_ENV.ADMIN_TOKEN);

        const result = await verifyAgentToken(token, agentId, db, TEST_ENV);

        expect(result.valid).toBe(true);
        expect(result.agent_id).toBe(agentId);
        expect(result.legacy).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects when token hash does not exist in agents table', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbAgentId, async (token, agentId) => {
        // Empty agents table — no matching hash
        const agents = new Map<string, { token_hash: string; revoked_at: number | null }>();
        const db = createMockDbWithAgents(agents);

        fc.pre(token !== TEST_ENV.ADMIN_TOKEN);

        const result = await verifyAgentToken(token, agentId, db, TEST_ENV);

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('invalid_or_revoked');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects when agent_id does not match the token record', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbAgentId, arbAgentId, async (token, registeredId, requestedId) => {
        // Ensure the IDs are different
        fc.pre(registeredId !== requestedId);
        fc.pre(token !== TEST_ENV.ADMIN_TOKEN);

        const tokenHash = await hashToken(token);
        const agents = new Map([[registeredId, { token_hash: tokenHash, revoked_at: null }]]);
        const db = createMockDbWithAgents(agents);

        const result = await verifyAgentToken(token, requestedId, db, TEST_ENV);

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('agent_id_mismatch');
      }),
      { numRuns: 100 }
    );
  });

  it('accepts ADMIN_TOKEN with any agent_id (backward compat)', async () => {
    await fc.assert(
      fc.asyncProperty(arbAgentId, async (agentId) => {
        const agents = new Map<string, { token_hash: string; revoked_at: number | null }>();
        const db = createMockDbWithAgents(agents);

        const result = await verifyAgentToken(TEST_ENV.ADMIN_TOKEN, agentId, db, TEST_ENV);

        expect(result.valid).toBe(true);
        expect(result.agent_id).toBe(agentId);
        expect(result.legacy).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('ADMIN_TOKEN with empty agent_id defaults to legacy-webhook', async () => {
    const agents = new Map<string, { token_hash: string; revoked_at: number | null }>();
    const db = createMockDbWithAgents(agents);

    const result = await verifyAgentToken(TEST_ENV.ADMIN_TOKEN, '', db, TEST_ENV);

    expect(result.valid).toBe(true);
    expect(result.agent_id).toBe('legacy-webhook');
    expect(result.legacy).toBe(true);
  });
});

// ============================================================
// Property 8: Token hash security
// ============================================================

describe('Property 8: Token hash security — no plaintext at rest', () => {
  /**
   * **Validates: Requirements AGP-034**
   *
   * For any token, the stored hash ≠ plaintext, and SHA256(plaintext) == hash (deterministic).
   */

  it('hash is never equal to the plaintext token', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, async (token) => {
        const hash = await hashToken(token);
        expect(hash).not.toBe(token);
      }),
      { numRuns: 100 }
    );
  });

  it('hashing is deterministic — same token always produces same hash', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, async (token) => {
        const hash1 = await hashToken(token);
        const hash2 = await hashToken(token);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 100 }
    );
  });

  it('hash is always a 64-character lowercase hex string (SHA-256)', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, async (token) => {
        const hash = await hashToken(token);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('different tokens produce different hashes (collision resistance)', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbToken, async (token1, token2) => {
        fc.pre(token1 !== token2);
        const hash1 = await hashToken(token1);
        const hash2 = await hashToken(token2);
        expect(hash1).not.toBe(hash2);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 9: Revoke blocks access
// ============================================================

describe('Property 9: Revoke blocks all subsequent access', () => {
  /**
   * **Validates: Requirements AGP-035**
   *
   * For any agent with revoked_at non-null, all submissions using that
   * agent's token shall return invalid (equivalent to HTTP 401).
   */

  it('revoked agent token is always rejected regardless of valid hash and agent_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbToken,
        arbAgentId,
        fc.integer({ min: 1, max: 2000000000000 }),
        async (token, agentId, revokedTimestamp) => {
          fc.pre(token !== TEST_ENV.ADMIN_TOKEN);

          const tokenHash = await hashToken(token);
          // Agent exists but is revoked — revoked_at is non-null
          const agents = new Map([
            [agentId, { token_hash: tokenHash, revoked_at: revokedTimestamp }],
          ]);
          const db = createMockDbWithAgents(agents);

          const result = await verifyAgentToken(token, agentId, db, TEST_ENV);

          // The DB mock filters out revoked agents (revoked_at !== null won't match),
          // so the result should be invalid
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('invalid_or_revoked');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('same token works before revocation but fails after', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbToken,
        arbAgentId,
        fc.integer({ min: 1, max: 2000000000000 }),
        async (token, agentId, revokedTimestamp) => {
          fc.pre(token !== TEST_ENV.ADMIN_TOKEN);

          const tokenHash = await hashToken(token);

          // Before revocation: agent is active
          const agentsBefore = new Map([
            [agentId, { token_hash: tokenHash, revoked_at: null }],
          ]);
          const dbBefore = createMockDbWithAgents(agentsBefore);
          const resultBefore = await verifyAgentToken(token, agentId, dbBefore, TEST_ENV);
          expect(resultBefore.valid).toBe(true);

          // After revocation: same agent, now revoked
          const agentsAfter = new Map([
            [agentId, { token_hash: tokenHash, revoked_at: revokedTimestamp }],
          ]);
          const dbAfter = createMockDbWithAgents(agentsAfter);
          const resultAfter = await verifyAgentToken(token, agentId, dbAfter, TEST_ENV);
          expect(resultAfter.valid).toBe(false);
          expect(resultAfter.reason).toBe('invalid_or_revoked');
        }
      ),
      { numRuns: 100 }
    );
  });
});
