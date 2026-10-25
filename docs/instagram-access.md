# Validasi akses Instagram

Status: **belum tervalidasi dengan request nyata**. Dokumen ini merangkum dokumentasi resmi
Meta (dicek 25 Oktober 2026) dan langkah untuk membuktikannya. Collector belum boleh dibuat
sebelum `scripts/check-instagram.ts` berhasil.

## Jalur resmi: Business Discovery API

Satu-satunya API resmi untuk membaca postingan akun **lain** adalah Business Discovery
(Instagram API with Facebook Login). Instagram Basic Display API sudah dihentikan.

Request dilakukan **dari akun Instagram kita sendiri**, dengan target ditunjuk lewat username:

```
GET https://graph.facebook.com/<IG_USER_ID>
  ?fields=business_discovery.username(lokerlombok){media{caption,media_type,media_url,permalink,timestamp,children{media_url}}}
```

Field media yang bersifat publik dan relevan: `caption`, `media_type` (`IMAGE`, `VIDEO`,
`CAROUSEL_ALBUM`), `media_url`, `permalink`, `timestamp`, `children` (isi carousel).
Pagination memakai cursor `before`/`after` (tanpa `next`/`previous`).

### Syarat

| Syarat | Keterangan |
| --- | --- |
| Akun target | @lokerlombok harus akun **Business atau Creator**. Akun personal tidak bisa dibaca. Akun dengan batas umur juga tidak. **Belum dicek.** |
| Akun kita | Akun Instagram **Business/Creator** milik kita yang terhubung ke **Facebook Page** |
| Meta app | App di developers.facebook.com dengan produk Instagram (Facebook Login) |
| Token | Facebook User access token dari pengguna yang mengelola Page tersebut |
| Permission | `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` (+ `ads_management` atau `ads_read` jika peran Page diberikan lewat Business Manager) |
| App review | Tidak disebut di halaman Business Discovery. Untuk dipakai oleh akun sendiri (mode development, kita sebagai admin app) umumnya cukup; perlu dicek ulang jika app dipakai pengguna lain |

### Batasan yang diketahui

- `media_url` bisa tidak ada untuk video dengan audio berlisensi atau reels yang download-nya
  dimatikan. Jadikan opsional dan pakai `permalink` sebagai cadangan.
- Hanya baca, dan hanya field publik.
- Rate limit: dokumen Business Discovery tidak menyebut angka. Instagram Platform memakai
  Business Use Case rate limit; angka dari sumber pihak ketiga (mis. 200 call/jam) **belum
  terverifikasi**. Pantau header `X-Business-Use-Case-Usage` saat uji.
- Teks lowongan sering ada di **gambar poster**, bukan caption, sehingga OCR tetap dibutuhkan.
  `media_url` dari CDN Instagram bersifat sementara. Unduh hanya untuk diproses, jangan disimpan
  (sesuai CLAUDE.md).

## Yang tidak dilakukan

- Scraping halaman instagram.com atau API internal/tidak resmi: melanggar ketentuan Instagram,
  mudah rusak, dan berisiko akun diblokir.
- Layanan scraping pihak ketiga berbayar: belum disetujui.

## Langkah validasi

1. Pastikan @lokerlombok akun Business/Creator. Di aplikasi Instagram, akun profesional
   biasanya menampilkan kategori di bawah nama, mis. "Layanan Ketenagakerjaan". Hasil akhirnya
   tetap dibuktikan di langkah 5.
2. Siapkan akun Instagram Business/Creator milik sendiri, lalu hubungkan ke sebuah Facebook Page.
3. Buat Meta app (tipe Business) di https://developers.facebook.com/apps, lalu tambahkan
   produk **Instagram → API setup with Facebook login**.
4. Di Graph API Explorer: pilih app, minta permission di atas, generate User token, lalu panggil
   `GET /me/accounts?fields=instagram_business_account` untuk mendapatkan `IG_USER_ID`.
5. Isi `.env`:

   ```
   IG_USER_ID=...
   IG_ACCESS_TOKEN=...
   ```

   lalu jalankan:

   ```bash
   bun scripts/check-instagram.ts lokerlombok
   ```

   Berhasil jika akun dan 5 postingan terakhir tampil (caption, tipe, ada/tidaknya `media_url`).
   Token dari Explorer berumur pendek (sekitar 1 jam). Token jangka panjang baru diurus saat
   membuat collector.

## Hasil yang perlu dicatat setelah uji

- Apakah @lokerlombok terbaca (atau error, mis. `#110` / akun bukan Business).
- Berapa persen postingan yang informasi lowongannya ada di caption, dan berapa yang hanya di gambar.
- Apakah carousel (`children`) sering dipakai.
- Nilai header rate limit setelah beberapa request.

## Sumber

- Business Discovery: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery
- Referensi IG User business_discovery: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Referensi IG Media (field publik): https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
- Changelog Instagram Platform: https://developers.facebook.com/documentation/instagram-platform/changelog
