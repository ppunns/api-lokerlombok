# Database

## Tabel `jobs`

Schema Zod: `src/schemas/job.ts` · Migration: `supabase/migrations/20261025000000_create_jobs.sql`.
Nilai enum di keduanya harus selalu sama.

### Field

| Field | Tipe | Wajib | Keterangan |
| --- | --- | --- | --- |
| `id` | uuid | auto | Primary key |
| `title` | text | ya | Posisi, tidak boleh kosong |
| `company_name`, `location`, `description` | text | – | |
| `requirements` | text[] | – | Daftar persyaratan |
| `employment_type` | text | – | `full_time`, `part_time`, `contract`, `internship`, `freelance` |
| `education_level` | text | – | Pendidikan minimal: `sd`, `smp`, `sma_smk`, `d1`–`d4`, `s1`–`s3` |
| `salary_min`, `salary_max` | bigint | – | Rupiah, bilangan bulat ≥ 0, `min ≤ max` |
| `salary_text` | text | – | Teks gaji asli, mis. "Rp2,5 - 3 juta" |
| `deadline` | date | – | `YYYY-MM-DD` |
| `source_platform` | text | default `instagram` | |
| `source_account` | text | ya | mis. `lokerlombok` |
| `source_post_url` | text | ya | URL https postingan asli |
| `source_post_id` | text | ya | ID / shortcode postingan |
| `source_job_index` | smallint | default `0` | Urutan lowongan dalam satu postingan (mulai 0) |
| `source_posted_at` | timestamptz | – | ISO 8601 dengan offset |
| `raw_caption`, `ocr_text` | text | – | Teks sumber untuk audit |
| `extraction_status` | text | default `pending` | `pending`, `extracted`, `failed` |
| `publication_status` | text | default `draft` | `draft`, `published`, `rejected`, `expired` |
| `created_at`, `updated_at` | timestamptz | auto | `updated_at` diperbarui oleh trigger |

Aturan:

- Field opsional yang tidak diketahui bernilai `null`, jangan ditebak.
- Satu postingan bisa berisi beberapa lowongan. Tiap lowongan dibedakan dengan `source_job_index`
  (0, 1, 2, …), dan duplikat dicegah oleh `unique (source_platform, source_post_id, source_job_index)`.
  Saat postingan diekstraksi ulang, gunakan urutan yang sama supaya baris lama ter-update, bukan terduplikasi.
- `extraction_status` (hasil AI) terpisah dari `publication_status` (tampil atau tidak).
- RLS aktif: `anon`/`authenticated` hanya bisa `SELECT` baris `published`. Penulisan
  dilakukan backend memakai service-role key (melewati RLS); jangan pernah dipakai di frontend.

Di kode:

- `jobInsertSchema`: validasi input sebelum insert (field tak dikenal ditolak, default terisi).
- `jobSchema`: bentuk baris dari database (termasuk `id`, `created_at`, `updated_at`).

## Tabel `source_posts`

Migration: `supabase/migrations/20261025010000_create_source_posts.sql`. Diisi oleh collector
(`src/collector/collect.ts`). Satu baris per postingan Instagram, termasuk yang ternyata bukan lowongan.

| Field | Keterangan |
| --- | --- |
| `source_post_id` | ID media dari Instagram API (numerik). `jobs.source_post_id` memakai nilai yang sama |
| `source_post_url` | Permalink postingan |
| `source_posted_at` | Waktu posting |
| `media_type` | `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM` |
| `caption` | Caption asli (`null` jika kosong) |
| `media_urls` | URL CDN Instagram untuk OCR. **Sementara dan bisa kedaluwarsa**, jadi proses OCR sebaiknya segera setelah collect. Gambar tidak disalin |
| `processing_status` | `pending` → `processed` (ada lowongan), `no_jobs` (bukan lowongan), atau `failed` |
| `processing_error`, `processing_attempts` | Untuk mencoba ulang postingan yang gagal |

Unik per `(source_platform, source_post_id)`. RLS aktif **tanpa policy**, sehingga tabel ini
hanya bisa diakses backend dan tidak terbaca publik.

## Project Supabase

- Project: `loker-lombok-instagram` (ref `vzzlkhapqmcaizusykfe`, region `ap-southeast-1`, Postgres 17).
- `.env` (tidak di-commit) berisi `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  dan `SUPABASE_DB_PASSWORD`. Secret key hanya untuk backend.

## Menjalankan migration

Folder ini sudah di-link ke project di atas, jadi cukup:

```bash
export SUPABASE_DB_PASSWORD=$(grep '^SUPABASE_DB_PASSWORD=' .env | cut -d= -f2-)
bunx supabase db push --linked
```

Untuk project Supabase lain, pilih salah satu:

**Opsi A: SQL Editor (paling sederhana).** Buka Dashboard Supabase → SQL Editor, tempel isi
file migration, lalu Run.

**Opsi B: Supabase CLI.**

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase db push
```

`db push` menjalankan file di `supabase/migrations/` yang belum diterapkan. Perubahan schema
berikutnya dibuat sebagai file migration baru, jangan mengedit file yang sudah diterapkan.
