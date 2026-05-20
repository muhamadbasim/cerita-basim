import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../src/pages/api/agent/drafts';
import type { APIContext } from 'astro';

// --- Mocks ---

function createMockKV(store: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => { store[key] = value; }),
    delete: vi.fn(async () => {}),
  } as unknown as KVNamespace;
}

function createMockDB(options: {
  agentRecord?: { agent_id: string; revoked_at: number | null } | null;
  existingSlug?: boolean;
  pendingCount?: number;
  insertedId?: number;
} = {}) {
  const {
    agentRecord = { agent_id: 'test-agent', revoked_at: null },
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
          return agentRecord;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: pendingCount };
        }
        if (sql.includes('SELECT id FROM posts WHERE slug')) {
          slugCheckCount++;
          if (existingSlug && slugCheckCount === 1) {
            // First call: slug exists (collision)
            return { id: 1 };
          }
          if (slugCheckCount === 1) {
            // No collision — first check returns null
            return null;
          }
          // Second call: after insert, return the inserted ID
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
  env?: Record<string, unknown>;
  db?: D1Database;
  kv?: KVNamespace;
}): APIContext {
  const {
    body = {},
    headers = {},
    env: envOverrides = {},
    db,
    kv,
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

function validDraftBody() {
  return {
    title: 'Test Draft Title',
    description: 'A valid description for the draft post',
    body_md: 'A'.repeat(150), // ≥100 chars
    agent_id: 'test-agent',
    tags: ['teknis'],
  };
}

// --- Tests ---

describe('POST /api/agent/drafts', () => {
  describe('Authentication (AGP-001)', () => {
    it('returns 401 when X-Agent-Token header is missing', async () => {
      const ctx = createContext({ body: validDraftBody() });
      const res = await POST(ctx);
      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error).toBe('unauthorized');
    });

    it('returns 401 when token is invalid', async () => {
      const db = createMockDB({ agentRecord: null });
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'bad-token' },
        db,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(401);
    });

    it('accepts ADMIN_TOKEN for backward compat (AGP-035)', async () => {
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(201);
    });
  });

  describe('Field Validation (AGP-002)', () => {
    it('returns 400 when title is empty', async () => {
      const body = { ...validDraftBody(), title: '' };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toBe('validation_failed');
      expect(json.fields.title).toBeDefined();
    });

    it('returns 400 when title exceeds 200 chars', async () => {
      const body = { ...validDraftBody(), title: 'X'.repeat(201) };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.title).toBeDefined();
    });

    it('returns 400 when description is empty', async () => {
      const body = { ...validDraftBody(), description: '' };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.description).toBeDefined();
    });

    it('returns 400 when description exceeds 500 chars', async () => {
      const body = { ...validDraftBody(), description: 'X'.repeat(501) };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.description).toBeDefined();
    });

    it('returns 400 when body_md is too short (<100)', async () => {
      const body = { ...validDraftBody(), body_md: 'short' };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.body_md).toBeDefined();
    });

    it('returns 400 when body_md exceeds 50000 chars', async () => {
      const body = { ...validDraftBody(), body_md: 'X'.repeat(50001) };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.body_md).toBeDefined();
    });

    it('returns 400 when agent_id is empty', async () => {
      const body = { ...validDraftBody(), agent_id: '' };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      // With ADMIN_TOKEN, empty agent_id still passes auth (legacy-webhook),
      // but validation should catch it
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.fields.agent_id).toBeDefined();
    });

    it('returns 400 for invalid JSON body', async () => {
      const request = new Request('http://localhost/api/agent/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-token': 'admin-secret-token',
        },
        body: 'not json',
      });
      const ctx = {
        request,
        locals: {
          runtime: {
            env: {
              DB: createMockDB(),
              KV: createMockKV(),
              ADMIN_TOKEN: 'admin-secret-token',
            },
          },
        },
      } as unknown as APIContext;

      const res = await POST(ctx);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toBe('invalid_json');
    });
  });

  describe('Rate Limiting (AGP-050)', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const kvStore: Record<string, string> = { 'ratelimit:agent:test-agent': '10' };
      const kv = createMockKV(kvStore);
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'admin-secret-token' },
        kv,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(429);
      const json: any = await res.json();
      expect(json.error).toBe('rate_limited');
      expect(json.retry_after).toBeGreaterThan(0);
    });
  });

  describe('Pending Limit (AGP-052)', () => {
    it('returns 429 when pending limit reached', async () => {
      const db = createMockDB({ pendingCount: 50 });
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'admin-secret-token' },
        db,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(429);
      const json: any = await res.json();
      expect(json.error).toBe('pending_limit_reached');
    });
  });

  describe('Successful Submission (AGP-004, AGP-006)', () => {
    it('returns 201 with correct response shape', async () => {
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.draft_id).toBeDefined();
      expect(json.slug).toBeDefined();
      expect(json.review_url).toContain('/admin/review/');
      expect(json.status).toBe('draft');
    });

    it('generates slug from title (AGP-003)', async () => {
      const body = { ...validDraftBody(), title: 'Hello World Test' };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      const json: any = await res.json();
      expect(json.slug).toBe('hello-world-test');
    });

    it('includes quality warnings when present (AGP-005)', async () => {
      const body = {
        ...validDraftBody(),
        body_md: 'A'.repeat(100) + ' casino content here',
      };
      const ctx = createContext({
        body,
        headers: { 'x-agent-token': 'admin-secret-token' },
      });
      const res = await POST(ctx);
      const json: any = await res.json();
      expect(res.status).toBe(201);
      expect(json.warnings).toBeDefined();
      expect(json.warnings.length).toBeGreaterThan(0);
      expect(json.warnings[0].code).toBe('blacklist_words');
    });
  });

  describe('Idempotency (AGP-051)', () => {
    it('caches response with idempotency key', async () => {
      const kvStore: Record<string, string> = {};
      const kv = createMockKV(kvStore);
      const ctx = createContext({
        body: validDraftBody(),
        headers: {
          'x-agent-token': 'admin-secret-token',
          'idempotency-key': 'unique-key-123',
        },
        kv,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(201);
      // Verify KV.put was called with idempotency cache
      expect(kv.put).toHaveBeenCalledWith(
        expect.stringContaining('idempotency:'),
        expect.any(String),
        { expirationTtl: 86400 }
      );
    });

    it('returns cached response on duplicate idempotency key', async () => {
      const cachedResponse = JSON.stringify({
        success: true,
        draft_id: 99,
        slug: 'cached-slug',
        review_url: '/admin/review/cached-slug',
        status: 'draft',
      });
      const kvStore: Record<string, string> = {
        'idempotency:test-agent:dup-key': cachedResponse,
      };
      const kv = createMockKV(kvStore);
      const ctx = createContext({
        body: validDraftBody(),
        headers: {
          'x-agent-token': 'admin-secret-token',
          'idempotency-key': 'dup-key',
        },
        kv,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.draft_id).toBe(99);
      expect(json.slug).toBe('cached-slug');
    });
  });

  describe('Slug Collision (AGP-003)', () => {
    it('appends timestamp on slug collision', async () => {
      const db = createMockDB({ existingSlug: true });
      const ctx = createContext({
        body: validDraftBody(),
        headers: { 'x-agent-token': 'admin-secret-token' },
        db,
      });
      const res = await POST(ctx);
      expect(res.status).toBe(201);
      const json: any = await res.json();
      // Slug should have a timestamp suffix
      expect(json.slug).toMatch(/^test-draft-title-[a-z0-9]+$/);
    });
  });
});
