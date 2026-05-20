import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { POST } from '../../../src/pages/api/agent/drafts';
import type { APIContext } from 'astro';

/**
 * Property-based tests for POST /api/agent/drafts endpoint.
 *
 * **Validates: Requirements AGP-002, AGP-003, AGP-004, AGP-050, AGP-051, AGP-052**
 */

// --- Mock helpers ---

function createMockKV(store: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => { store[key] = value; }),
    delete: vi.fn(async () => {}),
  } as unknown as KVNamespace;
}

function createMockDB(options: {
  existingSlug?: boolean;
  pendingCount?: number;
  insertedId?: number;
} = {}) {
  const {
    existingSlug = false,
    pendingCount = 0,
    insertedId = 42,
  } = options;

  let slugCheckCount = 0;

  const prepare = vi.fn((sql: string) => {
    const stmt = {
      bind: vi.fn((..._args: unknown[]) => stmt),
      first: vi.fn(async () => {
        if (sql.includes('FROM agents WHERE')) {
          // Not reached when using ADMIN_TOKEN
          return null;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: pendingCount };
        }
        if (sql.includes('SELECT id FROM posts WHERE slug')) {
          slugCheckCount++;
          if (existingSlug && slugCheckCount === 1) {
            return { id: 1 };
          }
          if (slugCheckCount === 1) {
            return null;
          }
          return { id: insertedId };
        }
        return null;
      }),
      run: vi.fn(async () => ({ success: true })),
      all: vi.fn(async () => ({ results: [] })),
    };
    return stmt;
  });

  return { prepare } as unknown as D1Database;
}

function createContext(options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  db?: D1Database;
  kv?: KVNamespace;
  env?: Record<string, unknown>;
}): APIContext {
  const {
    body = {},
    headers = {},
    db,
    kv,
    env: envOverrides = {},
  } = options;

  const mockDB = db || createMockDB();
  const mockKV = kv || createMockKV();

  const request = new Request('http://localhost/api/agent/drafts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return {
    request,
    locals: {
      runtime: {
        env: {
          DB: mockDB,
          KV: mockKV,
          ADMIN_TOKEN: 'admin-secret-token',
          ...envOverrides,
        },
      },
    },
  } as unknown as APIContext;
}

// --- Property Tests ---

describe('Property 2: Field validation rejects invalid input', () => {
  it('empty or missing title → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', '   '),
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 100, maxLength: 300 }),
        async (title, description, body_md) => {
          const ctx = createContext({
            body: { title, description, body_md, agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.error).toBe('validation_failed');
          expect(json.fields.title).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('title >200 chars → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 201, max: 400 }),
        async (titleLen) => {
          const title = 'X'.repeat(titleLen);
          const ctx = createContext({
            body: { title, description: 'Valid desc', body_md: 'A'.repeat(150), agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.fields.title).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty or missing description → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', '   '),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 100, maxLength: 300 }),
        async (description, title, body_md) => {
          const ctx = createContext({
            body: { title, description, body_md, agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.error).toBe('validation_failed');
          expect(json.fields.description).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('description >500 chars → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 501, max: 700 }),
        async (descLen) => {
          const description = 'X'.repeat(descLen);
          const ctx = createContext({
            body: { title: 'Valid Title', description, body_md: 'A'.repeat(150), agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.fields.description).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('body_md <100 chars → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99 }),
        async (bodyLen) => {
          const body_md = 'X'.repeat(bodyLen);
          const ctx = createContext({
            body: { title: 'Valid Title', description: 'Valid desc', body_md, agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.fields.body_md).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('body_md >50000 chars → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50001, max: 50100 }),
        async (bodyLen) => {
          const body_md = 'X'.repeat(bodyLen);
          const ctx = createContext({
            body: { title: 'Valid Title', description: 'Valid desc', body_md, agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.fields.body_md).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty agent_id → 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', '   '),
        async (agent_id) => {
          const ctx = createContext({
            body: { title: 'Valid Title', description: 'Valid desc', body_md: 'A'.repeat(150), agent_id },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(400);
          const json: any = await res.json();
          expect(json.fields.agent_id).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all valid fields → passes validation (not 400)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), minLength: 1, maxLength: 200 }),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), minLength: 1, maxLength: 500 }),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), minLength: 100, maxLength: 300 }),
        async (title, description, body_md) => {
          // Ensure non-empty after trim
          fc.pre(title.trim().length > 0);
          fc.pre(description.trim().length > 0);

          const ctx = createContext({
            body: { title, description, body_md, agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).not.toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Property 3: Slug generation determinism and uniqueness', () => {
  it('any title → slug is lowercase [a-z0-9-] and ≤80 chars', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 -ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
          minLength: 1,
          maxLength: 100,
        }),
        async (title) => {
          // Ensure title has at least one alphanumeric char for slug generation
          fc.pre(/[a-z0-9]/i.test(title));

          const ctx = createContext({
            body: {
              title,
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
          });
          const res = await POST(ctx);
          expect(res.status).toBe(201);
          const json: any = await res.json();

          // Slug must be lowercase, only [a-z0-9-], ≤80 chars
          expect(json.slug).toMatch(/^[a-z0-9-]+$/);
          expect(json.slug.length).toBeLessThanOrEqual(80);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('slug collisions produce distinct slugs via timestamp suffix', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')),
          minLength: 1,
          maxLength: 50,
        }),
        async (title) => {
          fc.pre(/[a-z0-9]/.test(title));

          // DB mock that reports slug collision on first check
          const db = createMockDB({ existingSlug: true });
          const ctx = createContext({
            body: {
              title,
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            db,
          });
          const res = await POST(ctx);
          expect(res.status).toBe(201);
          const json: any = await res.json();

          // Slug should have a timestamp suffix (base36 chars appended)
          expect(json.slug).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);
          expect(json.slug.length).toBeLessThanOrEqual(80);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 4: Draft invariants on submission', () => {
  it('successful insert → status=draft, published_at=NULL, source=agent_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
          minLength: 1,
          maxLength: 100,
        }),
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
          minLength: 1,
          maxLength: 200,
        }),
        async (title, description) => {
          fc.pre(title.trim().length > 0);
          fc.pre(description.trim().length > 0);

          const db = createMockDB();
          const ctx = createContext({
            body: { title, description, body_md: 'A'.repeat(150), agent_id: 'test-agent' },
            headers: { 'x-agent-token': 'admin-secret-token' },
            db,
          });
          const res = await POST(ctx);
          expect(res.status).toBe(201);
          const json: any = await res.json();

          // Response confirms draft status
          expect(json.status).toBe('draft');
          expect(json.success).toBe(true);

          // Verify the INSERT SQL was called with correct values
          const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
          const insertCall = prepareCalls.find(
            (call: string[]) => call[0].includes('INSERT INTO posts')
          );
          expect(insertCall).toBeDefined();

          // The INSERT statement includes 'draft' and NULL for published_at
          expect(insertCall![0]).toContain("'draft'");
          expect(insertCall![0]).toContain('NULL');

          // Verify source (agent_id) was bound
          const insertIdx = prepareCalls.findIndex(
            (call: string[]) => call[0].includes('INSERT INTO posts')
          );
          const insertStmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results[insertIdx];
          const bindCalls = insertStmt.value.bind.mock.calls;
          // source is the 7th bind param in the INSERT (slug, title, desc, body, tags, cover, source)
          expect(bindCalls[0]).toContain('test-agent');
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 11: Rate limit enforcement', () => {
  it('N ≥ limit (10) → 429 rate_limited', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        async (count) => {
          const kvStore: Record<string, string> = {
            'ratelimit:agent:test-agent': String(count),
          };
          const kv = createMockKV(kvStore);
          const ctx = createContext({
            body: {
              title: 'Rate Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            kv,
          });
          const res = await POST(ctx);
          expect(res.status).toBe(429);
          const json: any = await res.json();
          expect(json.error).toBe('rate_limited');
          expect(json.retry_after).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('N < limit (10) → allowed (not 429)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 9 }),
        async (count) => {
          const kvStore: Record<string, string> = {
            'ratelimit:agent:test-agent': String(count),
          };
          const kv = createMockKV(kvStore);
          const ctx = createContext({
            body: {
              title: 'Rate Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            kv,
          });
          const res = await POST(ctx);
          expect(res.status).not.toBe(429);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('custom rate limit respected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 100 }),
        async (limit, count) => {
          const kvStore: Record<string, string> = {
            'ratelimit:agent:test-agent': String(count),
          };
          const kv = createMockKV(kvStore);
          const ctx = createContext({
            body: {
              title: 'Rate Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            kv,
            env: { AGENT_PUBLISH_RATE_LIMIT_PER_HOUR: limit },
          });
          const res = await POST(ctx);

          if (count >= limit) {
            expect(res.status).toBe(429);
            const json: any = await res.json();
            expect(json.error).toBe('rate_limited');
          } else {
            expect(res.status).not.toBe(429);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 12: Idempotency key prevents duplicates', () => {
  it('same key → same response, no duplicate row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
          minLength: 1,
          maxLength: 50,
        }),
        async (idempotencyKey) => {
          // First submission: no cached response
          const kvStore: Record<string, string> = {};
          const kv = createMockKV(kvStore);
          const body = {
            title: 'Idempotent Draft',
            description: 'Valid description',
            body_md: 'A'.repeat(150),
            agent_id: 'test-agent',
          };

          const ctx1 = createContext({
            body,
            headers: {
              'x-agent-token': 'admin-secret-token',
              'idempotency-key': idempotencyKey,
            },
            kv,
          });
          const res1 = await POST(ctx1);
          expect(res1.status).toBe(201);
          const json1: any = await res1.json();

          // Verify KV was called to cache the response
          const cacheKey = `idempotency:test-agent:${idempotencyKey}`;
          expect(kvStore[cacheKey]).toBeDefined();

          // Second submission: cached response exists in KV
          const kv2 = createMockKV(kvStore);
          const db2 = createMockDB();
          const ctx2 = createContext({
            body,
            headers: {
              'x-agent-token': 'admin-secret-token',
              'idempotency-key': idempotencyKey,
            },
            kv: kv2,
            db: db2,
          });
          const res2 = await POST(ctx2);
          expect(res2.status).toBe(201);
          const json2: any = await res2.json();

          // Same response returned
          expect(json2.draft_id).toBe(json1.draft_id);
          expect(json2.slug).toBe(json1.slug);

          // DB INSERT should NOT have been called for the second request
          const insertCalls = (db2.prepare as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: string[]) => call[0].includes('INSERT INTO posts')
          );
          expect(insertCalls.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 13: Pending limit cap', () => {
  it('50+ pending → 429 pending_limit_reached', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 200 }),
        async (pendingCount) => {
          const db = createMockDB({ pendingCount });
          const ctx = createContext({
            body: {
              title: 'Pending Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            db,
          });
          const res = await POST(ctx);
          expect(res.status).toBe(429);
          const json: any = await res.json();
          expect(json.error).toBe('pending_limit_reached');
          expect(json.pending_count).toBe(pendingCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('<50 pending → allowed (not pending_limit_reached)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 49 }),
        async (pendingCount) => {
          const db = createMockDB({ pendingCount });
          const ctx = createContext({
            body: {
              title: 'Pending Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            db,
          });
          const res = await POST(ctx);
          // Should not be pending-limited
          if (res.status === 429) {
            const json: any = await res.json();
            expect(json.error).not.toBe('pending_limit_reached');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('custom pending limit respected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 200 }),
        async (maxPending, pendingCount) => {
          const db = createMockDB({ pendingCount });
          const ctx = createContext({
            body: {
              title: 'Pending Test',
              description: 'Valid description',
              body_md: 'A'.repeat(150),
              agent_id: 'test-agent',
            },
            headers: { 'x-agent-token': 'admin-secret-token' },
            db,
            env: { AGENT_PUBLISH_MAX_PENDING: maxPending },
          });
          const res = await POST(ctx);
          const json: any = await res.json();

          if (pendingCount >= maxPending) {
            expect(res.status).toBe(429);
            expect(json.error).toBe('pending_limit_reached');
          } else {
            if (res.status === 429) {
              expect(json.error).not.toBe('pending_limit_reached');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
