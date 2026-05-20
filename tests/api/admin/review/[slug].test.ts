import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '../../../../src/pages/api/admin/review/[slug]';
import type { APIContext } from 'astro';

// --- Mock D1 helpers ---

const DRAFT_POST = {
  id: 42,
  slug: 'test-draft',
  title: 'Test Draft Title',
  description: 'A test draft description',
  body_md: '# Hello\n\nThis is a test draft body with enough content to pass validation checks.',
  tags: '["teknis","produk"]',
  cover: null,
  status: 'draft',
  source: 'openclaw',
  published_at: null,
  created_at: 1700000000000,
};

const PUBLISHED_POST = {
  ...DRAFT_POST,
  slug: 'published-post',
  status: 'published',
  published_at: 1700000100000,
};

function createMockDb(options: {
  post?: typeof DRAFT_POST | typeof PUBLISHED_POST | null;
} = {}) {
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(options.post ?? null);
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

function createGetContext(options: {
  slug?: string;
  adminToken?: string;
  headerToken?: string;
  db?: ReturnType<typeof createMockDb>;
}): APIContext {
  const db = options.db ?? createMockDb();
  const headers = new Headers();
  if (options.headerToken) {
    headers.set('x-admin-token', options.headerToken);
  }

  const request = new Request(`http://localhost/api/admin/review/${options.slug ?? 'test-draft'}`, {
    method: 'GET',
    headers,
  });

  return {
    params: { slug: options.slug ?? 'test-draft' },
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

function createPatchContext(options: {
  slug?: string;
  adminToken?: string;
  headerToken?: string;
  body?: Record<string, unknown>;
  db?: ReturnType<typeof createMockDb>;
}): APIContext {
  const db = options.db ?? createMockDb();
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  if (options.headerToken) {
    headers.set('x-admin-token', options.headerToken);
  }

  const request = new Request(`http://localhost/api/admin/review/${options.slug ?? 'test-draft'}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(options.body ?? { action: 'approve' }),
  });

  return {
    params: { slug: options.slug ?? 'test-draft' },
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

describe('GET /api/admin/review/[slug]', () => {
  describe('authentication', () => {
    it('returns 401 when no admin token provided', async () => {
      const ctx = createGetContext({ headerToken: undefined });
      const response = await GET(ctx);

      expect(response.status).toBe(401);
      const body: any = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 when wrong admin token provided', async () => {
      const ctx = createGetContext({
        adminToken: 'correct-token',
        headerToken: 'wrong-token',
      });
      const response = await GET(ctx);

      expect(response.status).toBe(401);
    });
  });

  describe('draft not found', () => {
    it('returns 404 when slug does not exist', async () => {
      const db = createMockDb({ post: null });
      const ctx = createGetContext({
        slug: 'nonexistent',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await GET(ctx);

      expect(response.status).toBe(404);
      const body: any = await response.json();
      expect(body.error).toBe('draft_not_found');
      expect(body.slug).toBe('nonexistent');
    });
  });

  describe('already published', () => {
    it('returns 409 when post is already published', async () => {
      const db = createMockDb({ post: PUBLISHED_POST });
      const ctx = createGetContext({
        slug: 'published-post',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await GET(ctx);

      expect(response.status).toBe(409);
      const body: any = await response.json();
      expect(body.error).toBe('already_published');
      expect(body.slug).toBe('published-post');
      expect(body.published_at).toBe(1700000100000);
    });
  });

  describe('successful draft retrieval', () => {
    it('returns 200 with draft detail and rendered HTML', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createGetContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await GET(ctx);

      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.draft).toBeDefined();
      expect(body.draft.id).toBe(42);
      expect(body.draft.slug).toBe('test-draft');
      expect(body.draft.title).toBe('Test Draft Title');
      expect(body.draft.description).toBe('A test draft description');
      expect(body.draft.body_md).toContain('# Hello');
      expect(body.draft.tags).toEqual(['teknis', 'produk']);
      expect(body.draft.status).toBe('draft');
      expect(body.draft.source).toBe('openclaw');
      expect(body.draft.published_at).toBeNull();
    });

    it('returns rendered HTML from markdown', async () => {
      const postWithH2 = {
        ...DRAFT_POST,
        body_md: '## Hello\n\nThis is a test draft body with enough content to pass validation checks.',
      };
      const db = createMockDb({ post: postWithH2 });
      const ctx = createGetContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        db,
      });
      const response = await GET(ctx);

      const body: any = await response.json();
      expect(body.html).toBeDefined();
      expect(body.html).toContain('<h2>Hello</h2>');
      expect(body.linkWarnings).toBeDefined();
      expect(Array.isArray(body.linkWarnings)).toBe(true);
    });
  });
});

describe('PATCH /api/admin/review/[slug]', () => {
  describe('authentication', () => {
    it('returns 401 when no admin token provided', async () => {
      const ctx = createPatchContext({ headerToken: undefined });
      const response = await PATCH(ctx);

      expect(response.status).toBe(401);
      const body: any = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 when wrong admin token provided', async () => {
      const ctx = createPatchContext({
        adminToken: 'correct-token',
        headerToken: 'wrong-token',
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(401);
    });
  });

  describe('invalid action', () => {
    it('returns 400 when action is missing', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        adminToken: 'token',
        headerToken: 'token',
        body: {},
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(400);
      const body: any = await response.json();
      expect(body.error).toBe('invalid_action');
    });

    it('returns 400 when action is not approve/reject/edit', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'unknown' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(400);
      const body: any = await response.json();
      expect(body.error).toBe('invalid_action');
    });
  });

  describe('draft not found', () => {
    it('returns 404 when slug does not exist', async () => {
      const db = createMockDb({ post: null });
      const ctx = createPatchContext({
        slug: 'nonexistent',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(404);
      const body: any = await response.json();
      expect(body.error).toBe('draft_not_found');
    });
  });

  describe('already published', () => {
    it('returns 409 when post is already published', async () => {
      const db = createMockDb({ post: PUBLISHED_POST });
      const ctx = createPatchContext({
        slug: 'published-post',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(409);
      const body: any = await response.json();
      expect(body.error).toBe('already_published');
    });
  });

  describe('action: approve', () => {
    it('returns 200 with live URL on successful approve', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('approve');
      expect(body.url).toBe('/cerita/d/test-draft');
    });

    it('executes UPDATE posts SET status=published, published_at', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      await PATCH(ctx);

      // First prepare: SELECT post
      // Second prepare: UPDATE posts SET status='published'
      // Third prepare: INSERT agent_audit
      // Fourth prepare: UPDATE agent_stats
      const updateCall = db.prepare.mock.calls[1][0];
      expect(updateCall).toContain('UPDATE posts SET status');
      expect(updateCall).toContain('published');
      expect(updateCall).toContain('published_at');
    });

    it('inserts audit log with action=approve', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      await PATCH(ctx);

      const auditCall = db.prepare.mock.calls[2][0];
      expect(auditCall).toContain('INSERT INTO agent_audit');
      // 'approve' is a literal in the SQL VALUES clause
      expect(auditCall).toContain("'approve'");

      const bindArgs = db._bind.mock.calls[2];
      expect(bindArgs).toContain('openclaw');
      expect(bindArgs).toContain('test-draft');
    });

    it('updates agent_stats total_approved', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'approve' },
        db,
      });
      await PATCH(ctx);

      const statsCall = db.prepare.mock.calls[3][0];
      expect(statsCall).toContain('UPDATE agent_stats');
      expect(statsCall).toContain('total_approved');
    });
  });

  describe('action: reject', () => {
    it('returns 200 with deleted=true on successful reject', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'reject' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('reject');
      expect(body.deleted).toBe(true);
    });

    it('executes DELETE FROM posts (hard delete)', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'reject' },
        db,
      });
      await PATCH(ctx);

      const deleteCall = db.prepare.mock.calls[1][0];
      expect(deleteCall).toContain('DELETE FROM posts');
      expect(deleteCall).toContain('WHERE slug');
    });

    it('inserts audit log with action=reject', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'reject', reason: 'Low quality content' },
        db,
      });
      await PATCH(ctx);

      const auditCall = db.prepare.mock.calls[2][0];
      expect(auditCall).toContain('INSERT INTO agent_audit');
      // 'reject' is a literal in the SQL VALUES clause
      expect(auditCall).toContain("'reject'");

      const bindArgs = db._bind.mock.calls[2];
      expect(bindArgs).toContain('openclaw');
      expect(bindArgs).toContain('test-draft');
      // Metadata should contain the reason
      const metadataArg = bindArgs.find(
        (arg: unknown) => typeof arg === 'string' && arg.includes('reason')
      );
      expect(metadataArg).toContain('Low quality content');
    });

    it('updates agent_stats total_rejected', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'reject' },
        db,
      });
      await PATCH(ctx);

      const statsCall = db.prepare.mock.calls[3][0];
      expect(statsCall).toContain('UPDATE agent_stats');
      expect(statsCall).toContain('total_rejected');
    });
  });

  describe('action: edit', () => {
    it('returns 400 when updates object is missing', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'edit' },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(400);
      const body: any = await response.json();
      expect(body.error).toBe('missing_updates');
    });

    it('returns 400 when updates object is empty', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'edit', updates: {} },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(400);
      const body: any = await response.json();
      expect(body.error).toBe('missing_updates');
    });

    it('returns 200 with updated=true on successful edit', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'edit', updates: { title: 'Updated Title' } },
        db,
      });
      const response = await PATCH(ctx);

      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('edit');
      expect(body.updated).toBe(true);
    });

    it('executes UPDATE posts with provided fields', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: {
          action: 'edit',
          updates: { title: 'New Title', description: 'New Desc' },
        },
        db,
      });
      await PATCH(ctx);

      const updateCall = db.prepare.mock.calls[1][0];
      expect(updateCall).toContain('UPDATE posts SET');
      expect(updateCall).toContain('title');
      expect(updateCall).toContain('description');
    });

    it('serializes tags as JSON when updating', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: {
          action: 'edit',
          updates: { tags: ['karier', 'catatan'] },
        },
        db,
      });
      await PATCH(ctx);

      const bindArgs = db._bind.mock.calls[1];
      const tagsArg = bindArgs.find(
        (arg: unknown) => typeof arg === 'string' && arg.includes('karier')
      );
      expect(tagsArg).toBe('["karier","catatan"]');
    });

    it('inserts audit log with action=edit and field metadata', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: {
          action: 'edit',
          updates: { title: 'New Title', body_md: 'New body content' },
        },
        db,
      });
      await PATCH(ctx);

      const auditCall = db.prepare.mock.calls[2][0];
      expect(auditCall).toContain('INSERT INTO agent_audit');
      // 'edit' is a literal in the SQL VALUES clause
      expect(auditCall).toContain("'edit'");

      const bindArgs = db._bind.mock.calls[2];
      expect(bindArgs).toContain('openclaw');
      expect(bindArgs).toContain('test-draft');
      // Metadata should contain the edited fields
      const metadataArg = bindArgs.find(
        (arg: unknown) => typeof arg === 'string' && arg.includes('fields')
      );
      expect(metadataArg).toContain('title');
      expect(metadataArg).toContain('body_md');
    });

    it('updates agent_stats total_edited_before_approve', async () => {
      const db = createMockDb({ post: DRAFT_POST });
      const ctx = createPatchContext({
        slug: 'test-draft',
        adminToken: 'token',
        headerToken: 'token',
        body: { action: 'edit', updates: { title: 'New' } },
        db,
      });
      await PATCH(ctx);

      const statsCall = db.prepare.mock.calls[3][0];
      expect(statsCall).toContain('UPDATE agent_stats');
      expect(statsCall).toContain('total_edited_before_approve');
    });
  });
});
