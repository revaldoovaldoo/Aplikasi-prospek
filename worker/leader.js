import { ensureCorporateSchema } from "./corporate.js";
import {
  readStats,
  readTelegramOutboxHealth,
  retryStuckTelegram,
  sendTelegram,
} from "./robot.js";

const TELEGRAM_WEBHOOK_SECRET_KEY = "telegram_webhook_secret";
const TELEGRAM_WEBHOOK_URL_KEY = "telegram_webhook_url";
const TELEGRAM_UPDATE_KEY_PREFIX = "telegram_leader_update:";
const JENOVA_API_BASE = "https://api.jenova.ai/v1";
const JENOVA_AGENT = "jenova";
const JENOVA_SESSION_KEY = "ai_leader_jenova_session";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("id-ID") : "0";
}

async function readMeta(db, key) {
  const row = await db
    .prepare("SELECT value FROM corporate_meta WHERE key = ?")
    .bind(key)
    .first();
  return row?.value || "";
}

async function writeMeta(db, key, value) {
  await db
    .prepare(
      "INSERT INTO corporate_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value)
    .run();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

function parseAppData(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function emptyOutbox() {
  return {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    needsReview: 0,
    retryable: 0,
    total: 0,
    attention: 0,
  };
}

function emptyStats() {
  return {
    total: 0,
    searches: 0,
    finding: 0,
    clarification: 0,
    publish: 0,
    publishTelegram: 0,
    publishProspect: 0,
    done: 0,
    paused: 0,
    active: 0,
    published: 0,
    notified: 0,
  };
}

/**
 * Snapshot AI Leader sengaja membaca tabel langsung, bukan memanggil
 * getRobotStatus(). getRobotStatus() melakukan ensureJobs() dan dapat
 * mengubah stage/pengaturan robot; AI Leader tidak boleh melakukan itu.
 * Snapshot ini read-only. AI Leader hanya menulis saat pengguna secara
 * eksplisit meminta kirim ulang pesan Telegram (aksi terpisah di bawah).
 */
export async function readLeaderSnapshot(db) {
  if (!db) {
    return {
      stats: emptyStats(),
      lastRun: null,
      lastRunAt: "",
      settings: null,
      data: null,
      ownerId: "",
      outbox: emptyOutbox(),
    };
  }

  let stats = emptyStats();
  try {
    stats = await readStats(db);
  } catch (error) {
    console.error(
      "ai_leader_stats_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  let outbox = emptyOutbox();
  try {
    outbox = await readTelegramOutboxHealth(db);
  } catch (error) {
    console.error(
      "ai_leader_outbox_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  let lastRunRow = null;
  try {
    lastRunRow = await db
      .prepare(
        "SELECT started_at, finished_at, checked, found, published, notified, error FROM corporate_robot_runs ORDER BY started_at DESC LIMIT 1",
      )
      .first();
  } catch (error) {
    console.error(
      "ai_leader_run_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  const lastRun = lastRunRow
    ? {
        checked: Number(lastRunRow.checked || 0),
        found: Number(lastRunRow.found || 0),
        published: Number(lastRunRow.published || 0),
        notified: Number(lastRunRow.notified || 0),
        error: lastRunRow.error || "",
      }
    : null;
  const lastRunAt =
    lastRunRow?.finished_at || lastRunRow?.started_at || "";

  let settings = null;
  let ownerId = "";
  let data = null;
  try {
    settings = await db
      .prepare(
        "SELECT * FROM corporate_robot_settings ORDER BY updated_at DESC LIMIT 1",
      )
      .first();
    ownerId = clean(settings?.owner_id);
    let row = ownerId
      ? await db
          .prepare("SELECT payload FROM app_state WHERE user_id = ?")
          .bind(ownerId)
          .first()
      : null;
    if (!row) {
      row = await db
        .prepare(
          "SELECT payload FROM app_state ORDER BY updated_at DESC LIMIT 1",
        )
        .first();
    }
    data = row?.payload ? parseAppData(row.payload) : null;
  } catch (error) {
    console.error(
      "ai_leader_context_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return { stats, lastRun, lastRunAt, settings, ownerId, data, outbox };
}

function statsLine(label, value, extra = "") {
  return `• <b>${label}</b>: ${count(value)}${extra ? ` ${extra}` : ""}`;
}

function formatRupiah(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "-";
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return date.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMPANY_STOP_WORDS = new Set([
  "pt", "cv", "tbk", "persero", "ud", "pd", "hotel", "resort", "sekolah",
  "school", "sma", "smk", "smp", "sd", "universitas", "university",
  "institut", "kampus", "the", "and", "dan", "atau", "yang", "untuk",
  "dengan", "dari", "saya", "kami", "kamu", "apa", "apakah", "bagaimana",
  "status", "info", "detail", "data", "berapa", "mana", "kapan", "sudah",
  "belum", "sedang", "terbaru", "perusahaan", "prospek", "penawaran",
]);

function companyTokens(name) {
  return normalizeText(name)
    .split(" ")
    .filter((token) => token.length >= 2 && !COMPANY_STOP_WORDS.has(token));
}

function quoteByCompany(snapshot) {
  const map = new Map();
  const quotes = Array.isArray(snapshot.data?.quotes) ? snapshot.data.quotes : [];
  for (const quote of quotes) {
    if (!quote?.quoteFile || !quote.companyId) continue;
    const current = map.get(quote.companyId);
    if (!current || String(current.updatedAt || "") < String(quote.updatedAt || "")) {
      map.set(quote.companyId, quote);
    }
  }
  return map;
}

function quoteStatus(company, quote) {
  if (quote?.bastSignedFile) return "BAST selesai";
  if (quote?.bastFile) return "BAST terkirim";
  if (quote?.status === "po") return "PO";
  if (quote?.status === "tidak-jadi") return "Cancel";
  if (quote) return "Penawaran";
  return company?.lostAt ? "Cancel tanpa PDF" : "Prospek";
}

function companyReply(snapshot, text) {
  const companies = Array.isArray(snapshot.data?.companies)
    ? snapshot.data.companies
    : [];
  const message = normalizeText(text);
  if (!message) return "";
  const scored = companies
    .map((company) => {
      const name = normalizeText(company?.name);
      if (!name) return { company, score: 0 };
      const full = message.includes(name) ? 100 : 0;
      const tokens = companyTokens(company.name);
      const matched = tokens.filter((token) => message.split(" ").includes(token));
      return { company, score: full + matched.length * 4 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return "";

  const best = scored[0].company;
  const quotes = quoteByCompany(snapshot);
  const quote = quotes.get(best.id) || null;
  const status = quoteStatus(best, quote);
  const lines = [
    `<b>AI Leader · ${escapeHtml(best.name)}</b>`,
    "",
    `• Lokasi: ${escapeHtml(best.location || "-")}`,
    `• Status: <b>${escapeHtml(status)}</b>`,
    `• PIC: ${escapeHtml(best.contactName || "belum diisi")}`,
    `• WhatsApp PIC: ${escapeHtml(best.picPhone || "belum diisi")}`,
    `• E-mail PIC: ${escapeHtml(best.email || "belum diisi")}`,
    `• Visit: ${formatShortDate(best.visitDate)}`,
  ];
  if (quote) {
    lines.push(
      "",
      `• Nomor: <code>${escapeHtml(quote.number || "-")}</code>`,
      `• Tanggal: ${formatShortDate(quote.date)}`,
    );
    if (quote.poAmount > 0) {
      lines.push(`• Nilai PO: ${formatRupiah(quote.poAmount)}`);
      lines.push(`• Komisi 10%: ${formatRupiah(quote.poCommission)}`);
    }
    if (quote.bastFile) lines.push("• PDF BAST: sudah dibuat");
  } else if (best.lostAt) {
    lines.push(`• Alasan cancel: ${escapeHtml(best.lostReason || "tanpa alasan")}`);
  }

  let next = "";
  if (!quote && !best.lostAt) {
    next = "Langkah berikut: buat atau unggah PDF penawaran untuk perusahaan ini.";
  } else if (status === "Penawaran") {
    next = "Langkah berikut: follow up PIC dan lengkapi data PO bila sudah setuju.";
  } else if (status === "PO") {
    next = "Langkah berikut: siapkan BAST setelah layanan aktif.";
  } else if (status === "BAST terkirim") {
    next = "Langkah berikut: minta kembali BAST yang sudah ditandatangani.";
  } else if (status === "BAST selesai") {
    next = "Pekerjaan administrasi perusahaan ini sudah lengkap.";
  } else if (status === "Cancel") {
    next = "Nomor penawaran perusahaan ini sudah tersedia kembali untuk penawaran baru.";
  }
  if (next) lines.push("", escapeHtml(next));
  if (scored.length > 1) {
    lines.push("", `Ada ${count(scored.length - 1)} perusahaan lain yang juga cocok; sebutkan nama lengkapnya bila perlu.`);
  }
  return lines.join("\n");
}

function queueReply(snapshot) {
  const outbox = snapshot.outbox || emptyOutbox();
  const lines = [
    "<b>AI Leader · Antrean Telegram</b>",
    "",
    statsLine("Menunggu", outbox.pending),
    statsLine("Sedang dikirim", outbox.sending),
    statsLine("Terkirim", outbox.sent),
    statsLine("Gagal", outbox.failed),
    statsLine("Tidak pasti", outbox.uncertain),
    statsLine("Perlu dicek", outbox.needsReview),
    "",
    outbox.attention > 0
      ? `Ada ${count(outbox.attention)} pesan yang perlu perhatian. Ketik <code>kirim ulang pesan macet</code> untuk mengirim ulang yang aman.`
      : "Antrean aman; tidak ada pesan yang perlu perhatian.",
    "Pesan berstatus <b>uncertain</b> tidak dikirim ulang otomatis karena berisiko dobel.",
  ];
  return lines.join("\n");
}

function adviceReply(snapshot) {
  const { companies, active } = activeCompanies(snapshot);
  const quotes = quoteByCompany(snapshot);
  const outbox = snapshot.outbox || emptyOutbox();
  const today = new Date().toISOString().slice(0, 10);
  const daysOld = (date) => {
    if (!date) return 0;
    const then = new Date(`${date}T00:00:00+07:00`).getTime();
    const now = new Date(`${today}T00:00:00+07:00`).getTime();
    return Number.isFinite(then) ? Math.floor((now - then) / 86400000) : 0;
  };

  const noQuote = active.filter((company) => !quotes.get(company.id));
  const missingContact = active.filter(
    (company) => !clean(company.picPhone) || !clean(company.email),
  );
  const offers = active.filter((company) => quotes.get(company.id)?.status === "penawaran");
  const stale = offers.filter((company) => daysOld(quotes.get(company.id)?.date) >= 14);
  const poWithoutBast = active.filter((company) => {
    const quote = quotes.get(company.id);
    return quote?.status === "po" && !quote.bastFile;
  });
  const bastWaiting = active.filter((company) => {
    const quote = quotes.get(company.id);
    return Boolean(quote?.bastFile && !quote.bastSignedFile);
  });
  const canceled = (Array.isArray(snapshot.data?.quotes) ? snapshot.data.quotes : [])
    .filter((quote) => quote?.status === "tidak-jadi")
    .slice(-5)
    .reverse();

  const actions = [];
  if (outbox.attention > 0) {
    actions.push(`Periksa ${count(outbox.attention)} pesan Telegram bermasalah; buka status antrean lalu kirim ulang yang aman.`);
  }
  if (noQuote.length > 0) {
    actions.push(`Buat penawaran untuk ${count(noQuote.length)} prospek yang belum punya PDF, mulai dari yang sudah visit.`);
  }
  if (stale.length > 0) {
    actions.push(`Follow up ${count(stale.length)} penawaran yang sudah berumur 14 hari atau lebih; harga penawaran berlaku 14 hari.`);
  }
  if (poWithoutBast.length > 0) {
    actions.push(`Siapkan BAST untuk ${count(poWithoutBast.length)} PO yang belum punya BAST.`);
  }
  if (bastWaiting.length > 0) {
    actions.push(`Minta BAST bertanda tangan untuk ${count(bastWaiting.length)} perusahaan.`);
  }
  if (missingContact.length > 0) {
    actions.push(`Lengkapi WhatsApp/e-mail PIC pada ${count(missingContact.length)} prospek agar penawaran bisa dikirim.`);
  }

  const lines = [
    "<b>AI Leader · Prioritas Kerja</b>",
    "",
    `Saya membaca ${count(active.length)} prospek aktif, ${count(offers.length)} penawaran berjalan, dan ${count(poWithoutBast.length)} PO yang belum ber-BAST.`,
  ];
  if (actions.length > 0) {
    lines.push("", "<b>Yang paling bernilai dikerjakan sekarang:</b>");
    actions.slice(0, 6).forEach((action, index) =>
      lines.push(`${index + 1}. ${escapeHtml(action)}`),
    );
  } else {
    lines.push("", "Tidak ada pekerjaan mendesak dari data saat ini. Pertahankan follow up rutin dan lengkapi prospek baru.");
  }
  if (canceled.length > 0) {
    lines.push("", "<b>Cancel terakhir:</b>");
    for (const quote of canceled.slice(0, 3)) {
      const company = companies.find((item) => item.id === quote.companyId);
      lines.push(`• ${escapeHtml(company?.name || "Perusahaan")}: ${escapeHtml(quote.lostReason || "tanpa alasan")}`);
    }
  }
  lines.push("", "Nomor penawaran dari perusahaan yang cancel otomatis tersedia kembali untuk penawaran baru.");
  return lines.join("\n");
}

function poReply(snapshot) {
  const quotes = Array.from(quoteByCompany(snapshot).values()).filter(
    (quote) => quote.status === "po",
  );
  const totalCommission = quotes.reduce(
    (sum, quote) => sum + Number(quote.poCommission || 0),
    0,
  );
  const lines = [
    "<b>AI Leader · PO</b>",
    "",
    statsLine("PO diterima", quotes.length),
    `• Total komisi 10%: <b>${formatRupiah(totalCommission)}</b>`,
    "",
  ];
  for (const quote of quotes.slice(0, 8)) {
    const company = (snapshot.data?.companies || []).find(
      (item) => item.id === quote.companyId,
    );
    lines.push(
      `• ${escapeHtml(company?.name || "Perusahaan")} — ${escapeHtml(quote.number)} — ${formatRupiah(quote.poAmount)}`,
    );
  }
  if (quotes.length === 0) lines.push("Belum ada PO yang tercatat.");
  return lines.join("\n");
}

function bastReply(snapshot) {
  const quotes = Array.from(quoteByCompany(snapshot).values());
  const sent = quotes.filter((quote) => quote.bastFile);
  const signed = quotes.filter((quote) => quote.bastSignedFile);
  const waiting = sent.filter((quote) => !quote.bastSignedFile);
  return [
    "<b>AI Leader · BAST</b>",
    "",
    statsLine("BAST dibuat", sent.length),
    statsLine("BAST bertanda tangan", signed.length),
    statsLine("Menunggu tanda tangan", waiting.length),
    "",
    waiting.length > 0
      ? `Prioritaskan ${count(waiting.length)} BAST yang sudah dikirim tetapi belum kembali.`
      : "Semua BAST yang sudah dibuat juga sudah bertanda tangan.",
  ].join("\n");
}

function cancelReply(snapshot) {
  const quotes = Array.isArray(snapshot.data?.quotes) ? snapshot.data.quotes : [];
  const canceled = quotes.filter((quote) => quote?.status === "tidak-jadi");
  const lines = [
    "<b>AI Leader · Cancel</b>",
    "",
    statsLine("Penawaran cancel", canceled.length),
    "",
  ];
  canceled
    .slice()
    .sort((a, b) => String(b.lostAt || b.updatedAt).localeCompare(String(a.lostAt || a.updatedAt)))
    .slice(0, 6)
    .forEach((quote) => {
      const company = (snapshot.data?.companies || []).find(
        (item) => item.id === quote.companyId,
      );
      lines.push(
        `• ${escapeHtml(company?.name || "Perusahaan")} — ${escapeHtml(quote.number)} — ${escapeHtml(quote.lostReason || "tanpa alasan")}`,
      );
    });
  if (canceled.length === 0) lines.push("Belum ada penawaran yang dibatalkan.");
  lines.push("", "Nomor dari penawaran cancel tersedia kembali untuk penawaran baru.");
  return lines.join("\n");
}

function progressReply(snapshot) {
  const stats = snapshot.stats || emptyStats();
  const lastRun = snapshot.lastRun;
  const lastRunAt = formatDate(snapshot.lastRunAt);
  const lines = [
    "<b>AI Leader · Progress Tim Robot</b>",
    "",
    statsLine("Finding", stats.finding, "antre"),
    statsLine("Klarifikasi", stats.clarification, "antre"),
    statsLine("Publish Telegram", stats.publishTelegram, "antre"),
    statsLine("Publish Prospek", stats.publishProspect, "antre"),
    "",
    statsLine("Lead ditemukan", stats.searches),
    statsLine("Terverifikasi/published", stats.published),
    statsLine("Pesan Telegram terkirim", stats.notified),
    statsLine("Selesai", stats.done),
    statsLine("Dijeda", stats.paused),
  ];
  if (lastRun) {
    lines.push(
      "",
      `Batch terakhir ${lastRunAt || "belum lama"}: ${count(lastRun.checked)} diperiksa, ${count(lastRun.found)} ditemukan, ${count(lastRun.published)} dipublikasikan.`,
    );
    if (lastRun.error) lines.push(`Catatan: ${escapeHtml(lastRun.error)}`);
  } else {
    lines.push("", "Belum ada batch robot yang tercatat.");
  }
  lines.push(
    "",
    "Kurir Publish Telegram berjalan otomatis setiap hari selama ada pesan valid dari Klarifikasi.",
  );
  return lines.join("\n");
}

function activeCompanies(snapshot) {
  const companies = Array.isArray(snapshot.data?.companies)
    ? snapshot.data.companies
    : [];
  return {
    companies,
    active: companies.filter((company) => !company?.lostAt),
  };
}

function prospectReply(snapshot) {
  const { companies, active } = activeCompanies(snapshot);
  const verified = active.filter(
    (company) => company?.validationStatus === "verified",
  );
  const withPhone = active.filter((company) => clean(company?.picPhone));
  return [
    "<b>AI Leader · Prospek</b>",
    "",
    statsLine("Total prospek", active.length),
    statsLine("Dari Corporate Engine", active.filter((company) => company?.sourceLeadId).length),
    statsLine("Terverifikasi", verified.length),
    statsLine("Punya nomor PIC", withPhone.length),
    statsLine("Tidak jadi", companies.length - active.length),
    "",
    "Angka ini dihitung dari daftar Prospek yang tersimpan di aplikasi.",
  ].join("\n");
}

function quoteReply(snapshot) {
  // Satu perusahaan hanya punya satu penawaran aktif; riwayat PDF disimpan
  // di dalam record yang sama sehingga tidak dihitung sebagai penawaran baru.
  const quotes = Array.from(quoteByCompany(snapshot).values());
  const offers = quotes.filter((quote) => quote?.quoteFile);
  const po = quotes.filter((quote) => quote?.status === "po");
  const lost = quotes.filter((quote) => quote?.status === "tidak-jadi");
  const bastSent = quotes.filter((quote) => quote?.bastFile);
  const bastSigned = quotes.filter((quote) => quote?.bastSignedFile);
  return [
    "<b>AI Leader · Penawaran</b>",
    "",
    statsLine("PDF penawaran", offers.length),
    statsLine("PO", po.length),
    statsLine("Tidak jadi", lost.length),
    statsLine("BAST terkirim", bastSent.length),
    statsLine("BAST bertanda tangan", bastSigned.length),
    "",
    "Detail dan tautan PDF ada di halaman Penawaran aplikasi.",
  ].join("\n");
}

function menuReply() {
  return [
    "<b>AI Leader</b>",
    "Halo, saya bisa membaca data aplikasi dan menjelaskannya. Tanyakan dengan bahasa Indonesia, misalnya:",
    "",
    "• <code>status PT Cek 3</code> — detail perusahaan dan penawarannya",
    "• <code>progress tim</code> — Finding, Klarifikasi, Publish",
    "• <code>status antrean telegram</code> — pesan macet dan perlu dicek",
    "• <code>status penawaran</code>, <code>status PO</code>, <code>status BAST</code>",
    "• <code>jelaskan peluang dan prioritas kerja saya</code> — jawaban bebas dari data",
    "",
    "Saya hanya membaca data. Saya tidak mengubah data atau mengirim pesan kecuali Anda",
    "secara eksplisit meminta <code>kirim ulang pesan macet</code>.",
  ].join("\n");
}

function fallbackReply(snapshot) {
  const stats = snapshot.stats || emptyStats();
  const { active } = activeCompanies(snapshot);
  return [
    "<b>AI Leader</b>",
    "Saya belum mendapat jawaban yang cukup spesifik, tetapi ini ringkasan data saat ini:",
    "",
    statsLine("Prospek aktif", active.length),
    statsLine("Lead ditemukan", stats.searches),
    statsLine("Telegram terkirim", stats.notified),
    statsLine(
      "Penawaran berjalan",
      Array.from(quoteByCompany(snapshot).values()).filter(
        (quote) => quote.status === "penawaran",
      ).length,
    ),
    "",
    "Sebutkan nama perusahaan, nomor penawaran, atau tanyakan prioritas kerja agar saya bisa lebih spesifik.",
  ].join("\n");
}

/** Pertanyaan analitis/open-ended lebih cocok dijawab model, bukan regex. */
export function shouldUseFreeformAnswer(text) {
  return /(jelaskan|analisis|analisa|bandingkan|ringkas|rangkum|prediksi|menurut|pendapat|buatkan|susun|draft|tulis|kenapa|mengapa|bagaimana|strategi|ide|saran|rekomendasi|peluang|risiko|prioritas|apa yang bisa|bantu saya)/i.test(
    clean(text),
  );
}

function compactSnapshot(snapshot) {
  const companies = Array.isArray(snapshot.data?.companies)
    ? snapshot.data.companies
    : [];
  const quotes = Array.from(quoteByCompany(snapshot).values());
  const companyName = new Map(companies.map((company) => [company.id, company.name]));
  const compact = {
    stats: snapshot.stats || emptyStats(),
    outbox: snapshot.outbox || emptyOutbox(),
    lastRun: snapshot.lastRun,
    lastRunAt: snapshot.lastRunAt,
    companies: companies.slice(0, 300).map((company) => ({
      name: company.name,
      location: company.location,
      status: company.lostAt ? "cancel" : "aktif",
      lostReason: company.lostReason || "",
      pic: company.contactName || "",
      phone: company.picPhone || "",
      email: company.email || "",
      visitDate: company.visitDate || "",
    })),
    quotes: quotes.slice(0, 300).map((quote) => ({
      company: companyName.get(quote.companyId) || "",
      number: quote.number,
      date: quote.date,
      status: quote.status,
      lostReason: quote.lostReason || "",
      poAmount: Number(quote.poAmount || 0),
      poCommission: Number(quote.poCommission || 0),
      hasPo: Boolean(quote.poFile),
      hasBast: Boolean(quote.bastFile),
      hasSignedBast: Boolean(quote.bastSignedFile),
    })),
    companyCount: companies.length,
    quoteCount: quotes.length,
  };
  return JSON.stringify(compact).slice(0, 18000);
}

async function jenovaPost(path, key, body) {
  const response = await fetch(`${JENOVA_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function createJenovaSession(db, env, ownerId) {
  const key = clean(env?.JENOVA_API_KEY);
  if (!key) return "";
  try {
    const { response, data } = await jenovaPost("/sessions", key, {
      agent: JENOVA_AGENT,
      user: clean(ownerId) || "ai-leader",
      session_name: "AI Leader Telegram",
    });
    const id = clean(data?.id);
    if (!response.ok || !/^ses_/.test(id)) {
      console.error(
        "ai_leader_jenova_session_error",
        response.status,
        clean(data?.error?.message) || "session gagal dibuat",
      );
      return "";
    }
    await writeMeta(db, `${JENOVA_SESSION_KEY}:${clean(ownerId) || "ai-leader"}`, id);
    return id;
  } catch (error) {
    console.error(
      "ai_leader_jenova_session_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return "";
  }
}

/**
 * Jawaban bebas memakai model, tetapi hanya membaca snapshot yang sudah
 * disiapkan. Tidak ada tool aplikasi yang diberikan ke model, sehingga model
 * tidak punya jalur untuk menulis data robot, penawaran, atau Telegram.
 */
export async function askJenova(db, env, snapshot, text) {
  const key = clean(env?.JENOVA_API_KEY);
  if (!key) return "";
  const ownerId = clean(snapshot.ownerId) || "ai-leader";
  const sessionKey = `${JENOVA_SESSION_KEY}:${ownerId}`;
  let sessionId = clean(await readMeta(db, sessionKey));
  if (!sessionId) sessionId = await createJenovaSession(db, env, ownerId);
  if (!sessionId) return "";

  const prompt = [
    "Kamu adalah AI Leader untuk aplikasi Hallo Pane (prospek, penawaran, PO, BAST, robot Corporate Engine, dan antrean Telegram).",
    "Jawab dalam bahasa Indonesia yang ringkas dan spesifik. Gunakan hanya DATA APLIKASI di bawah.",
    "Ini mode baca-saja: jangan pernah menyatakan bahwa kamu sudah mengubah, menghapus, mengirim, atau menyimpan data.",
    "Jangan mengarang nama perusahaan, nomor penawaran, nominal, atau status yang tidak ada di data. Jika data tidak cukup, katakan demikian.",
    "",
    "DATA APLIKASI:",
    compactSnapshot(snapshot),
    "",
    `PERTANYAAN: ${clean(text)}`,
  ].join("\n");

  try {
    let result = await jenovaPost(`/sessions/${sessionId}/messages`, key, {
      content: prompt,
      stream: false,
      include_progress: false,
    });
    if (result.response.status === 404) {
      // Sesi bisa hilang di sisi penyedia; buat sekali lagi lalu ulangi.
      sessionId = await createJenovaSession(db, env, ownerId);
      if (!sessionId) return "";
      result = await jenovaPost(`/sessions/${sessionId}/messages`, key, {
        content: prompt,
        stream: false,
        include_progress: false,
      });
    }
    const answer = clean(result.data?.content);
    if (!result.response.ok || !answer) {
      console.error(
        "ai_leader_jenova_answer_error",
        result.response.status,
        clean(result.data?.error?.message) || "jawaban kosong",
      );
      return "";
    }
    return answer.slice(0, 3800);
  } catch (error) {
    console.error(
      "ai_leader_jenova_answer_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return "";
  }
}

export function isRetryRequest(text) {
  // Hanya perintah kirim ulang yang eksplisit boleh menulis. Menyebut
  // "pesan macet" dalam pertanyaan tidak boleh memicu aksi.
  return /(kirim\s*ulang|kirimulang|resend|retry)/i.test(clean(text));
}

async function actionReply(text, snapshot, env, db) {
  if (!isRetryRequest(text)) return "";
  const result = await retryStuckTelegram(db, env, snapshot.ownerId);
  const lines = [
    "<b>AI Leader · Kirim ulang Telegram</b>",
    "",
    escapeHtml(result.message || "Pesan macet selesai diproses."),
  ];
  if (result.health) {
    lines.push(
      `Sisa: ${count(result.health.failed)} gagal, ${count(result.health.uncertain)} tidak pasti, ${count(result.health.needsReview)} perlu dicek.`,
    );
  }
  lines.push(
    "",
    "Pesan uncertain tidak dikirim ulang otomatis/manual biasa untuk mencegah duplikat.",
  );
  return lines.join("\n");
}

export function buildLeaderReply(text, snapshot) {
  const message = clean(text).toLowerCase();
  if (!message || /^\/?(start|mulai|halo|hai|hello|p)\b/.test(message)) {
    return menuReply();
  }
  if (/(terima\s*kasih|makasih|thanks|thank you)/.test(message)) {
    return "<b>AI Leader</b>\nSama-sama. Saya siap membantu membaca data dan menyusun prioritas kerja berikutnya.";
  }
  if (/(kamu siapa|siapa kamu|apa itu ai leader|fungsi kamu)/.test(message)) {
    return "<b>AI Leader</b>\nSaya asisten data aplikasi ini. Saya membaca Prospek, Penawaran, PO, BAST, Cancel, robot, dan antrean Telegram. Saya tidak mengubah data kecuali diminta eksplisit untuk mengirim ulang pesan yang aman.";
  }
  if (/(bantuan|help|menu|fitur|bisa apa|perintah)/.test(message)) {
    return menuReply();
  }
  if (/(ide|saran|rekomendasi|masukan|strategi|prioritas|majukan|tingkatkan|perbaiki|next|langkah|apa yang harus|follow.?up|kerja apa)/.test(message)) {
    return adviceReply(snapshot);
  }
  if (/(antre|antrian|outbox|pesan macet|gagal kirim|needs.?review|uncertain|telegram)/.test(message)) {
    return queueReply(snapshot);
  }
  const company = companyReply(snapshot, message);
  if (company) return company;
  if (/(cancel|batal|tidak jadi)/.test(message)) {
    return cancelReply(snapshot);
  }
  if (/(\bpo\b|purchase order|komisi)/.test(message)) {
    return poReply(snapshot);
  }
  if (/(bast|berita acara|tanda tangan)/.test(message)) {
    return bastReply(snapshot);
  }
  if (/(prospek|perusahaan|klien|customer)/.test(message)) {
    return prospectReply(snapshot);
  }
  if (/(penawaran|quote|pdf|invoice)/.test(message)) {
    return quoteReply(snapshot);
  }
  if (
    /(progress|progres|status|tim|robot|finding|klarifikasi|publish|pekerjaan|kerja|lead)/.test(
      message,
    )
  ) {
    return progressReply(snapshot);
  }
  return "";
}

/**
 * Klaim update Telegram sekali saja. Telegram dapat mengirim ulang update yang
 * sama bila webhook lambat; INSERT OR IGNORE membuat balasan dan aksi retry
 * tidak berjalan dua kali.
 */
export async function claimTelegramUpdate(db, updateId) {
  const id = clean(String(updateId ?? ""));
  if (!/^\d+$/.test(id)) return true;
  const result = await db
    .prepare(
      "INSERT INTO corporate_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    )
    .bind(`${TELEGRAM_UPDATE_KEY_PREFIX}${id}`, new Date().toISOString())
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function processUpdate(
  update,
  snapshot,
  env,
  db,
  send = sendTelegram,
  freeform = askJenova,
) {
  const message = update?.message || update?.edited_message;
  const chatId = clean(String(message?.chat?.id || ""));
  const expected = clean(snapshot.settings?.telegram_chat_id) || clean(env?.TELEGRAM_CHAT_ID);
  if (!message || !chatId || !expected || chatId !== expected) return false;
  if (message.chat?.type && message.chat.type !== "private") return false;
  const text = message.text || message.caption || "";
  if (!text) return false;

  let answer = await actionReply(text, snapshot, env, db);
  let plain = false;
  let aiTried = false;
  if (!answer && shouldUseFreeformAnswer(text)) {
    aiTried = true;
    const generated = await freeform(db, env, snapshot, text);
    if (generated) {
      answer = generated;
      plain = true;
    }
  }
  if (!answer) answer = buildLeaderReply(text, snapshot);
  if (!answer && !aiTried) {
    aiTried = true;
    const generated = await freeform(db, env, snapshot, text);
    if (generated) {
      answer = generated;
      plain = true;
    }
  }
  if (!answer) answer = fallbackReply(snapshot);

  const result = await send(
    env,
    snapshot.settings,
    answer,
    plain ? { parseMode: "plain" } : {},
  );
  if (!result.ok) {
    console.error(
      "ai_leader_telegram_reply_error",
      result.error || "Telegram gagal mengirim balasan.",
    );
  }
  return result.ok;
}

/**
 * Daftarkan webhook Telegram sekali per origin. Secret dibuat lokal dan
 * disimpan di corporate_meta, jadi tidak perlu secret tambahan dari pengguna.
 * Pendaftaran dilakukan oleh cron/status, bukan oleh polling.
 */
export async function ensureTelegramWebhook(db, env = {}) {
  if (!db) return { ok: false, skipped: true, reason: "Database belum tersedia." };
  await ensureCorporateSchema(db);
  const token = clean(env?.TELEGRAM_BOT_TOKEN);
  const origin = clean(env?.APP_ORIGIN).replace(/\/$/, "");
  if (!token || !origin) {
    return { ok: false, skipped: true, reason: "Token/origin Telegram belum lengkap." };
  }

  const settings = await db
    .prepare(
      "SELECT telegram_chat_id FROM corporate_robot_settings ORDER BY updated_at DESC LIMIT 1",
    )
    .first();
  const chatId = clean(settings?.telegram_chat_id) || clean(env?.TELEGRAM_CHAT_ID);
  if (!chatId) {
    return { ok: false, skipped: true, reason: "Chat ID Telegram belum diatur." };
  }

  const url = `${origin}/api/telegram/webhook`;
  let secret = clean(await readMeta(db, TELEGRAM_WEBHOOK_SECRET_KEY));
  const registeredUrl = clean(await readMeta(db, TELEGRAM_WEBHOOK_URL_KEY));
  if (registeredUrl === url && secret) {
    return { ok: true, already: true, url };
  }
  if (!secret) {
    secret = crypto.randomUUID();
    await writeMeta(db, TELEGRAM_WEBHOOK_SECRET_KEY, secret);
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secret,
          allowed_updates: ["message", "edited_message"],
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      console.error(
        "ai_leader_webhook_register_error",
        clean(body?.description) || `HTTP ${response.status}`,
      );
      return {
        ok: false,
        registered: false,
        reason: clean(body?.description) || "Telegram menolak webhook.",
      };
    }
    await writeMeta(db, TELEGRAM_WEBHOOK_URL_KEY, url);
    return { ok: true, already: false, url };
  } catch (error) {
    console.error(
      "ai_leader_webhook_register_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, registered: false, reason: "Telegram tidak dapat dihubungi." };
  }
}

/** Handler publik Telegram. Validasi secret mencegah update palsu. */
export async function handleTelegramLeaderWebhook(db, env, request, deps = {}) {
  if (!db) return { ok: false, status: 503 };
  const expected = clean(await readMeta(db, TELEGRAM_WEBHOOK_SECRET_KEY));
  const received = clean(
    request.headers.get("x-telegram-bot-api-secret-token"),
  );
  if (!expected || received !== expected) {
    return { ok: false, status: 401 };
  }

  let update = null;
  try {
    update = await request.json();
  } catch {
    return { ok: true, status: 200 };
  }
  try {
    const claimed = await claimTelegramUpdate(db, update?.update_id);
    if (!claimed) return { ok: true, status: 200, duplicate: true };
    const readSnapshot = deps.readLeaderSnapshot || readLeaderSnapshot;
    const snapshot = await readSnapshot(db);
    await processUpdate(
      update,
      snapshot,
      env,
      db,
      deps.sendTelegram || sendTelegram,
      deps.askJenova || askJenova,
    );
  } catch (error) {
    // Telegram akan mengulang update jika endpoint membalas non-2xx. Cukup
    // catat kegagalan satu pesan agar bot tidak membanjiri webhook.
    console.error(
      "ai_leader_webhook_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return { ok: true, status: 200 };
}
