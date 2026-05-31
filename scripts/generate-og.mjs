#!/usr/bin/env node
/**
 * generate-og.mjs — Static Open Graph image generator for Cerita Basim.
 *
 * Renders 1200x630 PNG social cards from the brand palette using sharp's
 * SVG rasterizer. Output is written to `public/og/` and a guaranteed
 * fallback `public/og-default.png`. These are committed and served as
 * static assets — no runtime/Workers image generation involved.
 *
 * Usage:
 *   bun run og        # or: node scripts/generate-og.mjs
 *
 * Re-run after adding or renaming content (posts/projects) so each entry
 * gets its own card. BaseLayout always falls back to og-default.png, so a
 * missing per-post image never produces a broken preview.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src/content/posts');
const PROJECTS_DIR = join(ROOT, 'src/content/projects');
const OUT_DIR = join(ROOT, 'public/og');

// Brand palette (mirrors src/styles/global.css light theme)
const C = {
  bg: '#f6f1e7',
  bg2: '#efe6d3',
  paper: '#fffaf0',
  ink: '#1b1410',
  ink2: '#4a3c33',
  ink3: '#7a695b',
  accent: '#c2410c',
  accentDeep: '#7a2607',
  forest: '#1b3b2f',
  saffron: '#b58105',
  rule: '#e0d4bd',
};

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "'DM Sans', -apple-system, 'Segoe UI', sans-serif";

/** XML-escape text for safe SVG embedding. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Parse the leading YAML frontmatter block and return a flat key/value map. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    data[m[1]] = val;
  }
  return data;
}

/**
 * Greedy word-wrap tuned for the title type size. `max` is an approximate
 * character budget per line; long titles are clamped to `maxLines`.
 */
function wrapText(text, max, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const lastIdx = lines.length - 1;
    if (lines[lastIdx].length > max) {
      lines[lastIdx] = `${lines[lastIdx].slice(0, max - 1).trimEnd()}…`;
    }
  }
  return lines;
}

/**
 * Build the SVG markup for one card.
 * @param {{eyebrow?: string, title: string, meta?: string}} opts
 */
function buildSvg({ eyebrow = 'Cerita Basim', title, meta = 'cerita.basim.id' }) {
  const titleLines = wrapText(title, 26, 4);
  const titleSize = titleLines.length > 3 ? 64 : titleLines.length > 2 ? 74 : 84;
  const lineHeight = titleSize * 1.12;
  const titleStartY = 300 - ((titleLines.length - 1) * lineHeight) / 2;

  const titleTspans = titleLines
    .map(
      (l, i) =>
        `<text x="90" y="${titleStartY + i * lineHeight}" font-family="${SERIF}" font-size="${titleSize}" font-weight="700" fill="${C.ink}" letter-spacing="-1">${esc(l)}</text>`,
    )
    .join('\n      ');

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg}"/>
      <stop offset="1" stop-color="${C.bg2}"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.accent}"/>
      <stop offset="1" stop-color="${C.accentDeep}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1080" cy="120" r="240" fill="${C.accent}" opacity="0.06"/>
  <circle cx="1140" cy="560" r="180" fill="${C.forest}" opacity="0.06"/>

  <rect x="0" y="0" width="14" height="630" fill="${C.accent}"/>

  <!-- Brand row -->
  <g transform="translate(90, 80)">
    <rect x="0" y="-34" width="56" height="56" rx="14" fill="url(#mark)"/>
    <text x="28" y="6" font-family="${SERIF}" font-size="30" font-weight="800" fill="#fffaf0" text-anchor="middle">cb</text>
    <text x="74" y="-6" font-family="${SERIF}" font-size="27" font-weight="700" fill="${C.ink}">Cerita Basim</text>
    <text x="74" y="20" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.ink3}" letter-spacing="1">KARYA, CERITA, &amp; PEMBACA</text>
  </g>

  <!-- Eyebrow -->
  <text x="90" y="${titleStartY - 70}" font-family="${SANS}" font-size="22" font-weight="700" fill="${C.accent}" letter-spacing="3">${esc(eyebrow.toUpperCase())}</text>

  <!-- Title -->
  ${titleTspans}

  <!-- Footer -->
  <line x1="90" y1="540" x2="1110" y2="540" stroke="${C.rule}" stroke-width="2"/>
  <text x="90" y="582" font-family="${SANS}" font-size="24" font-weight="600" fill="${C.ink2}">${esc(meta)}</text>
  <text x="1110" y="582" font-family="${SANS}" font-size="22" font-weight="500" fill="${C.ink3}" text-anchor="end">Astro × Cloudflare · gratis selamanya</text>
</svg>`;
}

async function renderCard(outPath, opts) {
  const svg = buildSvg(opts);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`  ✓ ${outPath.replace(ROOT + '/', '')}`);
}

async function readContentEntries(dir, eyebrowFallback) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith('.md') || f.endsWith('.mdx'),
  );
  const entries = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    const fm = parseFrontmatter(raw);
    const slug = file.replace(/\.mdx?$/, '');
    const isDraft = fm.draft === 'true';
    if (isDraft) continue;
    entries.push({
      slug,
      title: fm.title || slug,
      eyebrow: fm.tagline || fm.category || eyebrowFallback,
    });
  }
  return entries;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Generating Open Graph cards...');

  // Default fallback — used by every page without a specific card.
  await renderCard(join(ROOT, 'public/og-default.png'), {
    eyebrow: 'Portofolio & Cerita',
    title: 'Karya, cerita, & pembaca.',
    meta: 'cerita.basim.id',
  });

  const posts = await readContentEntries(POSTS_DIR, 'Cerita');
  for (const p of posts) {
    await renderCard(join(OUT_DIR, `cerita-${p.slug}.png`), {
      eyebrow: 'Cerita',
      title: p.title,
      meta: `cerita.basim.id/cerita/${p.slug}`,
    });
  }

  const projects = await readContentEntries(PROJECTS_DIR, 'Karya');
  for (const p of projects) {
    await renderCard(join(OUT_DIR, `karya-${p.slug}.png`), {
      eyebrow: 'Karya',
      title: p.title,
      meta: `cerita.basim.id/karya/${p.slug}`,
    });
  }

  console.log(
    `Done. ${1 + posts.length + projects.length} card(s) written to public/og/.`,
  );
}

main().catch((err) => {
  console.error('OG generation failed:', err);
  process.exit(1);
});
