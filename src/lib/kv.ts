/**
 * Cloudflare KV helpers for reactions, rate-limiting, and caching.
 */

export function getKV(locals: App.Locals): KVNamespace {
  const kv = locals.runtime.env.KV;
  if (!kv) throw new Error('KV namespace binding not available');
  return kv;
}

// --- Reactions ---

export async function getReactionCounts(
  kv: KVNamespace,
  slug: string
): Promise<Record<string, number>> {
  const emojis = ['love', 'insightful', 'fire', 'thinking', 'applause'];
  const counts: Record<string, number> = {};
  await Promise.all(
    emojis.map(async (emoji) => {
      const val = await kv.get(`reactions:${slug}:${emoji}`);
      counts[emoji] = val ? parseInt(val, 10) : 0;
    })
  );
  return counts;
}

export async function toggleReaction(
  kv: KVNamespace,
  slug: string,
  emoji: string,
  fingerprint: string
): Promise<{ toggled: 'added' | 'removed'; count: number }> {
  const presenceKey = `reactions:${slug}:${fingerprint}:${emoji}`;
  const countKey = `reactions:${slug}:${emoji}`;

  const existing = await kv.get(presenceKey);

  if (existing) {
    // Remove
    await kv.delete(presenceKey);
    const current = parseInt((await kv.get(countKey)) || '0', 10);
    const newCount = Math.max(0, current - 1);
    await kv.put(countKey, String(newCount));
    return { toggled: 'removed', count: newCount };
  } else {
    // Add
    await kv.put(presenceKey, '1', { expirationTtl: 365 * 24 * 60 * 60 });
    const current = parseInt((await kv.get(countKey)) || '0', 10);
    const newCount = current + 1;
    await kv.put(countKey, String(newCount));
    return { toggled: 'added', count: newCount };
  }
}

// --- Rate limiting ---

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const current = parseInt((await kv.get(key)) || '0', 10);

  if (current >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return { allowed: true, remaining: maxRequests - current - 1 };
}

// --- Cache ---

export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const val = await kv.get(key);
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function setCache(
  kv: KVNamespace,
  key: string,
  data: unknown,
  ttlSeconds: number
): Promise<void> {
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
}
