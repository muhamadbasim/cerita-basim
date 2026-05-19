# Cerita Basim

> Portofolio karya & cerita panjang — bebas algoritma, gratis selamanya.

**Domain:** [cerita.basim.id](https://cerita.basim.id)
**Stack:** Astro 5 × Cloudflare (Pages + D1 + KV + Workers + R2)
**Status:** Implementasi awal — scaffold + lib + content seeded

---

## Apa ini?

Cerita Basim adalah personal site yang menggabungkan:
- **Portfolio project** (case study karya yang sudah dikerjakan)
- **Blog editorial** (cerita panjang, catatan teknis, esai karier)
- **Komentar threaded** (dimoderasi, markdown ringan)
- **Reaksi emoji** (anonim, toggle)
- **Newsletter** (double opt-in, plain text, via Resend)
- **Admin panel** (moderasi, subscriber, dispatch newsletter)

Semua berjalan di Cloudflare free tier. Biaya operasional: **$0/bulan**.

---

## Struktur folder

```
cerita-basim/
├── astro.config.mjs          # Astro + Cloudflare adapter config
├── wrangler.toml              # Cloudflare bindings (D1, KV, R2)
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript strict + path aliases
├── .gitignore
├── .dev.vars.example          # Local dev secrets template
├── public/
│   ├── favicon.svg            # "cb" monogram
│   └── robots.txt
├── migrations/
│   └── 0001_init.sql          # D1 schema (comments, subscribers, dispatches)
├── src/
│   ├── env.d.ts               # Cloudflare runtime type bindings
│   ├── content/
│   │   ├── config.ts          # Content collection schemas (posts + projects)
│   │   ├── posts/             # Blog markdown (.mdx)
│   │   └── projects/          # Portfolio markdown (.mdx)
│   ├── components/
│   │   ├── layout/            # Header, Footer, ThemeToggle
│   │   ├── post/              # ReadingProgress, TOC, CommentList, ReactionBar
│   │   ├── project/           # ProjectCard, ProjectFilter
│   │   ├── newsletter/        # SubscribeForm
│   │   └── admin/             # ModerationQueue, DispatchPanel
│   ├── pages/
│   │   ├── index.astro        # Home
│   │   ├── karya/             # /karya, /karya/[slug]
│   │   ├── cerita/            # /cerita, /cerita/[slug]
│   │   ├── subscribe/         # /subscribe, /subscribe/thanks
│   │   ├── admin/             # /admin/*, protected by CF Access
│   │   └── api/               # Serverless endpoints (Workers)
│   ├── lib/
│   │   ├── db.ts              # D1 query helpers
│   │   ├── kv.ts              # KV reactions + rate-limit + cache
│   │   ├── crypto.ts          # SHA-256 hash + AES-GCM encrypt/decrypt
│   │   ├── turnstile.ts       # Cloudflare Turnstile verification
│   │   ├── spam.ts            # Heuristic spam filter
│   │   ├── resend.ts          # Email sender + templates
│   │   ├── markdown.ts        # Safe comment markdown renderer
│   │   └── access.ts          # CF Access JWT verification
│   └── styles/
│       └── global.css         # Design tokens + reset + typography
├── workers/
│   └── (cron-backup.ts)       # Weekly D1 → R2 backup (TODO)
└── documents/                 # Prototype HTML files (visual reference)
```

---

## Quick start

```bash
# 1. Install dependencies
bun install

# 2. Copy secrets template
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your actual keys

# 3. Create D1 database (first time only)
wrangler d1 create cerita-basim-db
# Copy the database_id to wrangler.toml

# 4. Run migrations
bun run db:migrate:local

# 5. Start dev server
bun run dev
# → http://localhost:4321
```

---

## API endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/comments?post=` | GET | — | List approved comments |
| `/api/comments` | POST | Turnstile | Submit comment |
| `/api/reactions/[slug]` | GET | — | Get reaction counts |
| `/api/reactions/[slug]` | POST | — | Toggle reaction |
| `/api/subscribe` | POST | Turnstile | Subscribe email |
| `/api/subscribe/confirm?token=` | GET | token | Confirm double opt-in |
| `/api/subscribe/unsubscribe?token=` | GET | token | One-click unsub |
| `/api/admin/comments?status=` | GET | CF Access | Moderation queue |
| `/api/admin/comments/[id]` | PATCH | CF Access | Approve/reject/spam |
| `/api/admin/dispatch` | POST | CF Access | Trigger newsletter |
| `/api/admin/dispatch/[id]` | GET | CF Access | Poll progress |

---

## Deploy

```bash
# Build
bun run build

# Deploy to Cloudflare Pages
wrangler pages deploy dist/

# Or connect GitHub repo to Pages for auto-deploy on push
```

---

## Design reference

Prototype HTML files di `documents/` folder bisa dibuka di browser sebagai visual reference:
- `documents/ScreenIndex_CeritaBasim_2026-05-19.html` — navigation hub (14 screens)
- `documents/DesignSystem_CeritaBasim_2026-05-19.html` — tokens, components, typography

---

## Spec & requirements

Kiro spec lengkap di `~/.kiro/specs/cerita-basim/`:
- `requirements.md` — 46 requirements EARS format
- `design.md` — architecture, data models, flows, testing strategy

---

## Brand

- **Nama:** Cerita Basim
- **Tagline:** "Karya, cerita, & pembaca."
- **Palette:** sand #f6f1e7, ink #1b1410, terracotta #c2410c, forest #1b3b2f, saffron #b58105
- **Typography:** Fraunces (display) + DM Sans (body) + JetBrains Mono (code)
- **Direction:** Editorial Indonesian-warm

---

## TODO (implementation remaining)

- [ ] Layout components (Header.astro, Footer.astro, ThemeToggle.astro)
- [ ] Page templates (index, karya/index, karya/[slug], cerita/index, cerita/[slug], tentang, subscribe, 404)
- [ ] Admin pages (dashboard, moderation, subscribers, dispatch)
- [ ] API endpoint implementations (comments, reactions, subscribe, admin)
- [ ] RSS feed (`/rss.xml`)
- [ ] Sitemap integration
- [ ] Weekly backup cron worker
- [ ] Lighthouse CI in GitHub Actions
- [ ] Production deploy to Cloudflare Pages
