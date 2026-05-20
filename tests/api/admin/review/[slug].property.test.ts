import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { PATCH } from '../../../../src/pages/api/admin/review/[slug]';
import type { APIContext } from 'astro';

/**
 * Property-based tests for PATCH /api/admin/review/[slug] endpoint.
 * Tests approve/reject transitions, audit log completeness, and trust score consistency.
 *
 * **Validates: Requirements AGP-013, AGP-015, AGP-040, AGP-021**
 */

// --- Generators ---

/** Generate a valid slug (lowercase alphanumeric + hyphens) */
const slugArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  minLength: 3,
  maxLength: 60,
}).filter(s => /^[a-z]/.test(s) && !s.endsWith('-') && !s.includes('--'));

/** Generate a valid agent_id */
const agentIdArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  minLength: 1,
  maxLength: 30,
}).filter(s => s.trim().length > 0);

/** Generate a draft post row */
function draftPostArb() {
  return fc.record({
    id: fc.integer({ min: 1, max: 100000 }),
    slug: slugArb,
    title: fc.string({ minLength: 1, maxLength: 200 }),
    description: fc.string({ minLength: 1, maxLength: 500 }),
    body_md: fc.string({ minLength: 100, maxLength: 500 }),
    tags: fc.constant('["teknis","produk"]'),
    cover: fc.constant(null),
    status: fc.constant('draft' as const),
    source: agentIdArb,
    published_at: fc.constant(null),
    created_at: fc.integer({ min: 1600000000000, max: 1800000000000 }),
  });
}

// --- Mock helpers ---

interface PrepareCall {
  sql: string;
  bindArgs: unknown[];
}

function createTrackingDb(post: Record<string, unknown> | null) {
  const calls: PrepareCall[] = [];

  const prepare = vi.fn((sql: string) => {
    const callRecord: PrepareCall = { sql, bindArgs: [] };
    calls.push(callRecord);

    const stmt = {
      bind: vi.fn((...args: unknown[]) => {
        callRecord.bindArgs = args;
        return stmt;
      }),
      first: vi.fn(async () => post),
      run: vi.fn(async () => ({ success: true })),
      all: vi.fn(async () => ({ results: [] })),
    };
    return stmt;
  });

  return { prepare, calls };
}

function createPatchContext(options: {
  slug: string;
  body: Record<string, unknown>;
  db: { prepare: ReturnType<typeof vi.fn>; calls: PrepareCall[] };
}): APIContext {
  const { slug, body, db } = options;
  const adminToken = 'admin-secret-token';

  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-admin-token', adminToken);

  const request = new Request(`http://localhost/api/admin/review/${slug}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });

  return {
    params: { slug },
    request,
    locals: {
      runtime: {
        env: {
          ADMIN_EMAIL: 'admin@basim.id',
          ADMIN_TOKEN: adminToken,
          DB: db,
        },
      },
    },
  } as unknown as APIContext;
}

// --- Property Tests ---

describe('Property 6: Approve transitions draft to published', () => {
  /**
   * **Validates: Requirements AGP-013**
   *
   * For any post with status='draft', executing an approve action shall set
   * status='published' and published_at to a non-null timestamp.
   */
  it('draft + approve → status=published, published_at non-null', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'approve' },
            db,
          });

          const res = await PATCH(ctx);
          expect(res.status).toBe(200);

          const json: any = await res.json();
          expect(json.success).toBe(true);
          expect(json.action).toBe('approve');
          expect(json.url).toBe(`/cerita/d/${draftPost.slug}`);

          // Verify the UPDATE SQL sets status='published' and published_at
          const updateCall = db.calls.find(
            c => c.sql.includes('UPDATE posts SET status')
          );
          expect(updateCall).toBeDefined();
          expect(updateCall!.sql).toContain('published');
          expect(updateCall!.sql).toContain('published_at');

          // published_at bind arg should be a non-null number (timestamp)
          const publishedAtArg = updateCall!.bindArgs[0];
          expect(publishedAtArg).not.toBeNull();
          expect(typeof publishedAtArg).toBe('number');
          expect(publishedAtArg as number).toBeGreaterThan(0);
          expect(publishedAtArg as number).toBeLessThanOrEqual(Date.now());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('approve sets published_at ≤ current time', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const beforeTime = Date.now();
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'approve' },
            db,
          });

          await PATCH(ctx);
          const afterTime = Date.now();

          const updateCall = db.calls.find(
            c => c.sql.includes('UPDATE posts SET status')
          );
          const publishedAt = updateCall!.bindArgs[0] as number;

          // published_at should be between before and after the call
          expect(publishedAt).toBeGreaterThanOrEqual(beforeTime);
          expect(publishedAt).toBeLessThanOrEqual(afterTime);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 7: Reject removes draft completely', () => {
  /**
   * **Validates: Requirements AGP-015**
   *
   * For any post with status='draft', executing a reject action shall result
   * in the row being deleted from the posts table (hard delete).
   */
  it('draft + reject → DELETE FROM posts is called with correct slug', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'reject' },
            db,
          });

          const res = await PATCH(ctx);
          expect(res.status).toBe(200);

          const json: any = await res.json();
          expect(json.success).toBe(true);
          expect(json.action).toBe('reject');
          expect(json.deleted).toBe(true);

          // Verify DELETE FROM posts was called
          const deleteCall = db.calls.find(
            c => c.sql.includes('DELETE FROM posts')
          );
          expect(deleteCall).toBeDefined();
          expect(deleteCall!.sql).toContain('WHERE slug');

          // The slug bind arg should match the draft's slug
          expect(deleteCall!.bindArgs).toContain(draftPost.slug);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reject with optional reason still deletes the row', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (draftPost, reason) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'reject', reason },
            db,
          });

          const res = await PATCH(ctx);
          expect(res.status).toBe(200);

          const json: any = await res.json();
          expect(json.deleted).toBe(true);

          // DELETE still called
          const deleteCall = db.calls.find(
            c => c.sql.includes('DELETE FROM posts')
          );
          expect(deleteCall).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 10: Audit log completeness', () => {
  /**
   * **Validates: Requirements AGP-040**
   *
   * For any action (approve, reject, edit) performed, there shall exist a
   * corresponding INSERT INTO agent_audit with matching action, agent_id, and timestamp.
   */
  it('approve → agent_audit row with action=approve, correct agent_id and slug', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'approve' },
            db,
          });

          await PATCH(ctx);

          // Find the INSERT INTO agent_audit call
          const auditCall = db.calls.find(
            c => c.sql.includes('INSERT INTO agent_audit')
          );
          expect(auditCall).toBeDefined();
          expect(auditCall!.sql).toContain("'approve'");

          // Verify agent_id (source) and slug are bound
          expect(auditCall!.bindArgs).toContain(draftPost.source);
          expect(auditCall!.bindArgs).toContain(draftPost.slug);

          // Verify created_at timestamp is present and reasonable
          const timestampArg = auditCall!.bindArgs.find(
            a => typeof a === 'number' && a > 1600000000000
          );
          expect(timestampArg).toBeDefined();
          expect(timestampArg as number).toBeLessThanOrEqual(Date.now());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reject → agent_audit row with action=reject, correct agent_id and slug', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'reject' },
            db,
          });

          await PATCH(ctx);

          const auditCall = db.calls.find(
            c => c.sql.includes('INSERT INTO agent_audit')
          );
          expect(auditCall).toBeDefined();
          expect(auditCall!.sql).toContain("'reject'");
          expect(auditCall!.bindArgs).toContain(draftPost.source);
          expect(auditCall!.bindArgs).toContain(draftPost.slug);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('edit → agent_audit row with action=edit, correct agent_id and slug', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'edit', updates: { title: 'Updated Title' } },
            db,
          });

          await PATCH(ctx);

          const auditCall = db.calls.find(
            c => c.sql.includes('INSERT INTO agent_audit')
          );
          expect(auditCall).toBeDefined();
          expect(auditCall!.sql).toContain("'edit'");
          expect(auditCall!.bindArgs).toContain(draftPost.source);
          expect(auditCall!.bindArgs).toContain(draftPost.slug);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('every action produces exactly one audit log entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        fc.constantFrom('approve', 'reject'),
        async (draftPost, action) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action },
            db,
          });

          await PATCH(ctx);

          // Count INSERT INTO agent_audit calls
          const auditCalls = db.calls.filter(
            c => c.sql.includes('INSERT INTO agent_audit')
          );
          expect(auditCalls.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 16: Trust score consistency', () => {
  /**
   * **Validates: Requirements AGP-021**
   *
   * For any agent, total_submitted == approved + rejected + pending.
   * The approve action increments total_approved, reject increments total_rejected.
   * This verifies the stats UPDATE SQL is correct for maintaining consistency.
   */
  it('approve → agent_stats total_approved incremented for correct agent_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'approve' },
            db,
          });

          await PATCH(ctx);

          // Find the UPDATE agent_stats call
          const statsCall = db.calls.find(
            c => c.sql.includes('UPDATE agent_stats') && c.sql.includes('total_approved')
          );
          expect(statsCall).toBeDefined();

          // Verify it increments total_approved by 1
          expect(statsCall!.sql).toContain('total_approved = total_approved + 1');

          // Verify it targets the correct agent_id
          expect(statsCall!.bindArgs).toContain(draftPost.source);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reject → agent_stats total_rejected incremented for correct agent_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        async (draftPost) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action: 'reject' },
            db,
          });

          await PATCH(ctx);

          // Find the UPDATE agent_stats call
          const statsCall = db.calls.find(
            c => c.sql.includes('UPDATE agent_stats') && c.sql.includes('total_rejected')
          );
          expect(statsCall).toBeDefined();

          // Verify it increments total_rejected by 1
          expect(statsCall!.sql).toContain('total_rejected = total_rejected + 1');

          // Verify it targets the correct agent_id
          expect(statsCall!.bindArgs).toContain(draftPost.source);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('approve and reject update different counters (never both)', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        fc.constantFrom('approve', 'reject'),
        async (draftPost, action) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action },
            db,
          });

          await PATCH(ctx);

          const statsCalls = db.calls.filter(
            c => c.sql.includes('UPDATE agent_stats')
          );

          // Exactly one stats update per action
          expect(statsCalls.length).toBe(1);

          if (action === 'approve') {
            expect(statsCalls[0].sql).toContain('total_approved');
            expect(statsCalls[0].sql).not.toContain('total_rejected');
          } else {
            expect(statsCalls[0].sql).toContain('total_rejected');
            expect(statsCalls[0].sql).not.toContain('total_approved');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stats update always targets the same agent_id as the draft source', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftPostArb(),
        fc.constantFrom('approve', 'reject'),
        async (draftPost, action) => {
          const db = createTrackingDb(draftPost);
          const ctx = createPatchContext({
            slug: draftPost.slug,
            body: { action },
            db,
          });

          await PATCH(ctx);

          const statsCall = db.calls.find(
            c => c.sql.includes('UPDATE agent_stats')
          );
          expect(statsCall).toBeDefined();

          // The WHERE clause binds agent_id = source
          expect(statsCall!.bindArgs).toContain(draftPost.source);
        }
      ),
      { numRuns: 100 }
    );
  });
});
