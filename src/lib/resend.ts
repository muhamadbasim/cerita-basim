/**
 * Email sending via Resend API.
 * Plain-text dominant, no tracking pixel.
 */

const RESEND_API = 'https://api.resend.com/emails';

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export async function sendEmail(
  apiKey: string,
  from: string,
  options: SendEmailOptions
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!apiKey) {
    console.warn('[resend] No API key — email not sent:', options.subject);
    return { success: false, error: 'no_api_key' };
  }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      ...(options.html && { html: options.html }),
      ...(options.replyTo && { reply_to: options.replyTo }),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[resend] Send failed:', res.status, err);
    return { success: false, error: `${res.status}: ${err}` };
  }

  const data = (await res.json()) as { id: string };
  return { success: true, id: data.id };
}

// --- Email templates ---

export function confirmationEmail(siteUrl: string, token: string): { subject: string; text: string } {
  return {
    subject: 'Konfirmasi langganan Cerita Basim',
    text: `Halo,

Terima kasih sudah berlangganan Cerita Basim.

Klik link di bawah untuk mengkonfirmasi email kamu:
${siteUrl}/api/subscribe/confirm?token=${token}

Link ini valid selama 7 hari.

Kalau kamu tidak merasa mendaftar, abaikan email ini.

—
Cerita Basim
${siteUrl}`,
  };
}

export function newsletterEmail(
  siteUrl: string,
  post: { title: string; description: string; slug: string },
  unsubToken: string,
  intro?: string
): { subject: string; text: string } {
  return {
    subject: `📬 Cerita baru: ${post.title}`,
    text: `${intro ? intro + '\n\n---\n\n' : ''}${post.title}

${post.description}

Baca selengkapnya:
${siteUrl}/cerita/${post.slug}

---

Kamu menerima email ini karena berlangganan di ${siteUrl}.
Berhenti berlangganan: ${siteUrl}/api/subscribe/unsubscribe?token=${unsubToken}`,
  };
}
