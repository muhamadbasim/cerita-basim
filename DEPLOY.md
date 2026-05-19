# Deploy ke Cloudflare Pages

Repo: https://github.com/muhamadbasim/cerita-basim

Ikuti step ini di [dash.cloudflare.com](https://dash.cloudflare.com) — semua bisa via UI, tidak perlu CLI.

---

## Step 1 · Buat D1 Database

1. Sidebar kiri → **Workers & Pages** → **D1 SQL Database** → **Create database**
2. Name: `cerita-basim-db`
3. Location: pilih yang terdekat (Asia Pacific)
4. Klik **Create**
5. Setelah dibuat, buka database → tab **Console**
6. Paste isi file `migrations/0001_init.sql` (di repo) → klik **Execute**
7. Verify: tab **Tables** harus ada 4 tabel (`comments`, `trusted_emails`, `subscribers`, `dispatches`)

**Catat Database ID** dari URL atau tab Settings — akan dipakai di Step 4.

---

## Step 2 · Buat KV Namespace

1. **Workers & Pages** → **KV** → **Create namespace**
2. Name: `cerita-basim-kv`
3. **Catat Namespace ID** — akan dipakai di Step 4.

---

## Step 3 · Buat Pages Project + Connect Repo

1. **Workers & Pages** → **Create application** → tab **Pages** → **Connect to Git**
2. Authorize GitHub (kalau belum), pilih repo `muhamadbasim/cerita-basim`
3. **Project name:** `cerita-basim`
4. **Production branch:** `main`
5. **Framework preset:** Astro
6. **Build command:** `bun run build`
7. **Build output directory:** `dist`
8. **Root directory:** (kosongkan, default `/`)

### Environment variables (klik "Add variable" untuk setiap)

| Variable | Type | Value |
|---|---|---|
| `SITE_URL` | Plaintext | `https://cerita.basim.id` |
| `ADMIN_EMAIL` | Plaintext | `basim@cerita.basim.id` (ganti sesuai emailmu) |
| `TURNSTILE_SECRET` | **Secret** | Lihat Step 5 |
| `RESEND_API_KEY` | **Secret** | Lihat Step 6 |
| `ENCRYPTION_KEY` | **Secret** | `cd95832956262ec011175e444a74629c` *(generated, ganti kalau mau)* |
| `ENCRYPTION_SALT` | **Secret** | `bd338e0cdccfd74b04fe742e1445b447e9defb186c53d520` *(generated, ganti kalau mau)* |

> ⚠️ Penting: `TURNSTILE_SECRET` dan `RESEND_API_KEY` boleh dikosongkan dulu untuk first deploy — situs akan tetap jalan, hanya komentar/subscribe form yang belum berfungsi penuh.

9. Klik **Save and Deploy** — build pertama akan berjalan ~60-90 detik.

---

## Step 4 · Bind D1 + KV ke Pages Project

Setelah deploy pertama selesai:

1. Buka project `cerita-basim` → **Settings** → **Bindings**
2. **Add binding** → **D1 database**:
   - Variable name: `DB`
   - Database: pilih `cerita-basim-db`
3. **Add binding** → **KV namespace**:
   - Variable name: `KV`
   - Namespace: pilih `cerita-basim-kv`
4. **Add binding** → **R2 bucket** (opsional, untuk image asset & backup):
   - Buat bucket dulu di **R2** → **Create bucket**: `cerita-basim-assets`
   - Variable name: `R2`
   - Bucket: `cerita-basim-assets`
5. Klik **Save**
6. Trigger redeploy: **Deployments** → klik **Retry deployment** (atau push commit baru)

---

## Step 5 · Cloudflare Turnstile (anti-spam)

1. **Turnstile** (di sidebar) → **Add site**
2. Site name: `cerita-basim`
3. Domains: `cerita.basim.id` (dan `localhost` untuk dev)
4. Widget mode: **Managed**
5. Setelah dibuat, copy **Site Key** dan **Secret Key**
6. **Site Key** (public) → masukkan ke `<head>` di BaseLayout.astro nanti via env var `PUBLIC_TURNSTILE_SITE_KEY`
7. **Secret Key** → set sebagai `TURNSTILE_SECRET` di Pages env vars (Step 3)

---

## Step 6 · Resend (email)

1. Daftar di [resend.com](https://resend.com) (gratis, 3000 email/bulan)
2. **API Keys** → **Create API Key** → name: `cerita-basim-prod`
3. Copy key (format: `re_xxxxxxxx...`)
4. Set sebagai `RESEND_API_KEY` di Pages env vars
5. **Domains** → **Add domain** → `cerita.basim.id`
6. Resend akan kasih beberapa DNS record (SPF, DKIM, DMARC) — copy semuanya
7. Tambahkan di Cloudflare DNS untuk zone `basim.id` (Step 7)
8. Klik **Verify** di Resend setelah DNS propagate (~5 menit)

---

## Step 7 · Custom Domain `cerita.basim.id`

1. **Workers & Pages** → project `cerita-basim` → **Custom domains** → **Set up a custom domain**
2. Domain: `cerita.basim.id`
3. Klik **Continue** → **Activate domain**
4. Cloudflare akan otomatis buat CNAME record karena `basim.id` sudah di Cloudflare DNS-mu
5. SSL certificate auto-provisioned dalam beberapa menit
6. Setelah aktif, kunjungi `https://cerita.basim.id` 🎉

---

## Step 8 · (Opsional) Cloudflare Access untuk admin

Untuk proteksi `/admin/*` routes:

1. **Zero Trust** → **Access** → **Applications** → **Add an application**
2. Type: **Self-hosted**
3. Name: `cerita-basim-admin`
4. Subdomain: `cerita`
5. Domain: `basim.id`
6. Path: `/admin*`
7. Identity providers: **One-time PIN** (default, tidak perlu setup OAuth)
8. **Add policy**:
   - Name: `Basim only`
   - Action: **Allow**
   - Include → **Emails** → `basim@cerita.basim.id` (email kamu)
9. Save

Setelah aktif, akses ke `cerita.basim.id/admin` akan minta verifikasi email magic link.

---

## Step 9 · Verifikasi end-to-end

```bash
# 1. Buka homepage
curl -I https://cerita.basim.id
# Expected: 200 OK

# 2. Test API
curl https://cerita.basim.id/api/reactions/pindah-dari-medium
# Expected: {"love":0,"insightful":0,"fire":0,"thinking":0,"applause":0}

# 3. Test RSS
curl https://cerita.basim.id/rss.xml | head -20
# Expected: <?xml version="1.0" ...
```

---

## Update workflow

Setelah setup selesai, untuk update content/code:

```bash
cd /home/ubuntu/.openclaw/workspace/cerita-basim
# edit file...
git add -A
git commit -m "feat: tulis cerita baru tentang X"
git push
```

Cloudflare Pages akan auto-deploy dalam ~60 detik.

---

## Troubleshooting

**Build gagal di Cloudflare?** Cek build log — biasanya karena env var hilang atau bun version. Pastikan **Build settings** punya `NODE_VERSION=22` di env vars.

**Domain `cerita.basim.id` tidak resolve?** Cek **DNS** di Cloudflare → ada CNAME `cerita` → `cerita-basim.pages.dev` (auto-added oleh Custom domain step).

**API balas 500?** Pastikan binding D1/KV sudah di-set dan migration sudah dijalankan.
