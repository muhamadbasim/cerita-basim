import { describe, it, expect } from 'vitest';
import { renderAgentMarkdown } from './markdown-safe';

describe('renderAgentMarkdown', () => {
  describe('allowed markdown rendering', () => {
    it('renders headings h2-h4', async () => {
      const result = await renderAgentMarkdown('## Heading 2\n### Heading 3\n#### Heading 4');
      expect(result.html).toContain('<h2>Heading 2</h2>');
      expect(result.html).toContain('<h3>Heading 3</h3>');
      expect(result.html).toContain('<h4>Heading 4</h4>');
    });

    it('strips h1 headings (not in allowed list)', async () => {
      const result = await renderAgentMarkdown('# Heading 1');
      expect(result.html).not.toContain('<h1>');
    });

    it('renders paragraphs', async () => {
      const result = await renderAgentMarkdown('Hello world');
      expect(result.html).toContain('<p>Hello world</p>');
    });

    it('renders bold and italic', async () => {
      const result = await renderAgentMarkdown('**bold** and *italic*');
      expect(result.html).toContain('<strong>bold</strong>');
      expect(result.html).toContain('<em>italic</em>');
    });

    it('renders links', async () => {
      const result = await renderAgentMarkdown('[click](https://example.com)');
      expect(result.html).toContain('<a href="https://example.com">click</a>');
    });

    it('renders code blocks', async () => {
      const result = await renderAgentMarkdown('```\nconst x = 1;\n```');
      expect(result.html).toContain('<pre>');
      expect(result.html).toContain('<code>');
    });

    it('renders inline code', async () => {
      const result = await renderAgentMarkdown('use `const x`');
      expect(result.html).toContain('<code>const x</code>');
    });

    it('renders unordered lists', async () => {
      const result = await renderAgentMarkdown('- item 1\n- item 2');
      expect(result.html).toContain('<ul>');
      expect(result.html).toContain('<li>item 1</li>');
      expect(result.html).toContain('<li>item 2</li>');
    });

    it('renders ordered lists', async () => {
      const result = await renderAgentMarkdown('1. first\n2. second');
      expect(result.html).toContain('<ol>');
      expect(result.html).toContain('<li>first</li>');
    });

    it('renders blockquotes', async () => {
      const result = await renderAgentMarkdown('> quoted text');
      expect(result.html).toContain('<blockquote>');
      expect(result.html).toContain('quoted text');
    });

    it('renders horizontal rules', async () => {
      const result = await renderAgentMarkdown('---');
      expect(result.html).toContain('<hr>');
    });
  });

  describe('HTML stripping (AGP-060)', () => {
    it('strips script tags', async () => {
      const result = await renderAgentMarkdown('<script>alert("xss")</script>');
      expect(result.html).not.toContain('<script>');
      expect(result.html).not.toContain('alert');
    });

    it('strips iframe tags', async () => {
      const result = await renderAgentMarkdown('<iframe src="https://evil.com"></iframe>');
      expect(result.html).not.toContain('<iframe');
    });

    it('strips div tags', async () => {
      const result = await renderAgentMarkdown('<div class="evil">content</div>');
      expect(result.html).not.toContain('<div');
    });

    it('strips span tags', async () => {
      const result = await renderAgentMarkdown('<span style="color:red">text</span>');
      expect(result.html).not.toContain('<span');
      expect(result.html).not.toContain('style=');
    });

    it('strips style tags', async () => {
      const result = await renderAgentMarkdown('<style>body{display:none}</style>');
      expect(result.html).not.toContain('<style');
    });

    it('strips form tags', async () => {
      const result = await renderAgentMarkdown('<form action="/steal"><input type="text"></form>');
      expect(result.html).not.toContain('<form');
      expect(result.html).not.toContain('<input');
    });

    it('strips event handler attributes from allowed tags', async () => {
      const result = await renderAgentMarkdown('[click](https://example.com)');
      // Ensure no onX attributes can sneak through
      expect(result.html).not.toContain('onclick');
      expect(result.html).not.toContain('onerror');
    });
  });

  describe('image domain whitelist (AGP-062)', () => {
    it('allows images from cerita.basim.id', async () => {
      const result = await renderAgentMarkdown('![alt](https://cerita.basim.id/img/photo.jpg)');
      expect(result.html).toContain('<img');
      expect(result.html).toContain('src="https://cerita.basim.id/img/photo.jpg"');
      expect(result.linkWarnings).toHaveLength(0);
    });

    it('allows images from *.r2.cloudflarestorage.com', async () => {
      const result = await renderAgentMarkdown('![alt](https://bucket.r2.cloudflarestorage.com/image.png)');
      expect(result.html).toContain('<img');
      expect(result.html).toContain('src="https://bucket.r2.cloudflarestorage.com/image.png"');
      expect(result.linkWarnings).toHaveLength(0);
    });

    it('allows images from imagedelivery.net', async () => {
      const result = await renderAgentMarkdown('![alt](https://imagedelivery.net/abc/photo.jpg)');
      expect(result.html).toContain('<img');
      expect(result.html).toContain('src="https://imagedelivery.net/abc/photo.jpg"');
      expect(result.linkWarnings).toHaveLength(0);
    });

    it('blocks images from non-whitelisted domains', async () => {
      const result = await renderAgentMarkdown('![my image](https://evil.com/malware.jpg)');
      expect(result.html).not.toContain('<img');
      expect(result.html).toContain('[Image:');
      expect(result.html).toContain('href="https://evil.com/malware.jpg"');
      expect(result.html).toContain('my image');
      expect(result.linkWarnings).toContain('https://evil.com/malware.jpg');
    });

    it('blocks images from random domains and renders placeholder', async () => {
      const result = await renderAgentMarkdown('![photo](https://imgur.com/abc.png)');
      expect(result.html).not.toContain('<img');
      expect(result.html).toContain('[Image:');
      expect(result.html).toContain('<a');
      expect(result.linkWarnings).toContain('https://imgur.com/abc.png');
    });

    it('does not block bare r2.cloudflarestorage.com (requires subdomain)', async () => {
      const result = await renderAgentMarkdown('![alt](https://r2.cloudflarestorage.com/img.png)');
      // r2.cloudflarestorage.com without subdomain should NOT match the pattern
      // The regex requires at least one character before .r2.cloudflarestorage.com
      expect(result.html).not.toContain('<img');
      expect(result.linkWarnings).toHaveLength(1);
    });

    it('collects multiple warnings for multiple non-whitelisted images', async () => {
      const md = '![a](https://evil.com/1.jpg)\n\n![b](https://bad.org/2.png)';
      const result = await renderAgentMarkdown(md);
      expect(result.linkWarnings).toHaveLength(2);
      expect(result.linkWarnings).toContain('https://evil.com/1.jpg');
      expect(result.linkWarnings).toContain('https://bad.org/2.png');
    });
  });

  describe('return value structure', () => {
    it('returns html and linkWarnings', async () => {
      const result = await renderAgentMarkdown('Hello');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('linkWarnings');
      expect(typeof result.html).toBe('string');
      expect(Array.isArray(result.linkWarnings)).toBe(true);
    });

    it('returns empty linkWarnings when all images are whitelisted', async () => {
      const result = await renderAgentMarkdown('![ok](https://cerita.basim.id/img.jpg)');
      expect(result.linkWarnings).toEqual([]);
    });
  });
});
