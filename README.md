# EbayIQ — eBay Market Intelligence Dashboard

Dashboard riset produk & kompetitor eBay berbasis data real-time, siap deploy ke Netlify.

## Arsitektur singkat

- **Frontend**: HTML/CSS/JS statis di folder `public/` (tanpa build step).
- **Backend**: Netlify Functions (Node.js, serverless) di folder `netlify/functions/`. Ini wajib ada karena Client Secret eBay & API key tidak boleh ditaruh di browser.
- **3 API yang dipakai**:
  1. **eBay Browse API** (gratis) — listing aktif, harga, kompetitor, link asli ke produk.
  2. **DeepSeek API** (sudah Anda punya) — AI Insight, Strategy Center, scoring.
  3. **Scraper API pihak ketiga** (opsional, berbayar) — data sold/terjual, karena eBay tidak menyediakan ini secara resmi lagi.

---

## 1. Setup eBay Developer API (WAJIB, GRATIS)

1. Daftar di https://developer.ebay.com (akun developer terpisah dari akun seller Anda, tapi gratis).
2. Buka **My Account → Application Keys**.
3. Buat keyset **Production** (bukan Sandbox, supaya data yang muncul adalah listing eBay sungguhan).
4. Catat **Client ID** dan **Client Secret**.
5. Anda TIDAK perlu user login/OAuth interaktif — dashboard ini hanya butuh akses ke data publik (listing aktif), jadi memakai **Client Credentials Grant** yang sudah saya buat otomatis di `netlify/functions/ebay-search.js`. Tidak ada langkah OAuth tambahan yang perlu Anda lakukan.

**Limitasi penting yang harus Anda tahu**: eBay sudah men-decommission Finding API (Feb 2025), yang dulu satu-satunya cara resmi mengambil data "sold/terjual". Browse API pengganti resminya **hanya** memberi data listing yang sedang aktif dijual — bukan riwayat penjualan, bukan tren musiman 12 bulan. Semua angka "Pricing Intelligence" dan "Competition Intelligence" di dashboard ini dihitung dari listing aktif (asking price), bukan harga jual final. Ini bukan keterbatasan kode saya — ini keterbatasan eBay API resmi saat ini.

## 2. Setup DeepSeek API (sudah Anda punya kuncinya)

Tidak ada langkah tambahan, tinggal isi `DEEPSEEK_API_KEY` di Environment Variables (lihat bagian 4). Model yang dipakai: `deepseek-v4-flash` (murah & cepat). Kalau mau kualitas analisis lebih dalam, buka `netlify/functions/ai-insight.js` dan ganti `MODEL` ke `deepseek-v4-pro` (lebih mahal).

## 3. Setup Scraper API (OPSIONAL — untuk data sold/Demand & Timing)

Dashboard tetap berfungsi penuh tanpa ini — hanya halaman "Demand & Timing" yang akan menampilkan pesan "belum dikonfigurasi". Kalau Anda mau data sold:

1. Daftar di salah satu provider, contoh: ScraperAPI, ScrapingBee, ZenRows, atau Scrapingdog (semuanya berbayar/freemium, cari yang sesuai budget — saya tidak punya afiliasi dengan provider tertentu).
2. **GANTI BAGIAN INI**: buka `netlify/functions/sold-scraper.js`, cari fungsi `buildScraperRequestUrl()` di bagian atas file (ada komentar besar yang menandainya), lalu sesuaikan format URL-nya sesuai dokumentasi provider yang Anda pilih. Contoh sudah disiapkan untuk ScraperAPI; provider lain formatnya sedikit berbeda.
3. Isi `SCRAPER_API_KEY` di Environment Variables.
4. Catatan jujur: ini scraping HTML, jadi selector CSS (`.s-item__price`) bisa rusak kapan saja kalau eBay mengubah tampilan situsnya. Kalau tiba-tiba data sold berhenti muncul, cek dulu apakah selector itu masih cocok dengan HTML eBay terbaru.

---

## 4. Isi Environment Variables (di Netlify, BUKAN di kode)

Setelah deploy (lihat bagian 5), buka:
**Netlify Dashboard → pilih site Anda → Site configuration → Environment variables → Add a variable**

Isi 4 variabel ini (nama harus sama persis):

| Variable | Wajib? | Isi |
|---|---|---|
| `EBAY_CLIENT_ID` | Wajib | Client ID dari eBay Developer |
| `EBAY_CLIENT_SECRET` | Wajib | Client Secret dari eBay Developer |
| `DEEPSEEK_API_KEY` | Wajib | API key DeepSeek Anda |
| `SCRAPER_API_KEY` | Opsional | API key provider scraper, kosongkan kalau tidak pakai |

Setelah mengisi variable baru, **trigger deploy ulang** (Netlify tidak otomatis re-deploy hanya karena env var berubah) lewat tab **Deploys → Trigger deploy → Deploy site**.

## 5. Deploy ke Netlify

**Opsi A — lewat Git (disarankan, auto-deploy setiap kali push):**
1. Push folder project ini ke repo GitHub/GitLab.
2. Di Netlify: **Add new site → Import an existing project** → pilih repo tersebut.
3. Build command: kosongkan (tidak perlu build). Publish directory: `public` (sudah otomatis terbaca dari `netlify.toml`).
4. Isi Environment Variables seperti bagian 4, lalu deploy.

**Opsi B — drag & drop cepat (untuk tes sekali jalan):**
1. Jalankan `netlify deploy` dari folder ini lewat Netlify CLI (`npm install -g netlify-cli` lalu `netlify login`).
2. Atau drag folder `public` ke https://app.netlify.com/drop — tapi cara ini **tidak** akan menjalankan Functions, jadi backend tidak akan bekerja. Untuk Functions aktif, harus lewat `netlify deploy` CLI atau Git deploy.

## 6. Testing di komputer lokal (opsional, sebelum deploy)

```bash
npm install -g netlify-cli
npm install
cp .env.example .env
# isi .env dengan kunci asli Anda
netlify dev
```
Dashboard akan terbuka di `http://localhost:8888` lengkap dengan Functions aktif.

---

## Bagian mana saja yang BOLEH/PERLU Anda ganti

- `.env` / Environment Variables di Netlify → isi 3-4 API key (lihat bagian 4). **Ini satu-satunya hal yang wajib diisi.**
- `netlify/functions/sold-scraper.js`, fungsi `buildScraperRequestUrl()` → hanya kalau Anda pakai scraper API (lihat bagian 3).
- `netlify/functions/ai-insight.js`, konstanta `MODEL` → hanya kalau mau ganti model DeepSeek atau pindah provider AI lain.
- `public/index.html` & `public/css/style.css` → kalau mau ubah teks/branding/warna. Tidak ada kunci API di file-file ini.

Tidak ada bagian lain yang perlu disentuh untuk dashboard berjalan normal.

## Pengembangan lanjutan (di luar scope MVP ini)

- **Tren musiman 12 bulan yang sebenarnya** butuh database (misal Supabase/PostgreSQL gratis) yang menyimpan snapshot data sold setiap hari/minggu, lalu dirata-rata dari waktu ke waktu — Browse API/scraper hanya memberi snapshot hari ini, bukan riwayat.
- **Saved Products** saat ini disimpan di `localStorage` browser (per-device, tidak sinkron). Untuk sinkron antar device perlu backend + database + login user.
- **Login multi-user / multi-toko** belum ada — dashboard ini single-user, cocok untuk satu seller yang riset sendiri.
