/**
 * Simple heuristic spam filter for comments.
 * Returns true if content looks like spam.
 */

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const REPEATED_CHARS = /(.)\1{9,}/; // 10+ same char in a row
const BLACKLIST = [
  'buy now', 'click here', 'free money', 'no credit check',
  'instant approval', 'act now', 'limited time', 'congratulations you won',
  'nigerian prince', 'bitcoin doubler', 'earn from home',
];

export function isSpam(body: string): { spam: boolean; reason?: string } {
  const lower = body.toLowerCase();

  // Check URL count
  const urls = body.match(URL_REGEX) || [];
  if (urls.length >= 3) {
    return { spam: true, reason: '3+ URLs detected' };
  }

  // Check repeated characters
  if (REPEATED_CHARS.test(body)) {
    return { spam: true, reason: 'Excessive repeated characters' };
  }

  // Check blacklist phrases
  for (const phrase of BLACKLIST) {
    if (lower.includes(phrase)) {
      return { spam: true, reason: `Blacklisted phrase: "${phrase}"` };
    }
  }

  // Check if mostly uppercase (>70% and >20 chars)
  if (body.length > 20) {
    const upperCount = (body.match(/[A-Z]/g) || []).length;
    const letterCount = (body.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 0 && upperCount / letterCount > 0.7) {
      return { spam: true, reason: 'Excessive uppercase' };
    }
  }

  return { spam: false };
}
