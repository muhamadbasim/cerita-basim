/**
 * Safe markdown renderer for comments.
 * Only allows: bold, italic, links, inline code.
 * Strips everything else (images, headings, tables, raw HTML).
 */

export function renderCommentMarkdown(input: string): string {
  let html = escapeHtml(input);

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Links: [text](url) — only allow http/https
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" rel="nofollow noopener" target="_blank">$1</a>'
  );

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
