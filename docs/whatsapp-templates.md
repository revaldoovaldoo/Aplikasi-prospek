# Draft Template WhatsApp ASNET

Status: **contoh untuk ditinjau**. Belum dimasukkan ke kode, belum didaftarkan ke
Meta, dan belum dikirim ke siapa pun.

Semua template di bawah adalah **Marketing template** karena merupakan kontak
pertama. Meta dapat menolak atau mengubah kategori. Jangan mengirim sebelum
template disetujui.

## 1. Kontak pertama

Nama template: `asnet_internet_outreach`  
Bahasa: `id`  
Kategori: Marketing  
Variabel body:

- `{{1}}` — nama PIC
- `{{2}}` — nama perusahaan/sekolah/hotel

Body:

```text
Halo Bapak/Ibu {{1}}, saya asisten digital ASNET yang nantinya akan dihubungkan dengan rekanan kami Bp. Pane. Kami membantu kebutuhan internet, upgrade jaringan dan perangkat, serta pembangunan atau perawatan Data Center dan server untuk {{2}}. Apakah Bapak/Ibu berkenan berdiskusi singkat mengenai kebutuhan saat ini?
```

Catatan:

- Tidak menyebut harga, diskon, SLA, atau janji ketersediaan.
- Menyebut “asisten digital” agar client tahu ini bukan manusia.
- Pertanyaan di akhir membuka percakapan, bukan langsung mengirim penawaran.

## 2. Pengingat setelah 24 jam

Nama template: `asnet_followup_24h`  
Bahasa: `id`  
Kategori: Marketing  
Variabel body:

- `{{1}}` — nama PIC
- `{{2}}` — nama perusahaan/sekolah/hotel

Body:

```text
Halo Bapak/Ibu {{1}}, saya ingin menindaklanjuti pesan sebelumnya mengenai kebutuhan internet, perangkat, Data Center, atau server untuk {{2}}. Apakah ada waktu untuk berdiskusi singkat? Jika sudah tidak relevan, Bapak/Ibu dapat membalas BERHENTI.
```

Hanya dikirim **satu kali** setelah 24 jam tanpa balasan. Setelah itu berhenti.

## 3. Balasan setelah client membalas

Balasan ini bukan template baru; ini pesan bebas di dalam jendela 24 jam setelah
client membalas. Contohnya:

### Sapaan dan discovery

```text
Halo Bapak/Ibu {{nama}}, terima kasih sudah membalas. Saya asisten digital ASNET. Kami membantu kebutuhan internet, upgrade jaringan/perangkat, serta Data Center dan server. Kebutuhan mana yang ingin Bapak/Ibu diskusikan lebih dulu?
```

### Menanyakan kapasitas

```text
Baik, Bapak/Ibu {{nama}}. Berapa perkiraan kapasitas atau kuota internet yang dibutuhkan saat ini, dan apakah ada kendala jaringan yang sedang dialami?
```

### Menanyakan perangkat/Data Center/server

```text
Apakah saat ini Bapak/Ibu juga membutuhkan perangkat jaringan seperti router atau access point, pembuatan/maintenance Data Center, atau server?
```

### Ringkasan sebelum handoff

```text
Baik, Bapak/Ibu {{nama}}. Ringkasan kebutuhan yang saya catat: {{ringkasan}}. Apakah sudah sesuai? Jika ya, saya teruskan ke tim ASNET untuk diskusi jadwal dan penawaran.
```

### Client menanyakan harga

```text
Untuk harga, paket, dan penawaran resmi, saya teruskan ke tim ASNET. Bapak/Ibu akan dihubungi dari nomor WhatsApp pribadi kami untuk diskusi lanjutan.
```

### Client minta berhenti

```text
Baik, saya tidak akan mengirim pesan lanjutan. Terima kasih atas waktunya.
```

## 4. Ringkasan handoff ke pemilik

Ini bukan pesan ke client; ini ringkasan yang nantinya masuk ke inbox dashboard
atau diteruskan ke WhatsApp pribadi pemilik.

```text
HANDOFF WHATSAPP
Perusahaan: {{perusahaan}}
PIC: {{nama_pic}}
Nomor: {{nomor}}
Kebutuhan: {{ringkasan_kebutuhan}}
Lokasi: {{lokasi}}
Waktu: {{waktu}}
Alasan handoff: {{alasan}}
Status: client setuju / minta harga / minta manusia / komplain
```

## Aturan yang harus disetujui sebelum aktivasi

1. Agen tidak menyebut harga, diskon, SLA, kontrak, atau janji ketersediaan.
2. Agen tidak mengaku sebagai manusia.
3. Agen hanya mengirim satu pengingat setelah 24 jam.
4. Permintaan BERHENTI langsung menutup percakapan.
5. Ringkasan handoff harus disetujui pemilik sebelum komunikasi pindah ke nomor
   WhatsApp pribadi.
6. Template harus disetujui Meta sebelum dipakai.
7. Nomor pengirim dan token API hanya boleh disimpan sebagai secret, bukan di
   file proyek atau chat.

## Catatan biaya

Meta dapat mengenakan biaya untuk template marketing. Tidak ada gateway resmi
yang menjamin pengiriman massal gratis tanpa batas. Jika biaya tidak
diinginkan, opsi yang aman adalah membatasi agen ke percakapan yang dimulai
client atau mengirim pesan secara manual dari nomor pribadi.
