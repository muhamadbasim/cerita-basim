import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderAgentMarkdown } from './markdown-safe';

/**
 * Property-based tests for markdown-safe renderer.
 *
 * **Validates: Requirements AGP-060, AGP-062**
 */

/** Raw HTML tags that should NEVER appear in sanitized output */
const DANGEROUS_TAGS = [
  'script', 'iframe', 'div', 'span', 'style', 'form', 'input',
  'textarea', 'button', 'select', 'object', 'embed',
  'meta', 'link', 'base', 'svg', 'math', 'table', 'thead', 'tbody',
  'tr', 'td', 'th', 'video', 'audio', 'canvas', 'details', 'summary',
];

/** Domains that are NOT in the whitelist */
const NON_WHITELISTED_DOMAINS = [
  'evil.com',
  'malware.org',
  'phishing.net',
  'random-cdn.io',
  'images.unsplash.com',
  'i.imgur.com',
  'cdn.example.com',
  'storage.googleapis.com',
];

/** Domains that ARE in the whitelist */
const WHITELISTED_DOMAINS = [
  'cerita.basim.id',
  'bucket.r2.cloudflarestorage.com',
  'my-bucket.r2.cloudflarestorage.com',
  'imagedelivery.net',
];

/** Generate simple text content */
const textArb = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop '.split('')), minLength: min, maxLength: max });

describe('Property 14: Content sanitization — no raw HTML in output', () => {
  it('any raw HTML tag in markdown input → tag absent from output', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DANGEROUS_TAGS),
        textArb(5, 50),
        textArb(10, 50),
        async (tag, innerContent, surroundingText) => {
          const md = `${surroundingText}\n\n<${tag}>${innerContent}</${tag}>\n\n${surroundingText}`;
          const result = await renderAgentMarkdown(md);

          // The dangerous tag should NOT appear in the output
          const openTagRegex = new RegExp(`<${tag}[\\s>]`, 'i');
          expect(result.html).not.toMatch(openTagRegex);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('self-closing HTML tags are stripped from output', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom('script', 'iframe', 'embed', 'object', 'input', 'meta', 'link', 'base'),
        textArb(10, 50),
        async (tag, surroundingText) => {
          const md = `${surroundingText}\n\n<${tag} />\n\n${surroundingText}`;
          const result = await renderAgentMarkdown(md);

          const tagRegex = new RegExp(`<${tag}[\\s/>]`, 'i');
          expect(result.html).not.toMatch(tagRegex);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('HTML with attributes is stripped from output', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DANGEROUS_TAGS),
        fc.constantFrom('class', 'id', 'style', 'onclick', 'onload'),
        textArb(3, 20),
        textArb(5, 30),
        async (tag, attr, attrValue, content) => {
          const md = `text before\n\n<${tag} ${attr}="${attrValue}">${content}</${tag}>\n\ntext after`;
          const result = await renderAgentMarkdown(md);

          const openTagRegex = new RegExp(`<${tag}[\\s>]`, 'i');
          expect(result.html).not.toMatch(openTagRegex);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 15: Image domain whitelist enforcement', () => {
  it('non-whitelisted image src → no img tag with that src in output', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_WHITELISTED_DOMAINS),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop'.split('')), minLength: 3, maxLength: 20 }),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop'.split('')), minLength: 3, maxLength: 20 }),
        async (domain, path, altText) => {
          const imageUrl = `https://${domain}/${path}.png`;
          const md = `Some text before\n\n![${altText}](${imageUrl})\n\nSome text after`;
          const result = await renderAgentMarkdown(md);

          // Should NOT contain an img tag with the non-whitelisted src
          expect(result.html).not.toContain('<img');
          // The URL should be reported in linkWarnings
          expect(result.linkWarnings).toContain(imageUrl);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('whitelisted image src → img tag preserved in output', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...WHITELISTED_DOMAINS),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop'.split('')), minLength: 3, maxLength: 20 }),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop'.split('')), minLength: 3, maxLength: 20 }),
        async (domain, path, altText) => {
          const imageUrl = `https://${domain}/${path}.png`;
          const md = `Some text\n\n![${altText}](${imageUrl})\n\nMore text`;
          const result = await renderAgentMarkdown(md);

          // Should contain an img tag with the whitelisted src
          expect(result.html).toContain('<img');
          expect(result.html).toContain(imageUrl);
          // Should NOT be in linkWarnings
          expect(result.linkWarnings).not.toContain(imageUrl);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple non-whitelisted images → all replaced, all in linkWarnings', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom(...NON_WHITELISTED_DOMAINS),
          { minLength: 2, maxLength: 5 }
        ),
        async (domains) => {
          const images = domains.map((d, i) => `![img${i}](https://${d}/image${i}.png)`);
          const md = `# Title\n\n${images.join('\n\n')}\n\nEnd of content`;
          const result = await renderAgentMarkdown(md);

          // No img tags should be present
          expect(result.html).not.toContain('<img');
          // All URLs should be in linkWarnings
          for (let i = 0; i < domains.length; i++) {
            expect(result.linkWarnings).toContain(`https://${domains[i]}/image${i}.png`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
