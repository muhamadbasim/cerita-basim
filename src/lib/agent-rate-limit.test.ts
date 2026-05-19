import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, checkPendingLimit } from './agent-rate-limit';

// --- KV Mock ---

function createMockKV(store: Record<string, string> = {}): KVNamespace {
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string, _opts?: any) => {
      store[key] = value;
    },
    delete: async (key: string) => {
      delete store[key];
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// --- D1 Mock ---

function createMockDB(pendingCount: number): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async () => ({ count: pendingCount }),
        run: async () => ({}),
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;
}

describe('checkRateLimit', () => {
  let kvStore: Record<string, string>;
  let kv: KVNamespace;

  beforeEach(() => {
    kvStore = {};
    kv = createMockKV(kvStore);
  });

  it('allows first request with full remaining count', async () => {
    const result = await checkRateLimit('agent-1', kv, {});
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // default limit 10, used 1
  });

  it('increments KV counter on each allowed request', async () => {
    await checkRateLimit('agent-1', kv, {});
    expect(kvStore['ratelimit:agent:agent-1']).toBe('1');

    await checkRateLimit('agent-1', kv, {});
    expect(kvStore['ratelimit:agent:agent-1']).toBe('2');
  });

  it('rejects when count reaches limit', async () => {
    kvStore['ratelimit:agent:agent-1'] = '10';
    const result = await checkRateLimit('agent-1', kv, {});
    expect(result.allowed).toBe(false);
    expect(result.retry_after).toBe(3600);
    expect(result.remaining).toBeUndefined();
  });

  it('rejects when count exceeds limit', async () => {
    kvStore['ratelimit:agent:agent-1'] = '15';
    const result = await checkRateLimit('agent-1', kv, {});
    expect(result.allowed).toBe(false);
    expect(result.retry_after).toBe(3600);
  });

  it('uses custom limit from env', async () => {
    const env = { AGENT_PUBLISH_RATE_LIMIT_PER_HOUR: '5' };
    kvStore['ratelimit:agent:agent-1'] = '4';

    const result = await checkRateLimit('agent-1', kv, env);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0); // 5 - 4 - 1 = 0

    // Next request should be rejected
    const result2 = await checkRateLimit('agent-1', kv, env);
    expect(result2.allowed).toBe(false);
  });

  it('uses numeric env value', async () => {
    const env = { AGENT_PUBLISH_RATE_LIMIT_PER_HOUR: 3 };
    kvStore['ratelimit:agent:agent-1'] = '3';

    const result = await checkRateLimit('agent-1', kv, env);
    expect(result.allowed).toBe(false);
  });

  it('defaults to 10 when env value is invalid', async () => {
    const env = { AGENT_PUBLISH_RATE_LIMIT_PER_HOUR: 'invalid' };
    kvStore['ratelimit:agent:agent-1'] = '9';

    const result = await checkRateLimit('agent-1', kv, env);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('isolates rate limits between agents', async () => {
    kvStore['ratelimit:agent:agent-1'] = '10';

    const result1 = await checkRateLimit('agent-1', kv, {});
    expect(result1.allowed).toBe(false);

    const result2 = await checkRateLimit('agent-2', kv, {});
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(9);
  });
});

describe('checkPendingLimit', () => {
  it('allows when pending count is below limit', async () => {
    const db = createMockDB(10);
    const result = await checkPendingLimit('agent-1', db, {});
    expect(result.allowed).toBe(true);
    expect(result.pending_count).toBe(10);
    expect(result.max_pending).toBe(50);
  });

  it('rejects when pending count reaches default limit (50)', async () => {
    const db = createMockDB(50);
    const result = await checkPendingLimit('agent-1', db, {});
    expect(result.allowed).toBe(false);
    expect(result.pending_count).toBe(50);
    expect(result.max_pending).toBe(50);
  });

  it('rejects when pending count exceeds limit', async () => {
    const db = createMockDB(55);
    const result = await checkPendingLimit('agent-1', db, {});
    expect(result.allowed).toBe(false);
    expect(result.pending_count).toBe(55);
  });

  it('allows when pending count is zero', async () => {
    const db = createMockDB(0);
    const result = await checkPendingLimit('agent-1', db, {});
    expect(result.allowed).toBe(true);
    expect(result.pending_count).toBe(0);
  });

  it('uses custom limit from env', async () => {
    const db = createMockDB(5);
    const env = { AGENT_PUBLISH_MAX_PENDING: '5' };
    const result = await checkPendingLimit('agent-1', db, env);
    expect(result.allowed).toBe(false);
    expect(result.max_pending).toBe(5);
  });

  it('uses numeric env value', async () => {
    const db = createMockDB(3);
    const env = { AGENT_PUBLISH_MAX_PENDING: 3 };
    const result = await checkPendingLimit('agent-1', db, env);
    expect(result.allowed).toBe(false);
    expect(result.max_pending).toBe(3);
  });

  it('defaults to 50 when env value is invalid', async () => {
    const db = createMockDB(49);
    const env = { AGENT_PUBLISH_MAX_PENDING: 'invalid' };
    const result = await checkPendingLimit('agent-1', db, env);
    expect(result.allowed).toBe(true);
    expect(result.max_pending).toBe(50);
  });

  it('allows at limit minus one', async () => {
    const db = createMockDB(49);
    const result = await checkPendingLimit('agent-1', db, {});
    expect(result.allowed).toBe(true);
    expect(result.pending_count).toBe(49);
  });
});
