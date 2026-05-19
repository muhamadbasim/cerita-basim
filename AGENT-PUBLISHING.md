# Agent Publishing Guide — Cerita Basim

Panduan untuk OpenClaw, Hermes, atau AI agent lain agar bisa otomatis publish konten ke cerita.basim.id.

---

## Cara Kerja

Cerita Basim menggunakan **markdown-in-Git** sebagai CMS. Untuk publish konten baru:

1. Tulis file `.mdx` di folder yang tepat
2. `git add` + `git commit` + `git push` ke `main`
3. GitHub Actions otomatis build + deploy ke Cloudflare Pages (~90 detik)
4. Konten live di cerita.basim.id

**Tidak ada CMS dashboard, tidak ada API publish, tidak ada database untuk konten.** Semua konten adalah file markdown di Git.

---

## Publish Cerita (Blog Post)

### Lokasi file
```
src/content/posts/<slug>.mdx
```

### Template frontmatter
```yaml
---
title: "Judul Cerita"
description: "Deskripsi singkat 1-2 kalimat untuk SEO dan preview."
publishedAt: 2026-05-20
updatedAt: 2026-05-20          # opsional, isi kalau update
tags: ["produk", "teknis"]     # pilih dari: produk, teknis, karier, catatan
cover: "/images/posts/slug.jpg" # opsional
draft: false                    # true = tidak dipublish
featured: false                 # true = tampil di homepage
---
```

### Aturan konten
- Tulis dalam Bahasa Indonesia (boleh mix English untuk istilah teknis)
- Gunakan heading h2 (`##`) dan h3 (`###`) — akan otomatis jadi TOC
- Markdown standar: bold, italic, links, code blocks, blockquotes, lists, images
- Panjang ideal: 800-2000 kata (4-10 menit baca)
- Slug = nama file tanpa `.mdx` (contoh: `belajar-astro.mdx` → `/cerita/belajar-astro`)

### Contoh lengkap
```markdown
---
title: "Belajar Astro 5 dalam satu akhir pekan"
description: "Catatan dari eksperimen membangun blog dengan Astro — dari nol sampai deploy."
publishedAt: 2026-05-20
tags: ["teknis"]
featured: false
draft: false
---

Paragraf pembuka yang menarik perhatian...

## Heading pertama

Konten...

### Sub-heading

Konten lebih detail...

## Kesimpulan

Penutup...
```

---

## Publish Karya (Project Case Study)

### Lokasi file
```
src/content/projects/<slug>.mdx
```

### Template frontmatter
```yaml
---
title: "Nama Project"
tagline: "Satu kalimat yang menjelaskan project."
category: "web"                # pilih: web, mobile, tools, experiment
year: 2026
coverColor: "terra"            # pilih: terra, forest, gold, ink, mix, sand
stack: ["Astro", "Cloudflare", "D1"]
role: "Solo Founder"
duration: "3 bulan"            # opsional
status: "live"                 # pilih: live, discontinued, beta, archived
demoUrl: "https://example.com" # opsional
repoUrl: "https://github.com/..." # opsional
featured: false                # true = tampil di homepage
order: 5                       # urutan di grid (lower = first)
---
```

### Struktur konten project
```markdown
## Masalah

Jelaskan problem yang diselesaikan...

## Proses

Bagaimana approach-nya...

## Hasil

Metrik atau outcome...

## Yang saya pelajari

Refleksi...
```

---

## Command untuk Agent

### Publish post baru (dari workspace)
```bash
cd /home/ubuntu/.openclaw/workspace/cerita-basim

# 1. Tulis file
cat > src/content/posts/judul-post.mdx << 'EOF'
---
title: "Judul Post"
description: "Deskripsi singkat."
publishedAt: 2026-05-20
tags: ["catatan"]
draft: false
featured: false
---

Isi konten di sini...
EOF

# 2. Commit & push (auto-deploy via GitHub Actions)
git add -A
git commit -m "post: judul post"
git push
```

### Publish project baru
```bash
cd /home/ubuntu/.openclaw/workspace/cerita-basim

cat > src/content/projects/nama-project.mdx << 'EOF'
---
title: "Nama Project"
tagline: "Deskripsi singkat."
category: "web"
year: 2026
coverColor: "forest"
stack: ["TypeScript", "Cloudflare"]
role: "Solo"
status: "live"
featured: false
order: 10
---

## Masalah
...

## Hasil
...
EOF

git add -A
git commit -m "project: nama project"
git push
```

### Update post yang sudah ada
```bash
cd /home/ubuntu/.openclaw/workspace/cerita-basim

# Edit file langsung
# Tambah/update frontmatter `updatedAt: 2026-05-20`

git add -A
git commit -m "update: judul post — tambah section baru"
git push
```

### Hapus post (unpublish)
```bash
# Opsi 1: Set draft: true (tetap di repo tapi tidak dipublish)
# Opsi 2: Hapus file
rm src/content/posts/slug-post.mdx
git add -A
git commit -m "unpublish: judul post"
git push
```

---

## Validasi Sebelum Publish

Agent harus cek sebelum push:

1. **Frontmatter lengkap** — semua required field terisi (title, description, publishedAt, tags)
2. **Slug unik** — tidak ada file lain dengan nama yang sama
3. **Tags valid** — gunakan tag yang sudah ada: `produk`, `teknis`, `karier`, `catatan`
4. **Category valid** (untuk project) — `web`, `mobile`, `tools`, `experiment`
5. **Build test** (opsional tapi recommended):
   ```bash
   PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAADSLzp6yl8WQnFBT bun run build
   ```
   Kalau build gagal, jangan push.

---

## Kirim Newsletter Setelah Publish

Setelah post live, agent bisa trigger newsletter dispatch via admin API:

```bash
# Kirim newsletter ke semua subscriber active
curl -X POST https://cerita.basim.id/api/admin/dispatch \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: 7fdd86418757b34ff51cb23976be135a3c77a9a55cf4d02f" \
  -d '{"post_slug": "judul-post"}'
```

**Catatan:** Hanya kirim newsletter untuk post yang benar-benar baru dan berkualitas. Jangan spam subscriber.

---

## Automation Ideas untuk Agent

### 1. Scheduled posting
Agent bisa tulis post dengan `draft: true`, lalu di waktu yang ditentukan flip ke `draft: false` dan push.

### 2. Cross-post dari sumber lain
Agent bisa ambil konten dari Notion/Obsidian/Google Docs, convert ke MDX, dan push.

### 3. Auto-generate project case study
Setelah selesai build project baru, agent otomatis generate case study dari commit history + README.

### 4. Weekly digest
Agent bisa generate "Catatan Mingguan" otomatis dari aktivitas minggu itu.

### 5. SEO optimization
Agent bisa review post yang sudah ada, suggest improvement untuk description/tags, dan update.

---

## File & Path Reference

| Apa | Path |
|-----|------|
| Posts | `src/content/posts/*.mdx` |
| Projects | `src/content/projects/*.mdx` |
| Content schema | `src/content/config.ts` |
| Build command | `PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAADSLzp6yl8WQnFBT bun run build` |
| Deploy (manual) | `wrangler pages deploy dist --project-name=cerita-basim` |
| Deploy (auto) | `git push` ke `main` → GitHub Actions |
| Admin API | `https://cerita.basim.id/api/admin/*` (header: `X-Admin-Token`) |
| Admin token | `7fdd86418757b34ff51cb23976be135a3c77a9a55cf4d02f` |
| Live site | `https://cerita.basim.id` |
| Repo | `https://github.com/muhamadbasim/cerita-basim` |
| Workspace | `/home/ubuntu/.openclaw/workspace/cerita-basim/` |

---

## Contoh Workflow Agent End-to-End

```bash
# 1. Agent tulis konten
cd /home/ubuntu/.openclaw/workspace/cerita-basim

cat > src/content/posts/tips-cloudflare-d1.mdx << 'EOF'
---
title: "5 Tips Cloudflare D1 untuk Side Project"
description: "Pelajaran dari 6 bulan pakai D1 di production — apa yang works dan apa yang perlu dihindari."
publishedAt: 2026-05-20
tags: ["teknis"]
draft: false
featured: false
---

D1 adalah database SQLite dari Cloudflare...

## 1. Gunakan index dengan benar
...

## 2. Batch writes kalau bisa
...
EOF

# 2. Verify build
PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAADSLzp6yl8WQnFBT bun run build
# Exit 0 = OK

# 3. Push (auto-deploy)
git add -A
git commit -m "post: 5 tips cloudflare d1 untuk side project"
git push

# 4. Wait ~90 seconds for deploy

# 5. Verify live
curl -s https://cerita.basim.id/cerita/tips-cloudflare-d1 | grep -o "<title>.*</title>"

# 6. (Optional) Send newsletter
curl -X POST https://cerita.basim.id/api/admin/dispatch \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: 7fdd86418757b34ff51cb23976be135a3c77a9a55cf4d02f" \
  -d '{"post_slug": "tips-cloudflare-d1"}'
```

---

## Catatan Penting

- **Jangan publish konten AI-generated tanpa review.** Kualitas > kuantitas.
- **Jangan kirim newsletter lebih dari 2× per minggu.** Subscriber akan unsubscribe.
- **Selalu test build sebelum push** kalau konten punya syntax yang tidak biasa.
- **Commit message convention:** `post: judul` untuk post baru, `project: nama` untuk project, `update: judul` untuk edit.
