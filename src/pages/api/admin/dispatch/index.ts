import type { APIContext } from 'astro';
import { getDB, execute, queryAll, queryFirst } from '@/lib/db';
import { requireAdmin } from '@/lib/access';
import { sendEmail, newsletterEmail } from '@/lib/resend';
import { getCollection } from 'astro:content';

export const prerender = false;

// POST /api/admin/dispatch — trigger newsletter for a post
export async function POST({ request, locals }: APIContext) {
  const env = locals.runtime.env;

  const authError = await requireAdmin(request, env.ADMIN_EMAIL, env.ADMIN_TOKEN);
  if (authError) return authError;

  let body: { post_slug: string; intro?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!body.post_slug) {
    return new Response(JSON.stringify({ error: 'Missing post_slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get post info
  const posts = await getCollection('posts');
  const post = posts.find(p => p.slug === body.post_slug);
  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDB(locals);

  // Count active subscribers
  const countResult = await queryFirst<{ cnt: number }>(db, `SELECT COUNT(*) as cnt FROM subscribers WHERE status = 'active'`, []);
  const total = countResult?.cnt || 0;

  if (total === 0) {
    return new Response(JSON.stringify({ error: 'No active subscribers' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Create dispatch record
  await execute(
    db,
    `INSERT INTO dispatches (post_slug, status, total) VALUES (?, 'sending', ?)`,
    [body.post_slug, total]
  );

  const dispatch = await queryFirst<{ id: number }>(db, `SELECT id FROM dispatches ORDER BY id DESC LIMIT 1`, []);
  const dispatchId = dispatch!.id;

  // Send emails in batches
  const siteUrl = env.SITE_URL || 'https://cerita.basim.id';
  const subscribers = await queryAll<{ id: number; email: string; unsub_tok: string }>(
    db,
    `SELECT id, email, unsub_tok FROM subscribers WHERE status = 'active' ORDER BY id ASC`,
    []
  );

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const { subject, text } = newsletterEmail(
      siteUrl,
      { title: post.data.title, description: post.data.description, slug: post.slug },
      sub.unsub_tok,
      body.intro
    );

    const result = await sendEmail(env.RESEND_API_KEY, env.EMAIL_FROM || 'Cerita Basim <onboarding@resend.dev>', {
      to: sub.email,
      subject,
      text,
    });

    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    // Update progress
    await execute(
      db,
      `UPDATE dispatches SET sent = ?, failed = ?, cursor_id = ? WHERE id = ?`,
      [sent, failed, sub.id, dispatchId]
    );
  }

  // Mark complete
  const finalStatus = failed === 0 ? 'sent' : (sent > 0 ? 'sent' : 'failed');
  await execute(db, `UPDATE dispatches SET status = ? WHERE id = ?`, [finalStatus, dispatchId]);

  return new Response(JSON.stringify({ dispatch_id: dispatchId, status: finalStatus, sent, failed, total }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}
