# Hallo Pane — Prospek & Penawaran

Aplikasi pribadi untuk mencatat perusahaan prospek dan menyimpan PDF penawaran
yang sudah dikirim, lalu melacak hasilnya sampai PO. Data dan PDF disimpan per
akun Freebuff (D1 + R2), sehingga bisa dibuka dari komputer maupun tablet.

## Alur

1. **Masuk** dengan akun Freebuff (Google, GitHub, atau Apple).
2. **Profil** — klik nama akun di pojok kiri bawah. Isi username (wajib),
   nomor WhatsApp/Telegram, dan alamat e-mail kontak. Username dipakai sebagai
   sapaan **Hallo …** di sidebar dan judul halaman, serta ditampilkan di pojok
   kiri bawah. Blok **Laporan komisi** menyembunyikan total komisi sampai PIN
   dimasukkan; tombol **Komisi** membuka rincian setelah PIN benar.
   Pilihan **Password PO** di profil mengatur PIN 6 digit: **Change PIN Password
   PO** meminta PIN lama lalu PIN baru, sedangkan **Forgot PIN Password PO**
   memverifikasi e-mail yang tersimpan di profil sebelum PIN baru dibuat.
3. **Prospek** — tambah perusahaan: nama, lokasi, email (opsional),
   no. PIC (opsional), dan tanggal visit. Lokasi baru bisa ditambahkan langsung
   dari form (pilihan awal: Kota Bogor, Kab. Bogor, Jakarta).
4. **Upload penawaran** — cukup unggah file PDF penawaran Anda (maks. 15 MB).
   Nomor penawaran dibaca otomatis dari teks PDF (format
   `001/UAS/QUOT-PANE/VII/2026`); bila tidak terdeteksi, isi manual. Nomor inilah
   yang muncul di report penawaran. Setelah tersimpan, isi PDF langsung
   ditampilkan; tombol **Kirim** membuka pilihan **WhatsApp** atau **E-mail**.
   Pesan memakai nama perusahaan dan nomor penawaran, ditandatangani dengan
   username, nomor WhatsApp, dan e-mail dari profil. Nomor PIC dan e-mail PIC
   terisi otomatis dari data perusahaan dan masih bisa diubah sebelum dikirim.
   PDF diunduh otomatis untuk dilampirkan. Tombol **Buka WhatsApp** membuka
   chat langsung ke nomor PIC dengan pesan terisi; tombol **Bagikan PDF + pesan**
   tersedia bila ingin mengirim lampiran lewat lembar berbagi perangkat.
   Jika PIC sudah membalas ke nomor bisnis dalam 24 jam terakhir, tombol berubah
   menjadi **Kirim PDF otomatis** dan PDF dikirim lewat WhatsApp Cloud API tanpa
   perlu melampirkan manual.
5. **Report penawaran** — daftar nomor penawaran dari PDF yang diunggah beserta
   perusahaan, tanggal, status, dan tautan PDF-nya.
6. **Cancel** — klik perusahaan yang belum punya PO, lalu tekan
   **Cancel** dan isi alasannya. Halaman **Cancel** mengumpulkan semua
   perusahaan yang batal bekerja sama beserta alasannya, dan jumlahnya tampil
   di sidebar.
7. **PO** — bila perusahaan jadi, unggah PDF PO yang mereka kirim. Status
   penawaran otomatis menjadi **PO** dan PDF PO tersimpan di akun Anda. Di
   dialog yang sama isi besaran PO (sebelum PPN) dan lama kontrak dalam tahun
   (opsional). PPN 11%, total termasuk PPN, dan komisi 10% (dari besaran PO
   sebelum PPN) dihitung otomatis, lalu tampil di detail perusahaan dan report.
   Nilai PO bisa diperbarui lewat tombol **Perbarui data PO** tanpa mengunggah
   ulang PDF.
8. **BAST** — menu **BAST** di sidebar menampilkan laporan perusahaan yang sudah
   memiliki dokumen BAST, status pengiriman, dan PDF bertanda tangan. Setelah PDF
   penawaran dan PO tersimpan, tombol **Buat BAST**
   membuka form Berita Acara Aktivasi Uji Terima. Isi tanggal, data pelanggan,
   lokasi pemasangan, layanan, biaya, tanggal instalasi, dan perangkat milik
   ASNET. Pratinjau PDF A4 dibuat otomatis sebelum diunggah; hasilnya menjadi
   file **PDF BAST** di perusahaan yang sama dan bisa diperbarui lewat
   **Perbarui BAST**.
9. **Laporan komisi** — tombol **Komisi** di profil menampilkan komisi 10% per
   PO beserta masa penerimaannya setelah PIN **Password PO** dimasukkan. Isi
   **tanggal mulai komisi** (tanggal, bulan, tahun) per PO. Komisi tetap 10% dari
   nilai PO (tanpa nominal per bulan terpisah); lama kontrak menentukan berapa
   lama komisi diterima, dan bila lama kontrak tidak diisi komisi diterima 1 kali.
10. **PIN komisi** — kartu PO di dashboard menampilkan komisi dalam keadaan
   tertutup. Klik ikon mata, masukkan PIN 6 digit, dan jumlah komisi terbuka
   sampai ikon mata ditekan lagi. Menekan **Kembali ke profil** dari laporan
   komisi mengunci total komisi lagi, baik di profil maupun dashboard. PIN
   disimpan sebagai hash (PBKDF2) di profil, bukan angka aslinya, dan ikut
   tersinkron ke akun.
11. **Hitungan bulanan** — kartu **Penawaran** menghitung penawaran aktif dari
    tiap perusahaan (penawaran yang dibatalkan berkurang), sedangkan kartu
    **Cancel** dan catatan **Penawaran** menampilkan jumlah bulan berjalan.
12. **Ringkasan bulanan** — klik kartu **Total perusahaan**, **Penawaran**,
    **PO**, atau **Cancel** untuk membuka ringkasan sesuai kartunya. Perusahaan
    dikelompokkan per bulan; tab **Cancel** menampilkan alasannya, dan klik satu
    perusahaan untuk membuka detailnya. Pada **Kunjungan**, perusahaan yang
    belum pernah visit ditampilkan terpisah di bagian **Belum visit**.

## Corporate Engine

Menu **Corporate Engine** (di atas Prospek) mengumpulkan perusahaan, hotel, dan
sekolah di seluruh wilayah awal: Jakarta, Depok, Bekasi, Kota/Kab. Bogor,
Tangerang, Serang, Subang, dan Kab. Sukabumi. Chip fokus menampilkan semua
wilayah awal, bukan hanya area tertentu. Kolom area diambil dari alamat
OpenStreetMap sehingga pencarian bisa difokuskan ke kecamatan/desa.

- Sumber data publik OpenStreetMap lewat Overpass API, tanpa kunci API. Data
  awal dibundel di `worker/corporate-seed.json` supaya halaman tidak kosong.
- Penarikan berjalan otomatis setiap halaman dibuka: maksimal dua wilayah yang
  datanya lebih tua dari 24 jam disegarkan, lalu robot memeriksa 6 situs
  perusahaan untuk mencari e-mail dan nomor PIC. Hasilnya disimpan di D1
  (`corporate_leads`, `corporate_city_refresh`, `corporate_email_lookup`)
  sehingga setiap kunjungan melanjutkan pekerjaan sebelumnya.
- Pencarian kontak membaca beranda, halaman kontak/tentang/tim/IT, tautan di
  sitemap, data terstruktur JSON-LD, serta tautan `tel:` dan WhatsApp. Nomor
  yang berlabel PIC/IT diutamakan, nomor faks dan nomor layanan umum dikesampingkan.
  Nama dan jabatan kontak IT juga diambil dari JSON-LD `Person` dan halaman tim.
- Jika secret `EXA_API_KEY` tersedia, saat detail perusahaan dibuka robot juga
  mencari profil LinkedIn dan halaman kontak publik lewat Exa Search. Hasilnya
  disimpan bersama sumber dan tautannya. Tanpa kunci ini, pencarian website tetap
  berjalan; dialog menjelaskan bahwa pencarian lintas web belum aktif.
- Klik **nama perusahaan** untuk membuka detail yang memuat nama, jabatan,
  sumber kontak IT, alamat website, alamat e-mail, dan nomor PIC. Robot langsung
  menelusuri hingga 10 halaman untuk melengkapi kontak; tombol **Cari kontak IT**
  mengulang pencarian.
- Tombol **Visit** memasukkan perusahaan ke daftar Prospek berstatus **Prospek**
  (e-mail, nomor PIC, lokasi, dan website ikut terisi) lalu membuka detailnya.
- Tombol **Perbarui** memaksa penarikan satu wilayah; server membatasi satu
  penyegaran per wilayah setiap 30 menit.
- Hosting Worker tidak menjalankan proses latar 24 jam, jadi penarikan terjadi
  saat aplikasi dibuka, bukan lewat penjadwal terpisah.

### Robot Corporate 24/7

Halaman **Robot AI** dibuka dari **Profil** (tombol di kiri bawah) → **Robot AI**,
bukan dari Corporate Engine. Panel ini menjalankan tiga tahap:

1. **Finding** — menilai sinyal kebutuhan internet/WiFi, access point, Mikrotik,
   dan upgrade jaringan dari website resmi serta hasil pencarian publik. Skor
   tinggi harus punya bukti, bukan hanya tebakan dari kategori.
2. **Klarifikasi** — mencari nama/jabatan IT/PIC, e-mail, dan telepon dari
   website, LinkedIn/direktori publik, lalu memeriksa domain e-mail lewat DNS
   MX. Status **Terverifikasi publik** berarti bukti publik saling mendukung;
   tetap konfirmasi saat menghubungi PIC.
3. **Publish** — menyimpan hasil ke D1, menambahkannya ke Prospek bila
   **Auto ke Prospek** aktif, mengirim ringkasan ke Telegram, dan menjalankan
   **Agen WhatsApp** untuk menghubungi PIC hasil Klarifikasi dengan template
   penawaran internet, upgrade perangkat, Data Center, dan server.

Robot tidak mengakses CCTV, kamera, akun sosial media pribadi, atau area yang
membutuhkan login. Verifikasi hanya memakai sumber publik dan data bisnis yang
memang dipublikasikan.

**Validasi koordinat.** Robot tidak lagi memakai hasil geocoder yang hanya
menemukan nama jalan. Titik harus cocok dengan nama entitas (misalnya
“Lazuardi Global Islamic School”, bukan “Jalan Garuda Ujung”), berasal dari node
OpenStreetMap entitas, atau dikonfirmasi manual dari Google Maps. Koordinat pusat
wilayah dan hasil pencarian alamat yang belum cocok ditandai **perlu dicek** dan
tidak dikirim ke Telegram atau ditulis ke Prospek otomatis. Di kartu Prospek,
buka **Edit data perusahaan**, tempel koordinat dari Google Maps, lalu centang
konfirmasi. Banner di halaman Prospek menampilkan jumlah titik yang perlu dicek.

**Konfigurasi.** Tambahkan lewat Sites → Secrets, jangan menuliskan nilainya di
dalam file proyek:

- `EXA_API_KEY` — mengaktifkan pencarian LinkedIn/direktori publik. Buat key di
  `https://dashboard.exa.ai/api-keys`, lalu simpan nilainya sebagai secret ini.
- `OPENSANCTIONS_API_KEY` — mengaktifkan agen Klarifikasi **OpenSanctions** untuk
  screening nama perusahaan/PIC terhadap sanksi, debarment, dan PEP. Buat key di
  `https://www.opensanctions.org/account/`. Untuk yente self-host, isi
  `OPENSANCTIONS_API_URL` (misalnya `https://yente.internal`) dan key boleh
  dikosongkan bila server tidak meminta autentikasi. Opsional:
  `OPENSANCTIONS_DATASET` (default `default`) dan `OPENSANCTIONS_THRESHOLD`
  (default `0.8`). Sumber datanya adalah
  `https://github.com/opensanctions/opensanctions`; API `/match` hanya menyaring
  risiko, bukan membuktikan kepemilikan nomor telepon atau alamat e-mail PIC.
  Data OpenSanctions berlisensi CC BY-NC 4.0; untuk pemakaian komersial pastikan
  lisensi/akun yang sesuai dengan ketentuan penyedia.
- `TELEGRAM_BOT_TOKEN` — token bot dari BotFather.
- `TELEGRAM_CHAT_ID` — chat ID tujuan. Nomor telepon saja bukan chat ID. Buat
  bot lewat **@BotFather**, simpan tokennya sebagai `TELEGRAM_BOT_TOKEN`, buka
  bot dan kirim `/start`, lalu tekan **Deteksi chat ID** di panel robot. Chat ID
  akan disimpan ke pengaturan robot.
- `TELEGRAM_TARGET_PHONE` — opsional, default `+6285156590261` untuk label target.
- `ROBOT_CRON_SECRET` — mengaktifkan endpoint cron. Buat nilai acak yang panjang.
- `WHATSAPP_ACCESS_TOKEN` — token akses WhatsApp Cloud API untuk mengirim PDF
  dan template outreach.
- `WHATSAPP_PHONE_NUMBER_ID` — ID nomor bisnis dari dashboard Meta.
- `WHATSAPP_APP_SECRET` — App Secret Meta untuk memverifikasi tanda tangan webhook.
- `WHATSAPP_VERIFY_TOKEN` — nilai acak yang Anda isi juga saat mengatur webhook.
- `WHATSAPP_API_VERSION` — opsional, default `v23.0`.
- `WHATSAPP_OUTREACH_TEMPLATE` — nama template yang sudah disetujui Meta untuk
  kontak pertama. Wajib diisi agar Agen WhatsApp aktif.
- `WHATSAPP_OUTREACH_LANGUAGE` — opsional, default `id`.
- `WHATSAPP_OUTREACH_ENABLED` — isi `true` untuk mengaktifkan pengiriman template
  otomatis. Tanpa nilai ini agen tetap nonaktif meskipun kredensial lain ada.

  Atur webhook Meta ke `https://<domain-site>/api/whatsapp/webhook`, berlangganan
  event `messages`, lalu masukkan verify token yang sama. Pengiriman PDF dari
  penawaran tetap hanya berjalan setelah PIC mengirim pesan ke nomor bisnis
  dalam 24 jam terakhir. Agen WhatsApp memakai **template resmi** untuk kontak
  pertama; pesan bebas tidak dipakai karena Meta membatasi percakapan di luar
  jendela 24 jam. Template harus punya dua variabel body: `{{1}}` nama PIC dan
  `{{2}}` nama perusahaan/sekolah/hotel. Contoh body yang bisa diajukan:

  ```text
  Halo Bapak/Ibu {{1}}, saya dari tim ASNET. Kami menawarkan kerja sama internet,
  upgrade bandwidth, dan penguatan perangkat untuk {{2}}. Kami juga melayani
  pembuatan/maintenance Data Center dan server. Apakah Bapak/Ibu berkenan
  berdiskusi singkat?
  ```

  Template marketing adalah pesan berbayar sesuai ketentuan Meta. Agen hanya
  memasukkan lead baru yang sudah lolos Klarifikasi; antrean lama tidak dikirim
  massal saat kredensial pertama kali diaktifkan.

**Draft Agen WhatsApp.** Logika percakapan ada di `worker/whatsapp-agent.js`
dan sengaja belum dihubungkan ke webhook atau pengiriman. Draft ini:

- menyimpan state percakapan per nomor PIC di D1;
- menggali kebutuhan internet, upgrade, perangkat, Data Center, dan server;
- tidak menyebut harga, diskon, SLA, atau kontrak;
- membuat ringkasan handoff ketika client minta harga/manusia, komplain, atau
  menyetujui ringkasan kebutuhan;
- mengarahkan komunikasi lanjutan ke nomor WhatsApp pribadi pemilik;
- menutup percakapan setelah permintaan berhenti;
- menyimpan balasan sebagai `draft`, bukan mengirimkannya.

Agen ini belum aktif dan tidak memakai Jenova berbayar. Pengaktifan menunggu
nama gateway WhatsApp, nomor pengirim, template yang disetujui, serta keputusan
penyedia AI. Satu pengingat setelah 24 jam sudah dijadwalkan di data draft,
tetapi belum dikirim.

**Adapter AI.** `worker/whatsapp-ai.js` memakai bentuk OpenAI-compatible dan
belum dihubungkan ke agen. Isi lewat Sites → Secrets bila endpoint sudah dipilih:

- `WHATSAPP_AI_BASE_URL` — contoh Groq `https://api.groq.com/openai/v1`, atau
  Ollama milik sendiri `https://llm.domain-anda.com/v1`.
- `WHATSAPP_AI_API_KEY` — API key endpoint tersebut. Ollama lokal dapat memakai
  nilai placeholder, tetapi endpoint yang menghadap internet sebaiknya diberi
  autentikasi sendiri.
- `WHATSAPP_AI_MODEL` — contoh `qwen/qwen3.8-27b` di Groq atau model Hermes di
  Ollama.
- `WHATSAPP_AI_ENABLED` — isi `true` setelah endpoint dan model diuji.
- `WHATSAPP_AI_FALLBACK_BASE_URL`, `WHATSAPP_AI_FALLBACK_API_KEY`, dan
  `WHATSAPP_AI_FALLBACK_MODEL` — opsional, untuk Ollama + Hermes 4 sebagai
  cadangan bila Groq gagal atau kena batas.

Susunan yang disarankan: **Groq free tier** sebagai provider utama, lalu
**Ollama + Hermes 4 14B** (Apache 2.0) sebagai fallback di VPS/PC terpisah.
Groq saat audit tidak menyediakan model Hermes; yang dipadukan adalah endpoint
Groq dengan model Hermes yang berjalan di Ollama. Ollama tidak dapat berjalan di
dalam Worker Cloudflare; Worker hanya memanggil endpoint HTTPS-nya. Model 14B
kuantisasi membutuhkan sekitar 16 GB RAM/VRAM; untuk percakapan langsung, GPU
lebih realistis. Endpoint gratis dapat memiliki batas harian dan kebijakan
retensi; jangan kirim data client sebelum kebijakan privasi endpoint ditinjau.
Detail arsitektur dan audit gateway ada di
[`docs/whatsapp-ai-and-gateway.md`](docs/whatsapp-ai-and-gateway.md).

**Pemicu 24/7.** Worker tidak hidup terus-menerus. Halaman Robot AI dan Corporate
Engine menjalankan heartbeat saat dibuka, dan tombol **Jalankan sekarang**
memproses batch manual. Untuk jadwal penuh, panggil endpoint berikut setiap 15 menit dari cron
Cloudflare, GitHub Actions, atau scheduler lain:

```bash
curl -X POST "https://<domain-site>/api/corporate/robot/cron" \
  -H "Authorization: Bearer $ROBOT_CRON_SECRET"
```

Endpoint menolak permintaan tanpa secret. Workflow contoh ada di
`.github/workflows/corporate-robot.yml`; isi `ROBOT_CRON_URL` (URL lengkap
endpoint) dan `ROBOT_CRON_SECRET` di GitHub Actions secrets, lalu push workflow
agar jadwal aktif. Koneksi repository GitHub di Freebuff tidak otomatis membuat
secret Actions; secret tetap harus diisi di repository GitHub. Worker juga
mengekspor handler `scheduled()` untuk deployment yang mendukung Cron Trigger.
Manifest Sites saat ini menolak field `triggers`, sehingga jadwal penuh perlu
dipanggil oleh scheduler eksternal (GitHub Actions, cron Cloudflare, atau
layanan cron lain).

Tanpa `EXA_API_KEY`, tahap Finding tetap membaca website; tanpa Telegram, lead
tetap diterbitkan ke aplikasi dan dapat dihubungi dari Corporate Engine/Prospek.

Data disimpan otomatis setelah setiap perubahan. Indikator di sidebar
menunjukkan status sinkronisasi. Jika akun yang sama membuka data di dua
perangkat dan terjadi perubahan bersamaan, aplikasi menampilkan pilihan untuk
memuat versi terbaru atau menyimpan versi di halaman ini.

## Pengembangan

```bash
npm install
npm run build:site           # build React + bundle Worker
npx wrangler dev --config wrangler.local.jsonc   # http://localhost:8787
```

`wrangler.local.jsonc` memakai client ID pengembangan dan database D1 lokal.
Login lokal memakai callback `http://localhost:8787/auth/freebuff/callback`.
Untuk preview cepat antarmuka saja tanpa login, `npm run dev` menjalankan Vite
di port 3001, tetapi API akun hanya tersedia lewat Worker.

## Deploy

- `sites.manifest.json` adalah manifest Freebuff Sites (Worker + `dist`).
- Build: `npm run build:site`
- Worker menangani `/auth/freebuff/*`, `/api/data`, lalu menyajikan aset statis.
- Variabel `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER`, dan `APP_ORIGIN` diinjeksi
  oleh Sites saat deploy. Database D1 memakai binding `DB`, penyimpanan PDF
  memakai bucket R2 binding `FILES`. Tambahkan `EXA_API_KEY` lewat Sites →
  Secrets untuk mengaktifkan pencarian LinkedIn/direktori publik.
- Skema tabel `app_state` dibuat otomatis oleh Worker pada permintaan pertama.
- PDF penawaran, PO, dan BAST disimpan di R2 dengan prefiks `user.sub`, jadi
  hanya pemilik akun yang bisa membukanya lewat `/api/files/<id>`. Tombol
  **Unduh** memakai `?download=1`; tombol **Cetak** menampilkan halaman PDF
  lalu memakai dialog cetak browser, termasuk printer Wi-Fi atau IP yang
  terhubung ke perangkat Android.

## Stack

Vite + React + TypeScript, Cloudflare Worker, D1, R2, Sign in with Freebuff, dan jsPDF untuk BAST.
Nomor penawaran dibaca dari PDF memakai `pdfjs-dist` di browser.
