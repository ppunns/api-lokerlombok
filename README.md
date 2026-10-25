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
  instagram/client.ts client Business Discovery (Instagram Graph API)
  collector/collect.ts  ambil postingan baru → tabel source_posts
scripts/seed.ts       CLI input data contoh / manual
scripts/check-instagram.ts  uji akses Instagram (read-only)
scripts/collect.ts    CLI collector (sekali jalan / --watch)
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
  - `location`: cocok sebagian, tidak peka huruf besar/kecil
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
