# Runbook: pulihkan situs + relabel wilayah

Dipakai setelah kuota menulis database harian reset (19 Nov 2026 00:00 UTC /
07.00 WIB). Sampai saat itu situs berstatus `paused` dan setiap deploy ditolak
dengan "Sites are paused: daily database rows written allowance reached".

## 0. Cek kuota dulu

- `sites_inspect` (environment `preview`) → lihat allowance `dailyD1Writes`.
- Lanjut hanya bila `exhausted: false`. Jangan deploy berulang saat masih habis;
  percobaan deploy yang ditolak tidak memulihkan apa pun.

## 1. Bangun dan uji

```bash
npm ci
npm test              # harus 142/142
npm run build         # frontend (tsc + vite)
npm run build:site    # bundel worker ke deploy/worker.js
```

## 2. Deploy

- `sites_deploy` → site `c18b594d-319b-4283-9820-3f22076ae9aa`,
  environment `preview`, `manifestPath: sites.manifest.json`, `requestId` baru.
- Setelah sukses: `sites_inspect` untuk memastikan `published: true` dan
  `deployed_at` terbaru, lalu buka URL preview.

## 3. Audit relabel (read-only)

Di halaman **Robot AI** → panel **Label wilayah** → tombol **Audit relabel**.

Setara API (butuh sesi login, same-origin):

```
POST /api/corporate/relabel
{ "apply": false }
```

Yang dibaca dari respons:

- `total`, `changed`, `unchanged`
- `moves[]`: `name`, `from`, `to`, `reason`, `containsCoordinate`
- `violations[]`: titik di luar semua bbox (tidak dipindah)

Audit tidak menulis apa pun ke database, jadi aman diulang berkali-kali.

## 4. Terapkan relabel (sekali)

Tombol **Terapkan relabel** menjalankan audit ulang, menampilkan konfirmasi
(jumlah lead + 8 contoh perpindahan), lalu mengirim:

```
POST /api/corporate/relabel
{ "apply": true }
```

Hanya kolom `city` yang berubah; kontak, screening, validasi, dan penawaran
tidak disentuh. Setelah selesai, audit ulang: `changed` harus 0 dan
`violations` berisi titik yang memang di luar wilayah.

## 5. Jaga kuota penulisan

- Refresh wilayah tidak lagi menghapus lalu menulis ulang semua lead. Hanya
  baris baru/berubah yang ditulis; baris yang hilang dari OSM dihapus satu per
  satu. Refresh dengan data identik = 1 penulisan (baris cache) per wilayah.
- Skema database memakai penanda `corporate_meta.schema_version`, jadi DDL tidak
  dijalankan ulang setiap isolate dingin.
- Jangan menekan **Terapkan relabel** berulang kali; audit tidak menulis,
  apply menulis satu baris per lead yang benar-benar pindah.
- Bila kuota menipis lagi, tunda refresh manual massal dan biarkan robot
  berjalan sesuai jadwal.
