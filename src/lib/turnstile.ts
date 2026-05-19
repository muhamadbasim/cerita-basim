/**
 * Cloudflare Turnstile verification.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip?: string
): Promise<{ success: boolean; error?: string }> {
  if (!secret) {
    // Dev mode: skip verification if no secret configured
    return { success: true };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    ...(ip && { remoteip: ip }),
  });

  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };

  if (!data.success) {
    return {
      success: false,
      error: data['error-codes']?.join(', ') || 'verification_failed',
    };
  }

  return { success: true };
}
