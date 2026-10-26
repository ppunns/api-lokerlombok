# loker-lombok-instagram

Backend API pencarian lowongan kerja dari postingan Instagram (@lokerlombok).
Stack: Bun, TypeScript, Hono, Supabase PostgreSQL, Zod.

## Setup

```bash
bun install
cp .env.example .env   # isi DATABASE_URL dan variabel Supabase
```

Terapkan migration ke database (lihat [docs/database.md](docs/database.md)), lalu:

```bash
bun run seed       # opsional: isi data contoh
bun run dev        # server dengan hot reload di http://localhost:3000
bun run start      # server tanpa hot reload
```

## Struktur

```
src/
  index.ts            entry server (koneksi DB + Bun)
  app.ts              app Hono: /health, /jobs, 404/500 JSON
  config.ts           validasi env dengan Zod
  db.ts               koneksi Postgres dengan batas pool (API 5, script/pipeline 2)
  schemas/job.ts      schema Zod lowongan, query pencarian, tipe
  jobs/routes.ts      handler GET /jobs dan GET /jobs/:id
  jobs/repository.ts  query SQL (Bun.sql)
  jobs/import.ts      validasi dan upsert data input
  jobs/review.ts      daftar draft dan ubah status publikasi
  instagram/client.ts client Business Discovery (Instagram Graph API)
  collector/collect.ts  ambil postingan baru → tabel source_posts
  extraction/gemini.ts  baca poster + caption dengan Gemini → JSON lowongan
  extraction/process.ts proses source_posts pending → jobs (draft)
  pipeline/run.ts     satu putaran otomatis: collect lalu extract
scripts/seed.ts       CLI input data contoh / manual
scripts/check-instagram.ts  uji akses Instagram (read-only)
scripts/check-api-role.ts   uji API_DATABASE_URL benar-benar read-only (lihat docs/database.md)
scripts/collect.ts    CLI collector (sekali jalan / --watch)
scripts/extract.ts    CLI ekstraksi lowongan dengan Gemini
scripts/review.ts     CLI cek dan publish lowongan draft
scripts/pipeline.ts   pipeline otomatis (collect + extract) dengan polling
data/                 data contoh (fiktif)
supabase/migrations/  migration SQL
docs/database.md      schema tabel dan cara migration
docs/instagram-access.md  validasi akses Instagram (Business Discovery)
docs/frontend-prompt.md   kontrak API + brief untuk pengembangan frontend
```

## API

Hanya lowongan `published` yang tampil. `raw_caption`, `ocr_text`, `extraction_status`, dan
`publication_status` tidak dikirim ke publik.

CORS: hanya `GET` yang diizinkan lintas origin. Default semua origin (`*`). Batasi dengan
`CORS_ORIGINS=https://domain-frontend,...` saat frontend sudah punya domain.

- `GET /health` → `200 { "status": "ok" }` jika database menjawab dalam 2 detik, selain itu
  `503 { "status": "unavailable" }` (cocok untuk health check hosting)
- `GET /jobs`: cari lowongan, terbaru dulu. Query (semua opsional):
  - `q`: cari di judul, perusahaan, deskripsi (maks 100 karakter)
  - `location`: cocok sebagian dengan teks lokasi asli, tidak peka huruf besar/kecil
  - `regency`: kabupaten/kota, mis. `kota_mataram`, `lombok_tengah` (daftar di [docs/database.md](docs/database.md))
  - `employment_type`, `education_level`: nilai enum, lihat [docs/database.md](docs/database.md)
  - `page` (default 1, maks 1000), `limit` (default 20, maks 50)

  Respons: `{ "data": [...], "pagination": { "page", "limit", "total", "total_pages" } }`.
  Query tidak valid → 400 `{ "error": "Invalid query", "details": {...} }`.
- `GET /jobs/:id` → `{ "data": {...} }`; id bukan uuid → 400, tidak ada/belum published → 404.

## Data contoh / input manual

```bash
bun run seed                  # isi data contoh dari data/sample-jobs.json
bun scripts/seed.ts file.json # input manual dari file JSON lain
bun run seed:clean            # hapus semua data contoh (source_account = contoh_data)
```

File berisi array lowongan dengan format `jobInsertSchema` (lihat [docs/database.md](docs/database.md)).
Semua item divalidasi dulu; jika ada satu yang tidak valid, tidak ada yang disimpan. Lowongan
dengan sumber yang sama (`source_platform`, `source_post_id`, `source_job_index`) di-update,
bukan diduplikasi, jadi aman dijalankan ulang. Data contoh bersifat fiktif. Hapus dengan
`seed:clean` sebelum website dibuka untuk publik.

## Collector Instagram

Mengambil postingan terbaru @lokerlombok lewat Business Discovery dan menyimpannya ke tabel
`source_posts` dengan status `pending` (OCR/ekstraksi lowongan belum ada). Butuh `IG_USER_ID` dan
`IG_ACCESS_TOKEN` di `.env` (lihat [docs/instagram-access.md](docs/instagram-access.md)).

```bash
bun run collect        # sekali jalan (untuk cron/scheduler eksternal)
bun run collect:watch  # terus berjalan, polling sesuai COLLECT_CRON (default tiap 15 menit)
```

Tiap run mengambil 25 postingan per halaman dan berhenti di halaman yang berisi postingan yang
sudah tercatat, maksimal 4 halaman (100 postingan). Jadi run pertama hanya mengambil sekitar
satu minggu terakhir, bukan seluruh riwayat akun. Postingan yang sama tidak pernah tersimpan dua kali.

## Ekstraksi lowongan (Gemini)

Mengirim caption dan gambar poster (maks. 5 per postingan, diunduh hanya di memori, tidak
disimpan) ke Gemini (`gemini-3.1-flash-lite`, bisa diganti lewat `GEMINI_MODEL`). Hasilnya
divalidasi Zod lalu disimpan ke `jobs` sebagai **draft**, sehingga belum tampil ke publik sampai
dicek. Transkripsi teks poster disimpan di `jobs.ocr_text` untuk audit.

```bash
bun run extract              # proses hingga 20 postingan pending (terbaru dulu)
bun run extract --limit 50
```

Status `source_posts`: `processed` (ada lowongan), `no_jobs` (bukan lowongan, mis. iklan),
`failed` (dicoba ulang hingga 3 kali). Jika model utama sibuk (503), request itu dikirim ke model
cadangan `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`, free tier). Error lain, termasuk
kuota habis (429), tidak memakai cadangan. Jika keduanya tetap sibuk atau kuota habis, run berhenti
tanpa menghabiskan jatah percobaan postingan. Jalankan lagi nanti. Ekstraksi ulang tidak pernah
menimpa lowongan yang sudah di-publish atau di-reject.

## Pipeline otomatis

Menggabungkan collect dan extract: setiap putaran mengambil postingan baru @lokerlombok lalu
mengekstrak lowongan dari postingan `pending` (maks. `EXTRACT_BATCH`, default 20) sebagai draft.

```bash
bun run pipeline        # terus berjalan, satu putaran tiap PIPELINE_CRON (default */15 * * * *)
bun run pipeline:once   # satu putaran lalu keluar (untuk cron/scheduler eksternal)
```

- Putaran berikutnya dilewati jika putaran sebelumnya belum selesai.
- Jika collect gagal (mis. token Instagram kedaluwarsa, error 190), extract tetap memproses
  postingan yang sudah tersimpan, dan log menyebut bahwa token perlu diperbarui.
- Postingan yang sudah diproses tidak diekstrak ulang; lowongan tetap draft sampai di-review.
- Proses harus terus hidup agar otomatis: jalankan di server/hosting, bukan terminal yang ditutup.

## Review dan publish

Lowongan hasil AI masuk sebagai `draft` dan baru tampil di API setelah di-publish.

```bash
bun run review                    # daftar draft per postingan + link Instagram
bun run review show <id>          # detail lengkap, termasuk teks poster (ocr_text)
bun run review publish <id...>    # tampilkan ke publik
bun run review reject <id...>     # sembunyikan (juga untuk menarik yang sudah tayang)
```

`<id>` cukup 8 karakter pertama dari daftar. Bandingkan dengan postingan aslinya lewat link.
Untuk memperbaiki isi lowongan (mis. nama perusahaan salah baca), edit barisnya di Supabase
Dashboard → Table Editor → `jobs`, lalu publish.

## Deploy ke Render

`render.yaml` (Blueprint) membuat dua service di region Singapore (sama dengan Supabase):

- `loker-lombok-api` (Web Service, Free): `bun run start`, health check `/health`. Hanya diberi
  `API_DATABASE_URL` (role `api_readonly`), tidak pernah `DATABASE_URL`. Free tier tidur setelah
  15 menit tanpa request; request pertama sesudahnya menunggu ±1 menit.
- `loker-lombok-pipeline` (Cron Job, berbayar per detik, minimal $1/bulan): `bun run pipeline:once`
  tiap 15 menit (UTC). Render menjalankan paling banyak satu run sekaligus. Run yang gagal keluar
  dengan kode 1 sehingga terlihat (dan bisa dinotifikasi) di dashboard.

Langkah:

1. Push repo ke GitHub/GitLab, lalu Render → New → Blueprint → pilih repo.
2. Isi rahasia saat diminta: `API_DATABASE_URL` (API); `DATABASE_URL`, `IG_USER_ID`,
   `IG_ACCESS_TOKEN`, `GEMINI_API_KEY` (pipeline).
3. Setelah deploy: `curl https://<api>.onrender.com/health` → `{"status":"ok"}`, lalu jalankan
   `bun scripts/check-api-role.ts` dengan `API_DATABASE_URL` yang sama.
4. Saat frontend punya domain, tambahkan `CORS_ORIGINS` di service API.

Saat deploy, instance lama dan baru berjalan bersamaan sebentar. Pool API (2 koneksi) dan
penanganan `SIGTERM` di `src/index.ts` membuat keduanya muat dalam batas role `api_readonly` (5).

## Testing

```bash
bun test           # unit test (tanpa database)
bun run typecheck  # type check
```

Integration test database (`*.db.test.ts`) berjalan hanya jika `TEST_DATABASE_URL` diisi.
Test ini mengosongkan tabel, jadi hanya mau berjalan ke database lokal (`localhost`).
Dengan Postgres lokal:

```bash
createdb loker_test
psql -d loker_test -c "create role anon; create role authenticated;"  # role bawaan Supabase
for f in supabase/migrations/*.sql; do psql -d loker_test -f "$f"; done
TEST_DATABASE_URL=postgres://localhost/loker_test bun test
```
