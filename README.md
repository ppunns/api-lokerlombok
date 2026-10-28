# loker-lombok-instagram

Backend API pencarian lowongan kerja dari postingan Instagram (default @bursalokerlombok).
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
  extraction/process.ts proses source_posts pending → jobs (langsung tayang, atau draft)
  pipeline/run.ts     satu putaran otomatis: collect lalu extract
scripts/seed.ts       CLI input data contoh / manual
scripts/check-instagram.ts  uji akses Instagram (read-only)
scripts/check-api-role.ts   uji API_DATABASE_URL benar-benar read-only (lihat docs/database.md)
scripts/collect.ts    CLI collector (sekali jalan / --watch)
scripts/extract.ts    CLI ekstraksi lowongan dengan Gemini
scripts/review.ts     CLI cek, publish, dan sembunyikan lowongan
scripts/reset.ts      CLI hapus semua jobs dan source_posts (butuh --yes)
scripts/admin.ts      menu interaktif untuk review, pipeline, jadwal, dan reset
scripts/schedule.ts   CLI jadwal pengambilan otomatis (akun, jam WITA, publish/draft)
scripts/pipeline.ts   pipeline otomatis (collect + extract) dengan polling
data/                 data contoh (fiktif)
supabase/migrations/  migration SQL
docs/database.md      schema tabel dan cara migration
docs/instagram-access.md  validasi akses Instagram (Business Discovery)
docs/frontend-prompt.md   kontrak API + brief untuk pengembangan frontend
docs/deploy-debian.md     deploy ke server Debian sendiri (systemd + Caddy)
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

Mengambil postingan terbaru akun target (default @bursalokerlombok, ganti dengan `IG_TARGET_USERNAME`)
lewat Business Discovery dan menyimpannya ke tabel
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
divalidasi Zod lalu disimpan ke `jobs` dan **langsung tayang** (`AUTO_PUBLISH`, default `true`).
Dengan `AUTO_PUBLISH=false` lowongan disimpan sebagai **draft** sampai di-review. Hasil yang gagal
validasi tidak pernah tampil, dan `extraction_status` tetap `extracted` (hasil AI, belum diverifikasi). Transkripsi teks poster disimpan di `jobs.ocr_text` untuk audit.

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

Menggabungkan collect dan extract: setiap putaran mengambil postingan baru akun target (default @bursalokerlombok) lalu
mengekstrak lowongan dari postingan `pending` (maks. `EXTRACT_BATCH`, default 20), lalu langsung
menayangkannya (atau sebagai draft jika `AUTO_PUBLISH=false`).

```bash
bun run pipeline        # terus berjalan, satu putaran tiap PIPELINE_CRON (default */15 * * * *)
bun run pipeline:once   # satu putaran lalu keluar (untuk cron/scheduler eksternal)
bun scripts/pipeline.ts --once --account lokerlombok --days 7   # ambil ulang periode tertentu (1-30 hari)
bun scripts/pipeline.ts --once --draft                          # --draft / --publish menimpa AUTO_PUBLISH untuk run ini
```

- Putaran berikutnya dilewati jika putaran sebelumnya belum selesai.
- Jika collect gagal (mis. token Instagram kedaluwarsa, error 190), extract tetap memproses
  postingan yang sudah tersimpan, dan log menyebut bahwa token perlu diperbarui.
- Postingan yang sudah diproses tidak diekstrak ulang.
- Tiap putaran juga mengubah lowongan yang sudah tutup menjadi `expired` (deadline lewat menurut
  WITA, atau tanpa deadline dan lebih dari 30 hari). Lowongan dari postingan lama yang sudah tutup
  langsung disimpan sebagai `expired`, tidak sempat tayang.
- Proses harus terus hidup agar otomatis: jalankan di server/hosting, bukan terminal yang ditutup.

## Jadwal otomatis

Atur akun, jam (WITA), dan publish/draft untuk pengambilan otomatis lewat `bun run admin` → "Jadwal
otomatis", atau langsung:

```bash
bun run schedule                                     # lihat jadwal
bun run schedule set --account bursalokerlombok --times 07:00,19:00 --draft   # atau --publish
bun run schedule disable                             # matikan (enable untuk menyalakan lagi)
```

Jadwal disimpan di tabel `pipeline_schedule` (migration `20261028010000`). Pipeline tetap dipicu
sering (Cloud Scheduler tiap 15 menit, atau `bun run pipeline`). Pada pemicuan pertama setelah jam
terjadwal, pipeline mengambil semua postingan sejak pengambilan terakhir (dengan overlap 1 jam, maks.
7 hari ke belakang; pertama kali 1 hari). Pemicuan lain tidak mengambil postingan baru, tetapi tetap
mengekstrak postingan `pending` (maks. `EXTRACT_BATCH`) dan menandai lowongan kedaluwarsa. Saat jadwal
dimatikan, tidak ada pengambilan baru. Selama jadwal belum pernah diatur, pipeline mengambil setiap
pemicuan dengan `IG_TARGET_USERNAME` dan `AUTO_PUBLISH` seperti sebelumnya. Run manual dengan
`--account`, `--days`, `--publish`, atau `--draft` mengabaikan jadwal.

## Review dan publish

Secara default lowongan hasil AI langsung tayang; gunakan `reject` untuk menyembunyikan yang salah
atau mencurigakan. Dengan `AUTO_PUBLISH=false`, lowongan masuk sebagai `draft` dan baru tampil
setelah di-publish.

```bash
bun run review                    # daftar draft per postingan + link Instagram
bun run review recent [hari]      # lowongan yang tayang/berubah dalam N hari terakhir (default 3)
bun run review stats              # jumlah jobs dan source_posts per status
bun run review show <id>          # detail lengkap, termasuk teks poster (ocr_text)
bun run review publish <id...>    # tampilkan ke publik
bun run review reject <id...>     # sembunyikan (juga untuk menarik yang sudah tayang)
```

`<id>` cukup 8 karakter pertama dari daftar. Bandingkan dengan postingan aslinya lewat link.
Untuk memperbaiki isi lowongan (mis. nama perusahaan salah baca), edit barisnya di Supabase
Dashboard → Table Editor → `jobs`. Lowongan yang sudah tayang atau ditolak tidak ditimpa
ekstraksi ulang.

## Menu admin interaktif

```bash
bun run admin
```

Menu bernomor untuk perintah admin di atas tanpa perlu menghafal argumen: ringkasan data per
status, lihat draft, lowongan yang baru tayang, detail, publish, reject, ambil lowongan dari akun
Instagram, jadwal otomatis (lihat "Jadwal otomatis"), dan reset database (harus mengetik `HAPUS`).
Tiap pilihan menjalankan script yang sama (`review`, `check-instagram`, `pipeline --once`,
`schedule`, `reset`). Ringkasan saja: `bun run review stats`.

**Ambil lowongan dari akun Instagram**:

1. Masukkan username. Profil akun (nama, bio, followers, jumlah post, 5 postingan terbaru) ditampilkan.
   Berhenti jika akun tidak ditemukan atau bukan akun Business/Creator (batas Business Discovery).
2. Pilih periode: 1 hari, 7 hari, atau 1 bulan (30 hari) terakhir.
3. Pilih hasil ekstraksi: langsung publish atau simpan sebagai draft untuk di-review (menimpa
   `AUTO_PUBLISH` untuk run ini saja).
4. Konfirmasi, lalu semua postingan pada periode itu disimpan (yang sudah ada dilewati) dan hingga 200
   postingan `pending` diekstrak dengan Gemini. Maksimal 20 halaman (500 postingan) per run. Sisa
   postingan diproses pipeline berikutnya atau dengan `bun run extract`.

## Reset database

Menghapus **semua** lowongan (`jobs`) dan **semua** postingan mentah (`source_posts`) untuk mulai dari nol.

```bash
bun run reset         # tampilkan host database dan jumlah yang akan dihapus, tidak mengubah apa pun
bun run reset --yes   # hapus semuanya (satu transaksi)
```

Reset ditolak selama putaran pipeline sedang berjalan. Setelah reset, collect berikutnya menganggap
postingan terbaru sebagai baru lagi (maks. 100 postingan) dan mengekstraknya ulang dengan Gemini
(memakai kuota). Lowongan yang sebelumnya di-reject bisa tayang lagi. Jika tidak ingin database terisi
ulang, hentikan pipeline (Cloud Scheduler) dulu.

## Deploy ke Google Cloud

Satu image (`Dockerfile`) untuk dua workload di Cloud Run, region `asia-southeast1` (sama dengan
Supabase). Rahasia disimpan di Secret Manager, tidak di image maupun repo.

- **API** (Cloud Run service): perintah default `bun src/index.ts`, publik, maks 2 instance
  (2 × pool 2 = 4 koneksi, di bawah batas role `api_readonly` = 5). Hanya diberi `API_DATABASE_URL`,
  tidak pernah `DATABASE_URL`. Cloud Run mengirim `SIGTERM` sebelum mematikan instance.
- **Pipeline** (Cloud Run Job + Cloud Scheduler tiap 15 menit): `bun scripts/pipeline.ts --once`,
  tanpa retry otomatis (retry ditangani pipeline sendiri). Run yang tumpang tindih dilewati lewat
  advisory lock Postgres, jadi postingan tidak diproses dua kali.

Deploy ke server sendiri (Debian, systemd + Caddy): lihat [docs/deploy-debian.md](docs/deploy-debian.md).

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
# role bawaan Supabase, dengan grant default seperti di Supabase
psql -d loker_test -c "create role anon; create role authenticated; alter default privileges in schema public grant all on tables to anon, authenticated;"
for f in supabase/migrations/*.sql; do psql -d loker_test -f "$f"; done
TEST_DATABASE_URL=postgres://localhost/loker_test bun test
```
