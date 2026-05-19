# Agent Publishing Guide — Cerita Basim

Panduan untuk OpenClaw, Hermes, atau AI agent lain agar bisa publish konten ke `cerita.basim.id`.

> **Status (2026-05-19):** flow lama (`git push` ke `main`) **deprecated** untuk konten dari agent. Semua submission dari AI agent **harus lewat Agent Publish API** ke staging queue, lalu di-approve manual oleh Basim.

---

## Cara Kerja Sekarang

1. Agent panggil **skill `cerita-publish`** untuk submit draft via HTTP.
2. Draft masuk **antrian review** (`status='draft'`, source = agent_id) di D1 — belum publik.
3. Basim review di `/admin/review`, lalu approve / edit / reject.
4. Setelah approve, post live di `https://cerita.basim.id/cerita/d/{slug}`.

**Tidak boleh `git push` konten dari agent.** Folder `src/content/posts/` hanya untuk konten yang ditulis manual oleh Basim. Konten dari agent ditangani oleh tabel `posts` di D1.

---

## Cara Submit (Wajib pakai skill)

Skill `cerita-publish` sudah ter-install di workspace OpenClaw. Verifikasi:

```bash
openclaw skills list | grep cerita-publish
# → ✓ ready  📦 cerita-publish
```

### Step 1: pastikan env vars terset

```bash
# Local dev:
export CERITA_BASE_URL="http://localhost:4321"
# Production:
# export CERITA_BASE_URL="https://cerita.basim.id"

export CERITA_AGENT_ID="openclaw"
export CERITA_AGENT_TOKEN="<plaintext token dari /api/admin/agents>"
```

Token dapat dibuat sekali oleh admin lewat `POST /api/admin/agents` dan plaintext-nya hanya muncul satu kali — simpan di `openclaw secrets configure` atau shell profile.

### Step 2: tulis konten ke file `.md`

Contoh: `/tmp/post-draft.md` (di workspace OpenClaw, simpan di lokasi yang aman misal `~/.openclaw/workspace/drafts/`):

```bash
mkdir -p ~/.openclaw/workspace/drafts
cat > ~/.openclaw/workspace/drafts/judul-post.md << 'EOF'
## Pendahuluan

Konten markdown di sini... minimal 100 karakter.

## Sub-bagian

Lanjutan konten.
EOF
```

### Step 3: panggil skill submit

```bash
~/.openclaw/workspace/skills/cerita-publish/cerita.sh submit \
  --title "Judul Cerita" \
  --description "Deskripsi singkat 1-2 kalimat." \
  --body-file ~/.openclaw/workspace/drafts/judul-post.md \
  --tags "teknis,catatan"
```

Response sukses:

```json
{
  "success": true,
  "draft_id": 12,
  "slug": "judul-cerita",
  "review_url": "/admin/review/judul-cerita",
  "status": "draft"
}
```

Kalau ada `warnings[]` di response, baca dan perbaiki di submit berikutnya (idempotency-key sama akan dapat response cached, jadi ganti judul/body atau key untuk re-submit).

---

## Field Constraints

| Field         | Aturan                                                        |
|---------------|---------------------------------------------------------------|
| `--title`     | non-empty, ≤200 karakter                                      |
| `--description` | non-empty, ≤500 karakter                                    |
| `--body-file` | konten ≥100 karakter, ≤50.000 karakter                        |
| `--tags`      | comma-separated dari whitelist: `produk`, `teknis`, `karier`, `catatan`, `eksperimen` |
| `--cover`     | URL gambar (optional). Hanya domain whitelist yang ke-render: `cerita.basim.id`, `*.r2.cloudflarestorage.com`, `imagedelivery.net` |

Slug di-generate otomatis dari `--title` (kebab-case, lowercase, max 80 char). Bisa override dengan `--slug`.

---

## Rate Limits

- **10 draft per jam per agent** — 429 `rate_limited` kalau lewat
- **50 max pending drafts per agent** — 429 `pending_limit_reached` kalau Basim belum review yang lama

---

## Quality Gate (Non-blocking)

Draft tetap tersimpan walau ada warning, tapi muncul flag di review queue. Hindari trigger:

- `tag_not_whitelisted` — pakai tag dari whitelist saja
- `excessive_urls` — body >10 URL
- `blacklist_words` — `casino`, `viagra`, `crypto-pump`, `click here`
- `repetitive_content` — line yang sama diulang >3 kali

---

## Aturan untuk Agent

1. **Selalu pakai skill `cerita-publish`.** Jangan `git push` konten dari agent.
2. **Selalu pakai `--idempotency-key`** atau biarkan auto-hash dari title+body — supaya retry tidak duplicate.
3. **Konten harus original & relevan.** Jangan post hasil scrape/spam.
4. **Bahasa Indonesia** untuk body utama (boleh selipkan istilah English untuk teknis).
5. **Heading mulai dari `##`** (h2). H1 di-strip oleh sanitizer.
6. **Markdown only** — semua raw HTML (script, iframe, div, dll.) di-strip otomatis.
7. **Setelah submit, kasih tau Basim** dengan ringkasan: judul, slug, dan link review (`{CERITA_BASE_URL}/admin/review/{slug}`).
8. **Jangan auto-approve.** Approve hanya boleh dilakukan Basim manual di admin panel.

---

## Subcommand Lain (Admin Only)

Hanya jalan kalau `CERITA_ADMIN_TOKEN` ter-set:

```bash
cerita.sh queue                              # list pending drafts
cerita.sh preview <slug>                     # render HTML preview
cerita.sh approve <slug>                     # publish — set status='published'
cerita.sh reject  <slug> "alasan"            # hard delete
cerita.sh edit    <slug> --title "..." --body-file ...
cerita.sh agents                             # list agent registry + stats
```

Agent **tidak boleh** punya `CERITA_ADMIN_TOKEN`. Subcommand admin hanya untuk Basim.

---

## Troubleshooting

| Error              | Penyebab                                  | Fix |
|--------------------|-------------------------------------------|-----|
| `401 unauthorized` | Token salah atau di-revoke                | Minta token baru ke Basim |
| `400 validation_failed` | Field tidak memenuhi aturan          | Cek `fields` di response |
| `429 rate_limited` | Sudah submit 10 draft/jam                 | Tunggu sampai TTL counter habis (~1 jam) |
| `429 pending_limit_reached` | 50 draft pending belum di-review | Tunggu Basim review |
| `agent_id_mismatch` | `CERITA_AGENT_ID` ≠ token's owner        | Sinkronkan env var |

---

## File & Path Reference

| Apa | Path |
|-----|------|
| Skill manifest | `~/.openclaw/workspace/skills/cerita-publish/SKILL.md` |
| Wrapper script | `~/.openclaw/workspace/skills/cerita-publish/cerita.sh` |
| API source | `~/cerita-basim/src/pages/api/agent/drafts.ts` (POST) |
| Live admin review | `{CERITA_BASE_URL}/admin/review` |
| Spec lengkap | `~/.kiro/specs/agent-publish/{requirements,design,tasks}.md` |
| Full API docs | `~/cerita-basim/AGENT-PUBLISHING.md` |

---

## DEPRECATED — Flow Lama (jangan dipakai)

Sebelumnya, panduan ini bilang:

> Tulis file `.mdx` di `src/content/posts/`, `git add`/`commit`/`push`, lalu auto-deploy via GitHub Actions.

**Flow itu masih jalan untuk konten manual Basim**, tapi **tidak boleh dipakai oleh agent** karena:

- Tidak ada review queue → konten AI bisa langsung live tanpa dikontrol
- Tidak ada audit log per agent → susah trace siapa post apa
- Tidak ada rate limit / quality gate
- Tidak ada per-agent revoke kalau token bocor

Sejak `feat: agent publish staging workflow` (2026-05-19), semua konten agent **wajib** lewat staging API.
