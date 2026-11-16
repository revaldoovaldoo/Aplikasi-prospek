# Arsitektur AI dan Gateway WhatsApp

Status: **rencana teknis dan hasil audit**, belum ada pengiriman WhatsApp.
Dokumen ini melengkapi draft di `worker/whatsapp-agent.js` dan adapter
`worker/whatsapp-ai.js`.

## 1. Keputusan

- **Provider utama:** Groq free tier, OpenAI-compatible.
- **Fallback:** Ollama yang menjalankan Hermes 4 14B, atau Qwen3-8B bila
  perangkat hanya 8–16 GB RAM.
- **Gateway:** service Baileys terpisah di VPS/PC, bukan di dalam Cloudflare
  Worker.
- **Agen:** tetap draft sampai nomor, sesi WhatsApp, dan template disetujui.

Groq **tidak terlihat menyediakan model Hermes** di katalog free tier saat audit.
Jadi “Groq + Hermes” bukan satu model di Groq. Bentuk yang benar:

```text
WhatsApp client
      │
      ▼
Gateway Baileys (VPS, proses Node 24/7)
      │  webhook HTTPS + HMAC
      ▼
Cloudflare Worker (state, aturan, handoff)
      │
      ├── utama: Groq OpenAI-compatible ──► Qwen/GPT-OSS
      └── fallback: Ollama ──────────────► Hermes 4 14B
```

Worker memanggil endpoint HTTPS; Worker tidak menjalankan Ollama atau Baileys.

## 2. Hermes: model atau agent?

Ada dua proyek berbeda:

1. **Hermes 4 model** — model open-weight dari Nous Research.
   - `NousResearch/Hermes-4-14B` berbasis Qwen3-14B, lisensi **Apache 2.0**.
   - Bisa dijalankan dengan vLLM, SGLang, llama.cpp, atau GGUF/Ollama.
   - Tidak ada tag resmi `hermes4` di library Ollama saat audit; gunakan GGUF
     komunitas atau vLLM dengan bobot resmi.
2. **Hermes Agent** — `NousResearch/hermes-agent`, framework agent Python
   (MIT). Ia bisa memakai Groq sebagai provider dan punya WhatsApp bridge
   berbasis Baileys. Ini bukan model, dan bukan komponen yang perlu dipasang di
   Cloudflare Worker.

Untuk agen penjualan ini, **gunakan model Hermes 4 lewat Ollama/vLLM**, bukan
seluruh Hermes Agent. Hermes Agent memiliki tool terminal, browser, memori, dan
auto-update; permukaan serangnya terlalu besar untuk menerima pesan dari nomor
publik.

## 3. Konfigurasi Groq utama

Ambil API key dari console Groq, lalu isi secret:

```text
WHATSAPP_AI_BASE_URL=https://api.groq.com/openai/v1
WHATSAPP_AI_API_KEY=<secret>
WHATSAPP_AI_MODEL=qwen/qwen3.8-27b
WHATSAPP_AI_ENABLED=true
```

Periksa ID model yang benar dengan `GET /openai/v1/models` memakai key tersebut;
katalog Groq dapat berubah. Alternatif: `openai/gpt-oss-120b`.

Batas free tier yang dilaporkan saat audit: sekitar 30 request/menit, 1.000
request/hari, dan 200.000 token/hari per model. Batas ini bisa berubah dan
berlaku per organisasi. Jangan mengandalkan free tier untuk pengiriman massal.

## 4. Fallback Ollama + Hermes 4

Di VPS/PC terpisah, dengan Ollama yang mendukung impor GGUF:

```bash
ollama pull hf.co/bartowski/NousResearch_Hermes-4-14B-GGUF:Q4_K_M
```

Buat nama model yang stabil:

```bash
cat > Modelfile <<'EOF'
FROM hf.co/bartowski/NousResearch_Hermes-4-14B-GGUF:Q4_K_M
PARAMETER temperature 0.6
PARAMETER top_p 0.95
PARAMETER num_ctx 8192
EOF
ollama create hermes4-14b -f Modelfile
ollama run hermes4-14b
```

GGUF di atas adalah kuantisasi komunitas, bukan file resmi Nous. Verifikasi
repositori, checksum, dan lisensi sebelum produksi. Untuk bobot resmi dan
kualitas penuh, gunakan vLLM:

```bash
vllm serve NousResearch/Hermes-4-14B --host 0.0.0.0 --port 8000
```

Amankan endpoint sebelum dihubungkan ke Worker:

- jangan buka `11434`/`8000` langsung ke internet;
- pasang reverse proxy HTTPS;
- wajibkan bearer token atau mTLS;
- batasi IP/firewall;
- aktifkan rate limit;
- jangan aktifkan tool/function calling untuk agen ini.

Secret fallback:

```text
WHATSAPP_AI_FALLBACK_BASE_URL=https://llm.domain-anda.com/v1
WHATSAPP_AI_FALLBACK_API_KEY=<token-yang-anda-buat>
WHATSAPP_AI_FALLBACK_MODEL=hermes4-14b
```

Dengan konfigurasi ini, adapter mencoba Groq lebih dulu. Jika Groq error, timeout,
atau kena rate limit, adapter mencoba Hermes di Ollama. Hasilnya membawa
`route: "primary"` atau `route: "fallback"` agar bisa dicatat.

Kebutuhan kasar Hermes 4 14B Q4: sekitar 9 GB bobot, praktis 16 GB RAM/VRAM.
CPU hanya cocok untuk uji coba, bukan percakapan langsung. Qwen3-8B Apache 2.0
bisa menjadi alternatif yang lebih ringan.

## 5. Audit gateway dan repo bot

### 5.1 Baileys

- Repo: `WhiskeySockets/Baileys`, lisensi MIT, versi saat audit
  `7.0.0-rc14`.
- Library WebSocket, bukan server siap pakai. Kita tetap harus membuat sesi,
  reconnect, penyimpanan auth, webhook, dan antrean.
- Tidak bisa berjalan di Cloudflare Worker: butuh proses Node 24/7 dan koneksi
  WebSocket persisten.
- Advisory kritis `GHSA-qvv5-jq5g-4cgg` (spoofing `messages.upsert`) sudah
  diperbaiki pada `7.0.0-rc12` dan `6.7.22`. Jangan pakai versi di bawah itu.
- `baileys_auth_info/` setara kredensial jangka panjang. Jangan commit, jangan
  masukkan image, jangan kirim ke chat/AI.
- Log default dapat memuat JID dan metadata. Set `level: "silent"` atau filter.

**Keputusan:** gunakan Baileys, tetapi bangun gateway minimal sendiri. Jangan
fork repo bot yang tidak diaudit.

### 5.2 whatsapp-web.js

- Repo: `wwebjs/whatsapp-web.js`, Apache-2.0, versi `1.34.8` saat audit.
- Menjalankan Chromium/Puppeteer per sesi; lebih berat daripada Baileys.
- `npm audit --package-lock-only --omit=dev` melaporkan **16 advisory
  (11 high, 5 moderate)** pada lockfile saat audit, termasuk puppeteer,
  extract-zip, basic-ftp, brace-expansion, dan js-yaml.
- Bukan pilihan pertama untuk VPS kecil atau banyak nomor.

**Keputusan:** tidak dipakai.

### 5.3 Repo bot acak: `EliteProTech/ELITE-PRO-V1`

Commit yang diperiksa: `c92701f` (15 November 2026). Ini contoh mengapa repo bot
tidak boleh langsung dipakai:

- tidak ada `package-lock.json`, `yarn.lock`, atau `pnpm-lock.yaml`;
- `.env` ikut di-track Git;
- ditemukan kredensial bot Telegram hardcoded di source (tidak diulang di sini);
- ada fungsi update yang mengunduh file dari GitHub lalu menulis ke disk dan
  menjalankan `npm install`;
- perintah `npm pack ${pkg}@${pkgver}` memakai input chat di dalam shell;
- ratusan endpoint pihak ketiga tanpa pinning/verifikasi;
- satu file `ElitePro.js` sekitar 333 KB, sulit diaudit.

**Keputusan:** reject. Jangan deploy, jangan masukkan nomor utama.

### 5.4 Hermes Agent WhatsApp bridge

- Bridge Node memakai `@whiskeysockets/baileys` `7.0.0-rc13` (di atas versi
  patch advisory).
- Ada bearer token per sesi, bind loopback, allowlist, dan npm audit bridge
  melaporkan 0 advisory saat audit.
- Namun ini bagian dari Hermes Agent yang punya tool terminal dan otonomi.
  Jangan mengekspos seluruh agent ke pesan publik.
- Bridge ini bisa dijadikan referensi pola, bukan dependency produksi.

## 6. Rencana gateway Baileys

Saat nomor diberikan:

1. Buat service Node terpisah dengan Node 20+ dan lockfile.
2. Pin Baileys ke rilis patch terbaru, bukan `latest` atau branch `master`.
3. Simpan auth state di volume terenkripsi, di luar repo.
4. Pairing lewat QR atau pairing code; nomor hanya dimasukkan ke service, bukan
   ke chat.
5. Gateway mengirim event masuk ke Worker lewat HTTPS dengan HMAC dan timestamp.
6. Worker menyimpan pesan, menjalankan aturan draft, dan memanggil AI.
7. Balasan dikirim lewat antrean gateway. Jangan mengirim dari dua proses.
8. Batasi satu pesan keluar per pesan masuk; satu follow-up 24 jam; berhenti
   total setelah opt-out.
9. Jangan buat broadcast massal. Risiko ban tetap ada meski memakai Baileys.

Nomor dan token tidak dibuat di sini. Nomor harus berasal dari perangkat Anda,
dan sesi WhatsApp dibuat oleh service gateway saat pairing.

## 7. Status

- Adapter AI sudah ada, tetapi belum dipanggil agen dan belum mengirim pesan.
- Fallback Groq → Ollama sudah didukung oleh adapter.
- Gateway Baileys belum dibuat karena menunggu nomor dan sesi.
- Template kontak pertama sudah diperbarui di
  [`docs/whatsapp-templates.md`](whatsapp-templates.md).
