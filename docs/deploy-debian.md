# Deploy ke server Debian

Panduan menjalankan backend di VPS Debian 12/13 dengan systemd dan Caddy (HTTPS otomatis).
Database tetap di Supabase; server hanya menjalankan dua proses:

- **API** (`bun src/index.ts`): `/health` dan `/jobs` di port 3000, di belakang Caddy.
- **Pipeline** (`bun scripts/pipeline.ts`): berjalan terus, satu putaran tiap 15 menit
  (`PIPELINE_CRON`), mengikuti jadwal dari `bun run admin` menu 8 kalau sudah diatur.

Perintah ditandai **(root)** atau **(loker)**. Aplikasi dijalankan oleh user `loker`, bukan root.

## 1. Siapkan server (root)

```bash
apt update && apt upgrade -y
apt install -y git curl unzip ufw caddy
adduser --disabled-password --gecos "" loker
```

Kalau paket `caddy` tidak ditemukan, pasang dari repo resmi Caddy:
https://caddyserver.com/docs/install#debian-ubuntu-raspbian

## 2. Install Bun dan kode (loker)

```bash
su - loker
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

git clone https://github.com/ppunns/api-lokerlombok.git ~/app
cd ~/app
bun install --production
cp .env.example .env
nano .env
chmod 600 .env
```

Isi `.env` langsung di server, jangan lewat git. Yang dibutuhkan:

| Variabel                        | Dipakai oleh                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `API_DATABASE_URL`              | API (role read-only `api_readonly`, lihat [database.md](database.md)) |
| `DATABASE_URL`                  | pipeline dan script admin                                             |
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | pipeline (lihat [instagram-access.md](instagram-access.md))           |
| `GEMINI_API_KEY`                | pipeline                                                              |

API otomatis memakai `API_DATABASE_URL` kalau di-set, jadi tetap read-only walaupun
`DATABASE_URL` ada di file yang sama.

Uji sebelum dijadikan service:

```bash
bun scripts/check-instagram.ts  # baca profil IG, tidak memakai kuota Gemini
bun run schedule                # cek koneksi database dan jadwal
bun scripts/check-api-role.ts   # pastikan API_DATABASE_URL benar-benar read-only
bun src/index.ts                # dari terminal lain: curl localhost:3000/health, lalu Ctrl+C
exit
```

## 3. Service systemd (root)

```bash
cat > /etc/systemd/system/loker-api.service <<'EOF'
[Unit]
Description=Loker Lombok API
After=network-online.target
Wants=network-online.target

[Service]
User=loker
WorkingDirectory=/home/loker/app
EnvironmentFile=/home/loker/app/.env
ExecStart=/home/loker/.bun/bin/bun src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sed -e 's/Loker Lombok API/Loker Lombok pipeline/' \
    -e 's#bun src/index.ts#bun scripts/pipeline.ts#' \
    /etc/systemd/system/loker-api.service > /etc/systemd/system/loker-pipeline.service

systemctl daemon-reload
systemctl enable --now loker-api loker-pipeline
systemctl status loker-api loker-pipeline --no-pager
```

Log: `journalctl -u loker-api -f` dan `journalctl -u loker-pipeline -f`.

## 4. Akses dari internet: HTTPS dan firewall (root)

Caddy menerima HTTPS di port 443 dan meneruskan ke API di `localhost:3000`, jadi port 3000 tidak
perlu dibuka. Sertifikat dibuat otomatis oleh Caddy. Nama host-nya:

- **Belum punya domain:** pakai [sslip.io](https://sslip.io), yang memetakan nama ke IP tanpa
  pendaftaran. IP `203.0.113.5` menjadi `203-0-113-5.sslip.io` (titik diganti strip). Cek IP
  publik server dengan `curl -4 ifconfig.me`.
- **Punya domain:** buat record A, mis. `api.domainkamu.com` → IP server.

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
203-0-113-5.sslip.io {
    reverse_proxy localhost:3000
}
EOF
systemctl reload caddy

ufw allow OpenSSH            # wajib sebelum enable, supaya SSH tidak terputus
ufw allow 80,443/tcp
ufw enable
```

Buka `https://203-0-113-5.sslip.io/health` dari perangkat lain. Pindah ke domain sendiri nanti:
ganti nama host di Caddyfile, lalu `systemctl reload caddy`.

Kalau tidak bisa diakses:

- `curl localhost:3000/health` di server harus berhasil dulu (`journalctl -u loker-api`).
- Buka port 80 dan 443 juga di firewall panel penyedia VPS, kalau ada (terpisah dari `ufw`).
- Sertifikat gagal: `journalctl -u caddy -n 50 --no-pager`. Biasanya port 80 masih tertutup atau
  nama host belum mengarah ke IP server.

Darurat tanpa HTTPS: `ufw allow 3000/tcp`, API di `http://IP-server:3000`. Frontend yang di-hosting
dengan HTTPS tidak bisa memanggil API `http://` (diblokir browser), jadi ini hanya untuk uji coba.

Setelah frontend punya alamat, batasi CORS dengan `CORS_ORIGINS=https://alamat-frontend` di `.env`
lalu `systemctl restart loker-api` (default `*`, aman karena API hanya GET).

## 5. Pemakaian sehari-hari

```bash
# menu admin (review, ambil lowongan, jadwal, reset)
su - loker -c 'cd ~/app && bun run admin'
su - loker -c 'cd /home/loker/app && /home/loker/.bun/bin/bun run admin'

# update kode (root)
su - loker -c 'cd ~/app && git pull && bun install --production'
systemctl restart loker-api loker-pipeline
```

Kalau ada migration baru di `supabase/migrations/`, terapkan ke Supabase dulu (lihat
[database.md](database.md)) sebelum restart.

## Catatan

- Repo ini publik: `.env` hanya ada di server dan sudah di-`.gitignore`. Jangan commit dari server
  (`git pull` saja), dan jangan menaruh token atau password di file lain yang ter-track.
- **Matikan Cloud Scheduler dan Cloud Run Job** kalau sebelumnya deploy ke Google Cloud. Advisory
  lock mencegah dua putaran berjalan bersamaan, tapi Instagram tetap dipanggil dari dua tempat.
- Selama jadwal belum diatur (menu 8), pipeline mengambil postingan setiap putaran (15 menit).
- `IG_ACCESS_TOKEN` punya masa berlaku. Kalau log pipeline menunjukkan error token, buat token
  baru, perbarui `.env`, lalu `systemctl restart loker-pipeline`.
- Restart pipeline di tengah putaran aman: lock dilepas saat koneksi putus, dan postingan yang belum
  selesai diekstrak diproses di putaran berikutnya.
