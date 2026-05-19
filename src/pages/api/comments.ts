import type { APIContext } from 'astro';
import { getDB, queryAll, execute, queryFirst } from '@/lib/db';
import { getKV, checkRateLimit, getCached, setCache } from '@/lib/kv';
import { verifyTurnstile } from '@/lib/turnstile';
import { hashEmail, encryptEmail } from '@/lib/crypto';
import { isSpam } from '@/lib/spam';

export const prerender = false;

// GET /api/comments?post=<slug>
export async function GET({ request, locals }: APIContext) {
  const url = new URL(request.url);
  const postSlug = url.searchParams.get('post');
  if (!postSlug) {
    return new Response(JSON.stringify({ error: 'Missing ?post= parameter' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const db = getDB(locals);
    const kv = getKV(locals);
    const cacheKey = `cache:comments:${postSlug}`;

    // Try cache first
    const cached = await getCached<unknown[]>(kv, cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ comments: cached, count: cached.length, cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      });
    }

    const comments = await queryAll(
      db,
      `SELECT id, post_slug, parent_id, display_name, body_md, created_at, approved_at
       FROM comments WHERE post_slug = ? AND status = 'approved' ORDER BY created_at ASC`,
      [postSlug]
    );

    // Cache for 30s
    await setCache(kv, cacheKey, comments, 30).catch(() => {});

    return new Response(JSON.stringify({ comments, count: comments.length, cached: false }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'server_error', detail: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// POST /api/comments
export async function POST({ request, locals }: APIContext) {
  const env = locals.runtime.env;

  // Parse body
  let body: { post: string; name: string; email: string; body: string; parent_id?: number; turnstile_token: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { post, name, email, body: commentBody, parent_id, turnstile_token } = body;

  // Validate required fields
  if (!post || !name || !email || !commentBody || !turnstile_token) {
    return new Response(JSON.stringify({ error: 'Missing required fields: post, name, email, body, turnstile_token' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (commentBody.length > 2000) {
    return new Response(JSON.stringify({ error: 'Comment body exceeds 2000 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (name.length > 100) {
    return new Response(JSON.stringify({ error: 'Name exceeds 100 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify Turnstile
  const turnstileResult = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET);
  if (!turnstileResult.success) {
    return new Response(JSON.stringify({ error: 'verification_failed', detail: turnstileResult.error }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Rate limit: 5 comments per minute per IP
  const kv = getKV(locals);
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ipHash = await hashEmail(ip, 'rate-limit-salt');
  const rateKey = `ratelimit:comment:${ipHash}`;
  const rateCheck = await checkRateLimit(kv, rateKey, 5, 60);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited', retry_after: 60 }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  // Spam check
  const spamResult = isSpam(commentBody);
  if (spamResult.spam) {
    // Still save but mark as spam
    const db = getDB(locals);
    const emailHash = await hashEmail(email, env.ENCRYPTION_SALT);
    const emailEnc = await encryptEmail(email, env.ENCRYPTION_KEY);
    await execute(
      db,
      `INSERT INTO comments (post_slug, parent_id, display_name, email_hash, email_enc, body_md, status, ip_hash, ua_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'spam', ?, ?)`,
      [post, parent_id || null, name, emailHash, emailEnc, commentBody, ipHash, request.headers.get('user-agent') || '']
    );
    // Return as if pending (don't reveal spam detection)
    return new Response(JSON.stringify({ status: 'pending', message: 'Komentar kamu menunggu moderasi.' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  // Hash and encrypt email
  const db = getDB(locals);
  const emailHash = await hashEmail(email, env.ENCRYPTION_SALT);
  const emailEnc = await encryptEmail(email, env.ENCRYPTION_KEY);

  // Check if email is trusted
  const trusted = await queryFirst(db, `SELECT email_hash FROM trusted_emails WHERE email_hash = ?`, [emailHash]);
  const status = trusted ? 'approved' : 'pending';
  const approvedAt = trusted ? Date.now() : null;

  await execute(
    db,
    `INSERT INTO comments (post_slug, parent_id, display_name, email_hash, email_enc, body_md, status, ip_hash, ua_hash, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [post, parent_id || null, name, emailHash, emailEnc, commentBody, status, ipHash, request.headers.get('user-agent') || '', approvedAt]
  );

  // Invalidate cache if auto-approved
  if (status === 'approved') {
    const cacheKey = `cache:comments:${post}`;
    await kv.delete(cacheKey);
  }

  const message = status === 'approved'
    ? 'Komentar berhasil ditambahkan.'
    : 'Komentar kamu menunggu moderasi.';

  return new Response(JSON.stringify({ status, message }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
