import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../../../../src/pages/api/admin/agents/index';
import { hashToken } from '@lib/agent-auth';

// --- Mock D1 helpers ---

function createMockDb(options: {
  agents?: Array<Record<string, unknown>>;
  existingAgent?: Record<string, unknown> | null;
} = {}) {
  const results = options.agents ?? [];
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(options.existingAgent ?? null);
  const allFn = vi.fn().mockResolvedValue({ results });
  const bindFn = vi.fn().mockReturnValue({ first: firstFn, run: runFn, all: allFn });
  const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, all: allFn, first: firstFn, run: runFn });

  return {
    prepare: prepareFn,
    _bind: bindFn,
    _first: firstFn,
    _run: runFn,
    _all: allFn,
  };
}

function createAPIContext(request: Request, env: Record<string, unknown>) {
  return {
    request,
    locals: { runtime: { env } },
    params: {},
    url: new URL(request.url),
    redirect: () => new Response(null, { status: 302 }),
  } as any;
}

const ADMIN_TOKEN = 'test-admin-token-xyz';

describe('GET /api/admin/agents', () => {
  it('returns 401 without admin token', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents');
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(401);

    const body: any = await response.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 with wrong admin token', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents', {
      headers: { 'x-admin-token': 'wrong-token' },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(401);
  });

  it('accepts admin token via header', async () => {
    const db = createMockDb({ agents: [] });
    const request = new Request('http://localhost/api/admin/agents', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.agents).toEqual([]);
  });

  it('accepts admin token via query param', async () => {
    const db = createMockDb({ agents: [] });
    const request = new Request(`http://localhost/api/admin/agents?admin_token=${ADMIN_TOKEN}`);
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);
  });

  it('returns agents with trust ratio calculated', async () => {
    const agents = [
      {
        agent_id: 'openclaw',
        display_name: 'OpenClaw',
        created_at: 1700000000000,
        last_used_at: 1700001000000,
        revoked_at: null,
        total_submitted: 10,
        total_approved: 8,
        total_rejected: 1,
        total_edited_before_approve: 2,
      },
      {
        agent_id: 'hermes',
        display_name: 'Hermes',
        created_at: 1700000000000,
        last_used_at: null,
        revoked_at: 1700002000000,
        total_submitted: 0,
        total_approved: 0,
        total_rejected: 0,
        total_edited_before_approve: 0,
      },
    ];

    const db = createMockDb({ agents });
    const request = new Request('http://localhost/api/admin/agents', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.agents).toHaveLength(2);

    // OpenClaw: 8/10 = 0.8 trust ratio
    expect(body.agents[0].agent_id).toBe('openclaw');
    expect(body.agents[0].trust_ratio).toBe(0.8);

    // Hermes: 0/0 = 0 trust ratio (division by zero handled)
    expect(body.agents[1].agent_id).toBe('hermes');
    expect(body.agents[1].trust_ratio).toBe(0);
    expect(body.agents[1].revoked_at).toBe(1700002000000);
  });
});

describe('POST /api/admin/agents', () => {
  it('returns 401 without admin token', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test', display_name: 'Test' }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: 'not json',
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(400);

    const body: any = await response.json();
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 when agent_id is missing', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ display_name: 'Test Agent' }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(400);

    const body: any = await response.json();
    expect(body.error).toBe('validation_failed');
    expect(body.fields.agent_id).toBeDefined();
  });

  it('returns 400 when display_name is missing', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ agent_id: 'test-agent' }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(400);

    const body: any = await response.json();
    expect(body.error).toBe('validation_failed');
    expect(body.fields.display_name).toBeDefined();
  });

  it('returns 409 when agent_id already exists', async () => {
    const db = createMockDb({ existingAgent: { agent_id: 'openclaw' } });
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ agent_id: 'openclaw', display_name: 'OpenClaw' }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(409);

    const body: any = await response.json();
    expect(body.error).toBe('agent_already_exists');
  });

  it('creates agent and returns plaintext token on success', async () => {
    const db = createMockDb({ existingAgent: null });
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({
        agent_id: 'new-agent',
        display_name: 'New Agent',
        notes: 'Test notes',
      }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    expect(response.status).toBe(201);

    const body: any = await response.json();
    expect(body.success).toBe(true);
    expect(body.agent_id).toBe('new-agent');
    expect(body.display_name).toBe('New Agent');
    expect(body.token).toBeDefined();
    expect(body.created_at).toBeDefined();

    // Token should be 64 hex chars (32 bytes)
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);

    // Verify DB was called correctly:
    // 1. Check for existing agent
    // 2. INSERT into agents
    // 3. INSERT into agent_stats
    // 4. INSERT into agent_audit
    expect(db.prepare).toHaveBeenCalledTimes(4);
  });

  it('generated token hash matches SHA-256 of plaintext', async () => {
    const db = createMockDb({ existingAgent: null });
    const request = new Request('http://localhost/api/admin/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({
        agent_id: 'hash-test',
        display_name: 'Hash Test',
      }),
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await POST(ctx);
    const body: any = await response.json();

    // The token returned should hash to what was stored
    const expectedHash = await hashToken(body.token);

    // The second prepare call is the INSERT into agents — check the bind args
    const bindCalls = db._bind.mock.calls;
    // bindCalls[1] should be the agents INSERT: (agent_id, display_name, token_hash, created_at, notes)
    const storedHash = bindCalls[1][2]; // third arg is token_hash
    expect(storedHash).toBe(expectedHash);
  });
});
