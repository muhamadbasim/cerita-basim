import type { APIContext } from 'astro';
import { getDB, execute, queryFirst } from '@/lib/db';
import { getKV, checkRateLimit } from '@/lib/kv';
import { verifyTurnstile } from '@/lib/turnstile';
import { hashEmail } from '@/lib/crypto';
import { generateToken } from '@/lib/crypto';
import { sendEmail, confirmationEmail } from '@/lib/resend';

export const prerender = false;

// POST /api/subscribe
export async function POST({ request, locals }: APIContext) {
  const env = locals.runtime.env;

  let body: { email: string; source?: string; turnstile_token: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, source, turnstile_token } = body;

  if (!email || !turnstile_token) {
    return new Response(JSON.stringify({ error: 'Missing required fields: email, turnstile_token' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify Turnstile
  const turnstileResult = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET);
  if (!turnstileResult.success) {
    return new Response(JSON.stringify({ error: 'verification_failed' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Rate limit: 3 subscribes per 10 minutes per IP
  const kv = getKV(locals);
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ipHash = await hashEmail(ip, 'rate-limit-salt');
  const rateCheck = await checkRateLimit(kv, `ratelimit:subscribe:${ipHash}`, 3, 600);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited', retry_after: 600 }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDB(locals);

  // Check if already subscribed
  const existing = await queryFirst<{ status: string }>(db, `SELECT status FROM subscribers WHERE email = ?`, [email.toLowerCase().trim()]);

  if (existing) {
    if (existing.status === 'active') {
      return new Response(JSON.stringify({ status: 'already_active', message: 'Email ini sudah berlangganan.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (existing.status === 'unconfirmed') {
      // Resend confirmation
      return new Response(JSON.stringify({ status: 'unconfirmed', message: 'Email konfirmasi sudah dikirim sebelumnya. Cek inbox kamu.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // If unsubscribed, allow re-subscribe
  }

  // Generate tokens
  const confirmTok = generateToken();
  const unsubTok = generateToken();

  if (existing) {
    // Re-subscribe (was unsubscribed)
    await execute(
      db,
      `UPDATE subscribers SET status = 'unconfirmed', confirm_tok = ?, unsub_tok = ?, source = ?, created_at = ? WHERE email = ?`,
      [confirmTok, unsubTok, source || 'subscribe_page', Date.now(), email.toLowerCase().trim()]
    );
  } else {
    await execute(
      db,
      `INSERT INTO subscribers (email, status, confirm_tok, unsub_tok, source) VALUES (?, 'unconfirmed', ?, ?, ?)`,
      [email.toLowerCase().trim(), confirmTok, unsubTok, source || 'subscribe_page']
    );
  }

  // Send confirmation email
  const siteUrl = env.SITE_URL || 'https://cerita.basim.id';
  const fromAddr = env.EMAIL_FROM || 'Cerita Basim <onboarding@resend.dev>';
  const { subject, text } = confirmationEmail(siteUrl, confirmTok);
  await sendEmail(env.RESEND_API_KEY, fromAddr, { to: email, subject, text });

  return new Response(JSON.stringify({ status: 'unconfirmed', message: 'Cek email kamu untuk konfirmasi.' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
}
