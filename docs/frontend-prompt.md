# Konteks proyek

Kamu membangun **frontend** untuk "Loker Lombok": website pencarian lowongan kerja di Lombok/NTB.
Data lowongan dikumpulkan otomatis dari postingan Instagram @lokerlombok, dibaca AI dari poster,
lalu langsung ditayangkan otomatis (admin bisa menyembunyikan yang salah). Website ini BUKAN tempat perusahaan memasang lowongan
dan BUKAN sistem lamaran: pengguna mencari lowongan, lalu melamar sendiri lewat kontak di lowongan
atau postingan Instagram aslinya.

Backend sudah jadi (Bun + Hono + Supabase). Frontend hanya berbicara ke API backend ini.
JANGAN mengakses Supabase langsung dan JANGAN menyimpan key/secret apa pun di frontend.

## Stack yang disarankan

Bun + TypeScript + React, dengan HTML imports lewat `Bun.serve()` (bukan Vite), dan Tailwind untuk
styling. Pakai `bun install`, `bun test`, `bun run`. Jangan menambah dependency tanpa alasan jelas.

## API

Base URL dari env, jangan di-hardcode. Lokal: `http://localhost:3000`. Produksi menyusul.
CORS sudah aktif untuk `GET`. Semua endpoint publik dan read-only, tanpa auth.

### GET /health
→ `200 {"status":"ok"}`, atau `503 {"status":"unavailable"}` jika database sedang tidak tersedia

### GET /jobs
Daftar lowongan yang sudah tayang, urut dari postingan terbaru. Semua query opsional:

| Param | Tipe | Keterangan |
|---|---|---|
| `q` | string, maks 100 | Cari di judul, perusahaan, deskripsi |
| `location` | string, maks 100 | Cocok sebagian dengan teks lokasi asli |
| `regency` | enum | Kabupaten/kota (lihat daftar di bawah) |
| `employment_type` | enum | Jenis kerja |
| `education_level` | enum | Pendidikan minimal |
| `page` | int 1–1000 | Default 1 |
| `limit` | int 1–50 | Default 20 |

Parameter kosong (`?q=`) dianggap tidak diisi. Parameter tak dikenal diabaikan.

Respons 200:
```json
{
  "data": [
    {
      "id": "7ef4d7a5-2c27-410b-93e2-0f907e9fa85b",
      "title": "Mitra Kurir",
      "company_name": "KURIR ANDA",
      "location": "Mataram dan Lombok Barat",
      "regencies": ["kota_mataram", "lombok_barat"],
      "description": "Bergabung sebagai mitra kurir. Hubungi Admin WhatsApp: 0822-3082-5457",
      "requirements": ["Pria/Wanita minimal 18 tahun", "Memiliki SIM C aktif"],
      "employment_type": null,
      "education_level": null,
      "salary_min": null,
      "salary_max": null,
      "salary_text": null,
      "deadline": null,
      "source_platform": "instagram",
      "source_account": "lokerlombok",
      "source_post_url": "https://www.instagram.com/p/DevoharBFDQ/",
      "source_post_id": "17981525924912211",
      "source_job_index": 0,
      "source_posted_at": "2026-10-21T05:14:57.000Z",
      "created_at": "2026-10-25T17:12:14.638Z",
      "updated_at": "2026-10-25T17:15:01.226Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "total_pages": 1 }
}
```

### GET /jobs/:id
- `200 {"data": { ...objek lowongan yang sama seperti di atas } }`
- `400 {"error":"Invalid job id"}` jika id bukan UUID
- `404 {"error":"Job not found"}` jika tidak ada atau belum/tidak lagi tayang

### Error lain
- `400 {"error":"Invalid query","details":{"limit":["Too big: expected number to be <=50"]}}`
- `404 {"error":"Not Found"}` (rute tidak ada)
- `500 {"error":"Internal Server Error"}`

### Tipe field (penting: banyak yang bisa null)

| Field | Tipe | Catatan |
|---|---|---|
| `title` | string | Selalu ada |
| `company_name`, `location`, `description`, `salary_text` | string \| null | |
| `regencies` | string[] | Bisa kosong `[]` (lokasi tidak disebut / di luar NTB) |
| `requirements` | string[] \| null | |
| `employment_type`, `education_level` | enum \| null | |
| `salary_min`, `salary_max` | number \| null | Rupiah. Bisa hanya min (mis. "3 juta++") |
| `deadline` | `"YYYY-MM-DD"` \| null | Tanggal saja, tanpa jam |
| `source_post_url` | string | Link postingan Instagram asli. Selalu tampilkan |
| `source_posted_at` | ISO datetime UTC \| null | Tampilkan dalam WITA (Asia/Makassar) |
| `source_job_index` | number | Satu postingan bisa berisi beberapa lowongan |

### Enum dan label tampilan

**regency:** `kota_mataram` Kota Mataram · `lombok_barat` Lombok Barat · `lombok_tengah` Lombok Tengah ·
`lombok_timur` Lombok Timur · `lombok_utara` Lombok Utara · `sumbawa_barat` Sumbawa Barat ·
`sumbawa` Sumbawa · `dompu` Dompu · `bima` Bima · `kota_bima` Kota Bima

**employment_type:** `full_time` Penuh waktu · `part_time` Paruh waktu · `contract` Kontrak ·
`internship` Magang · `freelance` Freelance

**education_level:** `sd` SD · `smp` SMP · `sma_smk` SMA/SMK · `d1`–`d4` D1–D4 · `s1` S1 · `s2` S2 · `s3` S3

## Fitur yang perlu dibangun

1. **API client bertipe**: satu modul berisi tipe TypeScript `Job` dan `Pagination` yang persis
   seperti kontrak di atas, fungsi `listJobs(params)` dan `getJob(id)`, plus penanganan error
   (400/404/500/jaringan). Validasi respons dengan Zod agar perubahan backend cepat ketahuan.
2. **Satu sumber label**: map enum ke label Indonesia (di atas), dipakai di filter dan tampilan.
3. **Halaman daftar lowongan**: pencarian `q` (dengan debounce), filter wilayah, jenis kerja, dan
   pendidikan, plus pagination. State filter disimpan di URL query supaya bisa dibagikan dan
   tombol back berfungsi.
4. **Kartu lowongan**: judul, perusahaan, wilayah, gaji, deadline, dan tanggal posting.
5. **Halaman detail** (`/lowongan/:id`): semua field, persyaratan sebagai daftar, cara melamar
   (biasanya ada di `description`), dan tombol **"Lihat postingan asli di Instagram"** ke
   `source_post_url`.
6. **State UI**: loading (skeleton), hasil kosong (dengan saran mengubah filter), error (dengan
   tombol coba lagi), dan halaman 404 untuk lowongan yang tidak ada.
7. **Format data**:
   - Gaji: kedua angka → "Rp2,5 jt – Rp3 jt"; hanya min → "Mulai Rp3 jt"; tanpa angka tapi ada
     `salary_text` → tampilkan teksnya; semua kosong → "Gaji tidak disebutkan".
   - Deadline: "29 Okt 2026"; tandai "Ditutup" bila sudah lewat (bandingkan tanggal WITA).
     Lowongan yang ditutup tetap bisa muncul di API.
   - Field `null` disembunyikan, jangan tampilkan "null" atau mengisi dengan tebakan.
8. **Halaman Tentang dan peringatan**: halaman `/tentang`, disclaimer di footer, dan peringatan di
   halaman detail. Pakai teks dari bagian "Copywriting" di bawah, jangan mengarang sendiri.
9. **Responsif dan mobile-first**: kebanyakan pengguna membuka dari HP. Aksesibel (label form,
   kontras, navigasi keyboard).
10. **Test**: unit test untuk formatter (gaji, tanggal, label) dan API client (mock `fetch`),
    memakai `bun test`.

## Copywriting

Gaya bahasa: santai, jelas, dan langsung ke poin. Pakai "kamu" untuk pengguna dan "kami" untuk
Loker Lombok. Hindari bahasa kaku seperti "Anda" atau "dengan ini".

### Halaman Tentang (`/tentang`)

> **Cari kerja di Lombok, tanpa scroll Instagram berjam-jam.**
>
> Loker Lombok mengumpulkan info lowongan dari sumber publik, seperti akun Instagram info loker,
> lalu merapikannya supaya gampang dicari, dibaca, dan difilter berdasarkan lokasi, pendidikan,
> dan jenis kerja.
>
> **Sebelum melamar, perhatikan ini**
>
> - **Kami pengumpul info, bukan perekrut.** Kami tidak menjamin setiap lowongan benar atau masih dibuka.
> - **Cek ulang di sumber aslinya.** Setiap lowongan punya tautan ke postingan aslinya, jadi kamu bisa verifikasi sendiri.
> - **Lamar kerja itu gratis.** Waspada kalau diminta bayar biaya pendaftaran atau mengirim data
>   sensitif seperti foto KTP, nomor rekening, atau kode OTP.

### Footer (semua halaman)

> Loker Lombok mengumpulkan info lowongan dari sumber publik dan bukan perekrut. Cek postingan
> aslinya sebelum melamar, dan jangan pernah membayar untuk melamar kerja.

### Halaman detail (dekat tombol "Lihat postingan asli di Instagram")

> ⚠️ Info ini dirangkum dari postingan publik dan bisa saja tidak lengkap atau sudah berubah. Cek
> postingan aslinya dulu, dan jangan pernah membayar untuk melamar.

## Di luar cakupan (jangan dibuat)

Login, form pasang lowongan, form lamaran, panel admin, dan akses langsung ke database.
Publikasi otomatis; menyembunyikan lowongan dilakukan admin lewat backend.

## Cara kerja

Sampaikan rencana singkat dulu, kerjakan bertahap (API client → daftar → detail → polish), dan
jalankan test serta type-check setiap selesai satu tahap.
