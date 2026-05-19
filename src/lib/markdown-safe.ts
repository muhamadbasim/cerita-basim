/**
 * Safe markdown renderer for agent-submitted content.
 * Uses unified/remark/rehype pipeline with strict sanitization.
 * - Strips all raw HTML tags (script, iframe, div, span, etc.)
 * - Only allows: h2-h4, p, a, strong, em, code, pre, ul, ol, li, blockquote, img, br, hr
 * - Enforces image domain whitelist
 * - Non-whitelisted images → placeholder with link text
 *
 * Requirements: AGP-060, AGP-062
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { defaultSchema } from 'hast-util-sanitize';
import type { Root, Element, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

/** Whitelisted image domains */
const ALLOWED_IMAGE_DOMAINS: Array<string | RegExp> = [
  'cerita.basim.id',
  /^.+\.r2\.cloudflarestorage\.com$/,
  'imagedelivery.net',
];

/** Sanitization schema — only allow safe markdown-generated tags */
const agentSchema = {
  ...defaultSchema,
  tagNames: [
    'h2', 'h3', 'h4',
    'p', 'a', 'strong', 'em',
    'code', 'pre',
    'ul', 'ol', 'li',
    'blockquote',
    'img', 'br', 'hr',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    code: ['className'],
  },
};

/**
 * Check if a given hostname is in the image domain whitelist.
 */
function isImageDomainAllowed(hostname: string): boolean {
  for (const domain of ALLOWED_IMAGE_DOMAINS) {
    if (typeof domain === 'string') {
      if (hostname === domain) return true;
    } else {
      if (domain.test(hostname)) return true;
    }
  }
  return false;
}

/**
 * Extract hostname from a URL string. Returns empty string on failure.
 */
function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return '';
  }
}

/**
 * Create a rehype plugin that enforces image domain whitelist.
 * Non-whitelisted images are replaced with a placeholder paragraph containing a link.
 * Collects warnings into the provided array.
 */
function createImageWhitelistPlugin(linkWarnings: string[]) {
  return () => (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'img' || index === undefined || !parent) return;

      const src = (node.properties?.src as string) || '';
      const alt = (node.properties?.alt as string) || 'image';

      if (!src) return;

      const hostname = extractHostname(src);

      if (!hostname || !isImageDomainAllowed(hostname)) {
        linkWarnings.push(src);

        // Replace img with a placeholder: <p>[Image: <a href="src">alt text</a>]</p>
        const linkNode: Element = {
          type: 'element',
          tagName: 'a',
          properties: { href: src, title: alt },
          children: [{ type: 'text', value: alt || src }],
        };

        const placeholder: Element = {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: '[Image: ' },
            linkNode,
            { type: 'text', value: ']' },
          ],
        };

        (parent.children as ElementContent[])[index] = placeholder;
      }
    });
  };
}

export interface AgentMarkdownResult {
  html: string;
  linkWarnings: string[];
}

/**
 * Render agent-submitted markdown to safe HTML.
 * Strips all raw HTML, enforces tag whitelist, and validates image domains.
 *
 * @param md - Raw markdown string from agent
 * @returns Object with sanitized HTML and array of non-whitelisted image URLs
 */
export async function renderAgentMarkdown(md: string): Promise<AgentMarkdownResult> {
  const linkWarnings: string[] = [];

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, agentSchema)
    .use(createImageWhitelistPlugin(linkWarnings))
    .use(rehypeStringify)
    .process(md);

  return {
    html: String(file),
    linkWarnings,
  };
}
