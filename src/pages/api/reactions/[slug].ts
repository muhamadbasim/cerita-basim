import type { APIContext } from 'astro';
import { getKV, getReactionCounts, toggleReaction } from '@/lib/kv';
import { fingerprint } from '@/lib/crypto';

export const prerender = false;

const VALID_EMOJIS = ['love', 'insightful', 'fire', 'thinking', 'applause'];

// GET /api/reactions/:slug
export async function GET({ params, locals }: APIContext) {
  const slug = params.slug;
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const kv = getKV(locals);
  const counts = await getReactionCounts(kv, slug);

  return new Response(JSON.stringify(counts), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' },
  });
}

// POST /api/reactions/:slug
export async function POST({ params, request, locals }: APIContext) {
  const slug = params.slug;
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: { emoji: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!body.emoji || !VALID_EMOJIS.includes(body.emoji)) {
    return new Response(JSON.stringify({ error: `Invalid emoji. Must be one of: ${VALID_EMOJIS.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate fingerprint from IP + UA
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const fp = fingerprint(ip, ua);

  const kv = getKV(locals);
  const result = await toggleReaction(kv, slug, body.emoji, fp);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}
