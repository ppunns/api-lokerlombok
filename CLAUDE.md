Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun check` instead of `tsc --noEmit`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Type checking

Use `bun check` to type check the project. It reads `tsconfig.json` and reports the same errors as `tsc`.

- `bun check src/index.ts` checks one file and what it imports
- `bun --check src/index.ts`, `bun test --check` and `bun build --check` type check first, and do nothing else if there is an error

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

# CLAUDE.md — Loker Lombok Instagram

## 1. Project Overview

Loker Lombok Instagram adalah website pencarian lowongan kerja yang mengumpulkan informasi dari postingan Instagram, dimulai dari akun @lokerlombok.

Tujuan produk:

- Memudahkan pengguna mencari lowongan tanpa harus scroll Instagram.
- Mengubah informasi dari caption dan poster menjadi data lowongan terstruktur.
- Menyediakan pencarian berdasarkan posisi, lokasi, dan kriteria lainnya.
- Menyediakan tautan ke postingan Instagram sumber asli.

Website ini bukan platform bagi perusahaan untuk memasang lowongan dan bukan sistem pengelolaan lamaran kerja.

## 2. Technology Stack

Gunakan teknologi berikut kecuali ada alasan teknis kuat untuk mengubahnya:

- Runtime dan package manager: Bun.
- Language: TypeScript.
- Backend API: Hono, berjalan secara native di Bun.
- Database: Supabase PostgreSQL.
- Schema validation: Zod.
- Testing: bun:test.
- Frontend: belum menjadi scope tahap backend awal.

Jangan menambahkan framework atau dependency baru tanpa kebutuhan yang jelas.

Jangan menggunakan npm, pnpm, yarn, Express, atau runtime Node.js terpisah untuk menjalankan backend.

## 3. Product Architecture

Alur utama sistem:

Instagram source
→ Post collector
→ OCR
→ AI extraction
→ Schema validation
→ Duplicate detection
→ Database
→ Search API
→ Website

Setiap bagian harus memiliki tanggung jawab yang jelas dan dapat diuji secara terpisah.

Jangan mengimplementasikan seluruh pipeline sekaligus sebelum fondasi database dan API tervalidasi.

## 4. Development Principles

### Understand before coding

- Periksa hanya file yang relevan dengan tugas saat ini.
- Jangan membaca seluruh repository secara otomatis.
- Mulai dengan memeriksa struktur direktori dan konfigurasi yang diperlukan.
- Gunakan hasil pemeriksaan sebelumnya jika masih relevan.
- Jangan mengulang analisis atau membaca file yang sama tanpa alasan.

### Plan before implementation

- Untuk tugas nontrivial, sampaikan rencana singkat sebelum mengubah file.
- Pecah pekerjaan menjadi tahapan kecil yang bisa diuji.
- Fokus pada tujuan yang diminta saat ini.
- Jangan menambahkan fitur tambahan tanpa persetujuan.

### Minimal and maintainable code

- Utamakan solusi sederhana dan mudah dipelihara.
- Hindari overengineering, abstraksi yang belum dibutuhkan, dan duplikasi kode.
- Jangan membuat file, konfigurasi, dependency, atau dokumentasi yang tidak diperlukan.
- Ikuti pola dan struktur yang sudah ada jika masih sesuai.
- Jangan mengganti library atau arsitektur tanpa alasan yang terukur.

### Protect existing work

- Jangan menimpa atau menghapus file tanpa memeriksa fungsinya.
- Jangan melakukan refactor besar untuk tugas kecil.
- Jangan menjalankan perintah destruktif tanpa persetujuan.
- Pertahankan perubahan pengguna yang tidak berkaitan dengan tugas.

## 5. Data and Validation Rules

Data lowongan harus memiliki struktur yang konsisten.

Field yang dapat digunakan:

- title
- company_name
- location
- description
- requirements
- employment_type
- education_level
- salary_min
- salary_max
- salary_text
- deadline
- source_platform
- source_account
- source_post_url
- source_post_id
- source_posted_at
- raw_caption
- ocr_text
- extraction_status
- publication_status
- created_at
- updated_at

Ketentuan:

- Gunakan Zod untuk memvalidasi input dan hasil ekstraksi.
- Informasi yang tidak tersedia harus bernilai null jika field bersifat opsional.
- Jangan mengarang gaji, perusahaan, persyaratan, lokasi, atau deadline.
- Simpan tautan dan informasi sumber agar data dapat ditelusuri.
- Cegah duplikasi berdasarkan identitas postingan sumber.
- Pisahkan status ekstraksi AI dari status publikasi.
- Hasil OCR atau AI tidak otomatis berarti lowongan sudah terverifikasi.
- Pertahankan caption dan teks sumber untuk audit jika diperlukan.

## 6. Instagram Integration

- Jangan mengasumsikan API Instagram dapat membaca seluruh postingan akun publik.
- Validasi ketersediaan akses, izin, dan batasan API sebelum membuat collector.
- Jangan membuat scraper yang bergantung pada asumsi akses yang belum diuji.
- Pisahkan mekanisme pengambilan data dari logika bisnis.
- Sediakan jalur input data contoh atau manual untuk menguji pipeline.
- Jangan menghubungkan layanan OCR atau AI berbayar sebelum kebutuhan dan konfigurasi disetujui.
- Jangan menyimpan salinan gambar jika belum dibutuhkan atau belum dipastikan boleh digunakan.

## 7. Security

- Jangan menaruh API key, password, access token, atau service-role key di source code.
- Gunakan environment variables untuk konfigurasi rahasia.
- Jangan mengekspos Supabase service-role key ke frontend.
- Validasi seluruh input API.
- Batasi akses ke endpoint admin dan operasi tulis.
- Jangan membuka akses tulis database kepada pengunjung publik.
- Jangan mencatat rahasia atau data sensitif ke log.

## 8. Testing and Verification

Setelah perubahan:

- Jalankan test yang relevan menggunakan Bun.
- Jalankan type-check jika tersedia.
- Periksa error dan perbaiki error yang disebabkan oleh perubahan.
- Jangan mengklaim test berhasil jika belum dijalankan.
- Jangan menjalankan seluruh rangkaian test jika perubahan hanya membutuhkan pemeriksaan terarah dan test tersebut tidak diperlukan.

Gunakan perintah yang sesuai dengan konfigurasi project, misalnya:

- `bun test`
- `bun run typecheck` jika script tersedia.

## 9. Token and Context Efficiency

- Gunakan pendekatan read only what you need.
- Jangan mencetak file besar secara penuh jika cukup membaca bagian relevan.
- Jangan membaca ulang semua dokumentasi pada setiap tugas.
- Hindari mengulang penjelasan, rencana, dan laporan yang sama.
- Jangan melakukan pencarian dependency atau solusi alternatif secara luas jika kebutuhan sudah jelas.
- Utamakan perubahan kecil dan hasil yang dapat diverifikasi.
- Jangan mengorbankan keamanan, validasi, atau kualitas hanya demi mengurangi token.

## 10. Scope Control

Tahap backend MVP:

1. Project setup dan konfigurasi.
2. Schema lowongan dan database.
3. Health-check API.
4. Search API dengan filter dan pagination.
5. Detail lowongan.
6. Testing dan dokumentasi dasar.
7. Jalur input data contoh untuk pengujian.

Tahap berikutnya, setelah fondasi tervalidasi:

1. Pengambilan postingan Instagram.
2. OCR.
3. AI extraction ke schema terstruktur.
4. Duplicate detection dan validasi.
5. Proses publikasi dan penanganan lowongan kedaluwarsa.
6. Integrasi frontend.

Jangan mengerjakan tahap berikutnya secara otomatis ketika tahap sebelumnya belum tervalidasi.

## 11. Completion Report

Setelah menyelesaikan tugas, laporkan secara ringkas:

- Apa yang diimplementasikan.
- File yang dibuat atau diubah.
- Test dan pemeriksaan yang benar-benar dijalankan.
- Hasil test.
- Masalah atau keterbatasan yang masih ada.
- Langkah berikutnya yang paling relevan.

Jangan memberikan laporan panjang yang mengulang isi kode atau seluruh proses implementasi.
