import { describe, it, expect, vi } from 'vitest';
import { GET } from '../../../../src/pages/api/admin/review/index';

// --- Mock D1 helpers ---

function createMockDb(drafts: Array<Record<string, unknown>> = []) {
  const allFn = vi.fn().mockResolvedValue({ results: drafts });
  const prepareFn = vi.fn().mockReturnValue({ all: allFn });

  return {
    prepare: prepareFn,
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

describe('GET /api/admin/review', () => {
  it('returns 401 without admin token', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/review');
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(401);

    const body: any = await response.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 with wrong admin token', async () => {
    const db = createMockDb();
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': 'wrong-token' },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(401);
  });

  it('accepts admin token via header', async () => {
    const db = createMockDb([]);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.drafts).toEqual([]);
  });

  it('accepts admin token via query param', async () => {
    const db = createMockDb([]);
    const request = new Request(
      `http://localhost/api/admin/review?admin_token=${ADMIN_TOKEN}`
    );
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.drafts).toEqual([]);
  });

  it('returns drafts with correct fields', async () => {
    const drafts = [
      {
        slug: 'test-draft-1',
        title: 'Test Draft One',
        agent_id: 'openclaw',
        source: 'openclaw',
        body_md: 'A'.repeat(200),
        tags: '["teknis"]',
        created_at: 1700000000000,
        total_submitted: 5,
        total_approved: 4,
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.drafts).toHaveLength(1);

    const draft = body.drafts[0];
    expect(draft.slug).toBe('test-draft-1');
    expect(draft.title).toBe('Test Draft One');
    expect(draft.agent_id).toBe('openclaw');
    expect(draft.source).toBe('openclaw');
    expect(draft.body_length).toBe(200);
    expect(draft.warnings_count).toBe(0);
    expect(draft.created_at).toBe(1700000000000);
    expect(draft.trust_badge).toBe(true); // 4/5 = 0.8, approved >= 3
  });

  it('shows trust_badge=true when trust_ratio >= 0.8 and total_approved >= 3', async () => {
    const drafts = [
      {
        slug: 'trusted-draft',
        title: 'Trusted Agent Draft',
        agent_id: 'reliable-agent',
        source: 'reliable-agent',
        body_md: 'B'.repeat(150),
        tags: '[]',
        created_at: 1700000000000,
        total_submitted: 10,
        total_approved: 8, // 8/10 = 0.8 >= 0.8, approved=8 >= 3
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts[0].trust_badge).toBe(true);
  });

  it('shows trust_badge=false when trust_ratio < 0.8', async () => {
    const drafts = [
      {
        slug: 'untrusted-draft',
        title: 'Untrusted Agent Draft',
        agent_id: 'new-agent',
        source: 'new-agent',
        body_md: 'C'.repeat(150),
        tags: '[]',
        created_at: 1700000000000,
        total_submitted: 10,
        total_approved: 7, // 7/10 = 0.7 < 0.8
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts[0].trust_badge).toBe(false);
  });

  it('shows trust_badge=false when total_approved < 3 even if ratio >= 0.8', async () => {
    const drafts = [
      {
        slug: 'new-agent-draft',
        title: 'New Agent Draft',
        agent_id: 'brand-new',
        source: 'brand-new',
        body_md: 'D'.repeat(150),
        tags: '[]',
        created_at: 1700000000000,
        total_submitted: 2,
        total_approved: 2, // 2/2 = 1.0 >= 0.8, but approved=2 < 3
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts[0].trust_badge).toBe(false);
  });

  it('shows trust_badge=false when agent has no stats (0 submissions)', async () => {
    const drafts = [
      {
        slug: 'no-stats-draft',
        title: 'No Stats Draft',
        agent_id: 'ghost-agent',
        source: 'ghost-agent',
        body_md: 'E'.repeat(150),
        tags: '[]',
        created_at: 1700000000000,
        total_submitted: 0,
        total_approved: 0,
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts[0].trust_badge).toBe(false);
  });

  it('calculates body_length correctly', async () => {
    const bodyContent = 'Hello world! This is a test body with some content.';
    const drafts = [
      {
        slug: 'length-test',
        title: 'Length Test',
        agent_id: 'test-agent',
        source: 'test-agent',
        body_md: bodyContent,
        tags: '[]',
        created_at: 1700000000000,
        total_submitted: 1,
        total_approved: 0,
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts[0].body_length).toBe(bodyContent.length);
  });

  it('counts warnings for drafts with quality issues', async () => {
    // Body with >10 URLs and a blacklist word
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/page${i}`).join('\n');
    const bodyWithIssues = `${urls}\nThis has casino content`;

    const drafts = [
      {
        slug: 'warning-draft',
        title: 'Warning Draft',
        agent_id: 'spammy-agent',
        source: 'spammy-agent',
        body_md: bodyWithIssues,
        tags: '["invalid-tag"]', // not in whitelist
        created_at: 1700000000000,
        total_submitted: 1,
        total_approved: 0,
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    // Should have 3 warnings: invalid tag, excessive URLs, blacklist word
    expect(body.drafts[0].warnings_count).toBe(3);
  });

  it('returns multiple drafts ordered by created_at DESC', async () => {
    const drafts = [
      {
        slug: 'newer-draft',
        title: 'Newer Draft',
        agent_id: 'agent-a',
        source: 'agent-a',
        body_md: 'F'.repeat(150),
        tags: '[]',
        created_at: 1700002000000,
        total_submitted: 5,
        total_approved: 4,
      },
      {
        slug: 'older-draft',
        title: 'Older Draft',
        agent_id: 'agent-b',
        source: 'agent-b',
        body_md: 'G'.repeat(150),
        tags: '[]',
        created_at: 1700001000000,
        total_submitted: 2,
        total_approved: 1,
      },
    ];

    const db = createMockDb(drafts);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    const response = await GET(ctx);
    const body: any = await response.json();

    expect(body.drafts).toHaveLength(2);
    expect(body.drafts[0].slug).toBe('newer-draft');
    expect(body.drafts[1].slug).toBe('older-draft');
  });

  it('queries with correct SQL (status=draft, source != manual)', async () => {
    const db = createMockDb([]);
    const request = new Request('http://localhost/api/admin/review', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const ctx = createAPIContext(request, { ADMIN_TOKEN, DB: db });

    await GET(ctx);

    // Verify the SQL query was called
    expect(db.prepare).toHaveBeenCalledTimes(1);
    const sqlArg = db.prepare.mock.calls[0][0];
    expect(sqlArg).toContain("p.status = 'draft'");
    expect(sqlArg).toContain("p.source != 'manual'");
    expect(sqlArg).toContain('ORDER BY p.created_at DESC');
    expect(sqlArg).toContain('LEFT JOIN agent_stats');
  });
});
