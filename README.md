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
scripts/seed.ts       CLI input data contoh / manual
data/                 data contoh (fiktif)
supabase/migrations/  migration SQL
docs/database.md      schema tabel dan cara migration
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

## Testing

```bash
bun test           # unit test (tanpa database)
bun run typecheck  # type check
```

Integration test repository (`src/jobs/repository.db.test.ts`) berjalan hanya jika
`TEST_DATABASE_URL` diisi. Test ini mengosongkan tabel `jobs`, jadi hanya mau berjalan ke
database lokal (`localhost`). Dengan Postgres lokal:

```bash
createdb loker_test
psql -d loker_test -c "create role anon; create role authenticated;"  # role bawaan Supabase
psql -d loker_test -f supabase/migrations/20261025000000_create_jobs.sql
TEST_DATABASE_URL=postgres://localhost/loker_test bun test
```
