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
  schemas/job.ts      schema Zod lowongan, query pencarian, tipe
  jobs/routes.ts      handler GET /jobs dan GET /jobs/:id
  jobs/repository.ts  query SQL (Bun.sql)
  jobs/import.ts      validasi dan upsert data input
  jobs/review.ts      daftar draft dan ubah status publikasi
  instagram/client.ts client Business Discovery (Instagram Graph API)
  collector/collect.ts  ambil postingan baru → tabel source_posts
  extraction/gemini.ts  baca poster + caption dengan Gemini → JSON lowongan
  extraction/process.ts proses source_posts pending → jobs (draft)
scripts/seed.ts       CLI input data contoh / manual
scripts/check-instagram.ts  uji akses Instagram (read-only)
scripts/collect.ts    CLI collector (sekali jalan / --watch)
scripts/extract.ts    CLI ekstraksi lowongan dengan Gemini
scripts/review.ts     CLI cek dan publish lowongan draft
data/                 data contoh (fiktif)
supabase/migrations/  migration SQL
docs/database.md      schema tabel dan cara migration
docs/instagram-access.md  validasi akses Instagram (Business Discovery)
```

## API

Hanya lowongan `published` yang tampil. `raw_caption`, `ocr_text`, `extraction_status`, dan
`publication_status` tidak dikirim ke publik.

- `GET /health` → `{ "status": "ok" }`
- `GET /jobs`: cari lowongan, terbaru dulu. Query (semua opsional):
  - `q`: cari di judul, perusahaan, deskripsi (maks 100 karakter)
  - `location`: cocok sebagian dengan teks lokasi asli, tidak peka huruf besar/kecil
  - `regency`: kabupaten/kota, mis. `kota_mataram`, `lombok_tengah` (daftar di [docs/database.md](docs/database.md))
  - `employment_type`, `education_level`: nilai enum, lihat [docs/database.md](docs/database.md)
  - `page` (default 1), `limit` (default 20, maks 50)

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
`failed` (dicoba ulang hingga 3 kali). Jika Gemini sedang sibuk (503) atau kuota habis (429),
run berhenti tanpa menghabiskan jatah percobaan postingan. Jalankan lagi nanti.

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
