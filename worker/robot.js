/**
 * Robot Corporate Engine.
 *
 * Tiga tahap yang berjalan berurutan:
 * 1. Finding   — menilai kebutuhan internet/jaringan dari website dan sumber
 *                publik, bukan hanya menebak dari kategori.
 * 2. Klarifikasi — mencari dan memverifikasi kontak IT/PIC dari website,
 *                LinkedIn/direktori publik, serta memeriksa domain e-mail.
 * 3. Publish   — menyimpan hasil ke D1, menambahkannya ke Prospek bila
 *                diaktifkan, lalu mengirim notifikasi Telegram.
 *
 * Catatan privasi: robot tidak mengakses CCTV, kamera, akun sosial media
 * pribadi, atau area yang membutuhkan login. Verifikasi hanya memakai sumber
 * publik dan data bisnis yang memang dipublikasikan.
 */

import {
  coordinateReadyForPublish,
  ensureCorporateSchema,
  hasBoundPicPhoneEvidence,
  picEmailReady,
  picEvidenceMatchesLead,
  exaSearch,
  readPublicText,
  resolveLeadCoordinates,
  rowToLead,
  isPicRole,
  sanitizePicName,
  screeningHoldReason,
  screeningReviewRequired,
} from "./corporate.js";
import {
  repairCorporateCoordinates,
  researchCorporateLead,
} from "./research.js";
import { openosintConfigured } from "./openosint.js";
import {
  opensanctionsConfigured,
  opensanctionsQuotaCooldown,
  screenLeadOpenSanctions,
} from "./opensanctions.js";
import { formatPicPhones, validPicPhone } from "./phone.js";
import {
  sendWhatsAppTemplate,
  whatsappOutreachConfigured,
} from "./whatsapp.js";

const ROBOT_INTERVAL_MS = 15 * 60 * 1000;
const ROBOT_LOCK_MS = 10 * 60 * 1000;
// Saat tidak ada antrean, pemeliharaan (perbaikan koordinat, screening,
// rekonsiliasi Prospek) cukup sekali sejam. Tanpa ini setiap tick 15 menit
// tetap menulis baris run dan meta meski tidak ada yang berubah.
const ROBOT_MAINTENANCE_MS = 60 * 60 * 1000;
const ROBOT_SCHEMA_VERSION = "3";
const DEFAULT_TELEGRAM_PHONE = "+6285156590261";
const MAX_APP_STATE_CHARS = 1_500_000;

/**
 * Struktur 11 agen: 3 Finding, 5 Klarifikasi (3 Exa + OpenOSINT native +
 * OpenSanctions), dan 3 Publish dengan pekerjaan terpisah (Telegram, WhatsApp,
 * dan Prospek). OpenOSINT berjalan langsung di Worker melalui DNS-over-HTTPS
 * dan RDAP; OpenSanctions memakai API /match bila kredensial tersedia.
 */
const AGENT_BLUEPRINT = {
  finding: [
    {
      id: "finding-profile",
      name: "Profil Entitas",
      role: "Membaca website resmi, alamat, dan sinyal operasional.",
      provider: "Website publik (gratis)",
    },
    {
      id: "finding-signals",
      name: "Sinyal Publik",
      role: "Mencari sinyal internet, jaringan, dan ekspansi dari sumber publik.",
      provider: "Exa Search",
    },
    {
      id: "finding-qualifier",
      name: "Penilai Kebutuhan",
      role: "Menggabungkan bukti dan menghitung skor kebutuhan.",
      provider: "Rule engine (gratis)",
    },
  ],
  clarification: [
    {
      id: "clarification-scout",
      name: "Scout",
      role: "Website resmi, alamat, dan koordinat.",
      provider: "Exa Answer",
    },
    {
      id: "clarification-contact",
      name: "Contact Finder",
      role: "Nama PIC, jabatan, e-mail, dan nomor telepon.",
      provider: "Exa Answer",
    },
    {
      id: "clarification-verifier",
      name: "Verifier",
      role: "Verifikasi independen, konflik data, dan sitasi.",
      provider: "Exa Answer",
    },
    {
      id: "clarification-openosint",
      name: "OpenOSINT",
      role: "Memeriksa DNS dan registrasi domain secara pasif setelah klarifikasi menerima domain resmi.",
      provider: "OpenOSINT native (DNS/RDAP)",
    },
    {
      id: "clarification-opensanctions",
      name: "OpenSanctions",
      role: "Menyaring nama perusahaan dan nama PIC terhadap daftar sanksi, debarment, dan PEP sebagai bukti review; bukan verifikasi nomor/e-mail.",
      provider: "OpenSanctions /match",
    },
  ],
  publish: [
    {
      id: "publish-telegram",
      name: "Kurir Telegram",
      role: "Mengirim tujuh baris lengkap setelah Klarifikasi menerima lead; tepat satu kali per lead.",
      provider: "Telegram Bot API (gratis)",
    },
    {
      id: "publish-whatsapp",
      name: "Agen WhatsApp",
      role: "Draft: menggali kebutuhan PIC, menawarkan layanan tanpa harga, lalu membuat ringkasan handoff ke WhatsApp pribadi.",
      provider: "Draft — WhatsApp Cloud API",
      draft: true,
    },
    {
      id: "publish-prospect",
      name: "Penulis Prospek",
      role: "Menulis informasi lead yang sudah diklarifikasi ke daftar Prospek.",
      provider: "D1 / data aplikasi",
    },
  ],
};

function findingStatusLabel(status) {
  return (
    {
      ok: "berhasil",
      skipped: "dilewati",
      empty: "tanpa hasil",
      error: "gagal",
      disabled: "belum aktif",
    }[status] || status
  );
}

function agentStructure(env = {}, telegramConfigured = false) {
  const exa = Boolean(clean(env.EXA_API_KEY));
  const whatsapp = whatsappOutreachConfigured(env);
  return {
    finding: AGENT_BLUEPRINT.finding.map((agent) => ({
      ...agent,
      active: agent.id === "finding-signals" ? exa : true,
      provider:
        agent.id === "finding-signals" && !exa
          ? "Exa (belum aktif)"
          : agent.provider,
    })),
    clarification: AGENT_BLUEPRINT.clarification.map((agent) => {
      if (agent.id === "clarification-openosint") {
        return { ...agent, active: true };
      }
      if (agent.id === "clarification-opensanctions") {
        const active = opensanctionsConfigured(env);
        return {
          ...agent,
          active,
          provider: active ? agent.provider : "OpenSanctions (belum aktif)",
        };
      }
      return {
        ...agent,
        active: exa,
        provider: exa ? agent.provider : "Exa Answer (belum aktif)",
      };
    }),
    publish: AGENT_BLUEPRINT.publish.map((agent) => ({
      ...agent,
      active:
        agent.id === "publish-telegram"
          ? Boolean(telegramConfigured)
          : agent.id === "publish-whatsapp"
            ? whatsapp
            : true,
      provider:
        agent.id === "publish-telegram" && !telegramConfigured
          ? "Telegram (belum aktif)"
          : agent.id === "publish-whatsapp" && !whatsapp
            ? "Draft — WhatsApp Cloud API (belum aktif)"
            : agent.provider,
    })),
  };
}

const ROBOT_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS corporate_robot_jobs (
    lead_id TEXT PRIMARY KEY,
    stage TEXT NOT NULL DEFAULT 'finding',
    status TEXT NOT NULL DEFAULT 'queued',
    need_score INTEGER NOT NULL DEFAULT 0,
    need_label TEXT NOT NULL DEFAULT '',
    need_evidence TEXT NOT NULL DEFAULT '[]',
    contact_status TEXT NOT NULL DEFAULT 'pending',
    contact_confidence INTEGER NOT NULL DEFAULT 0,
    contact_evidence TEXT NOT NULL DEFAULT '[]',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    next_run_at TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT '',
    telegram_sent_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_telegram_outbox (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    claimed_at TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    telegram_message_id TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    next_attempt_at TEXT NOT NULL DEFAULT '',
    last_attempt_at TEXT NOT NULL DEFAULT '',
    review_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (lead_id, message_type)
  )`,
  `CREATE INDEX IF NOT EXISTS corporate_telegram_outbox_due
    ON corporate_telegram_outbox (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS corporate_whatsapp_outbox (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    claimed_at TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (lead_id)
  )`,
  `CREATE INDEX IF NOT EXISTS corporate_whatsapp_outbox_due
    ON corporate_whatsapp_outbox (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS corporate_robot_settings (
    owner_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_publish INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_robot_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0,
    notified INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS corporate_robot_jobs_due
    ON corporate_robot_jobs (stage, next_run_at)`,
  `CREATE TABLE IF NOT EXISTS app_state (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

let robotSchemaPromise;

export async function ensureRobotSchema(db) {
  if (!robotSchemaPromise) {
    robotSchemaPromise = (async () => {
      // Penanda versi mencegah CREATE/ALTER/INDEX dijalankan ulang setiap
      // isolate dingin; pernyataan DDL ikut dihitung sebagai penulisan.
      try {
        const marker = await db
          .prepare("SELECT value FROM corporate_meta WHERE key = 'robot_schema_version'")
          .first();
        if (marker?.value === ROBOT_SCHEMA_VERSION) return;
      } catch {
        /* tabel corporate_meta belum ada */
      }
      for (const sql of ROBOT_SCHEMA_SQL) {
        await db.prepare(sql).run();
      }
      // Migrasi tanpa menghapus outbox lama. Database yang dibuat sebelum
      // mekanisme retry belum memiliki dua kolom ini.
      for (const column of [
        "next_attempt_at TEXT NOT NULL DEFAULT ''",
        "last_attempt_at TEXT NOT NULL DEFAULT ''",
        "review_reason TEXT NOT NULL DEFAULT ''",
      ]) {
        try {
          await db
            .prepare(
              `ALTER TABLE corporate_telegram_outbox ADD COLUMN ${column}`,
            )
            .run();
        } catch {
          /* kolom sudah ada */
        }
      }
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS corporate_telegram_outbox_retry
           ON corporate_telegram_outbox (status, next_attempt_at, created_at)`,
        )
        .run();
      try {
        await db
          .prepare(
            "INSERT INTO corporate_meta (key, value) VALUES ('robot_schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .bind(ROBOT_SCHEMA_VERSION)
          .run();
      } catch {
        /* penanda opsional */
      }
    })().catch((error) => {
      robotSchemaPromise = undefined;
      throw error;
    });
  }
  return robotSchemaPromise;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function parseEvidence(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function rowToJob(row) {
  return {
    lead: rowToLead(row),
    stage: row.stage || "finding",
    status: row.status || "queued",
    needScore: Number(row.need_score || 0),
    needLabel: row.need_label || "",
    needEvidence: parseEvidence(row.need_evidence),
    contactStatus: row.contact_status || "pending",
    contactConfidence: Number(row.contact_confidence || 0),
    contactEvidence: parseEvidence(row.contact_evidence),
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || "",
    publishedAt: row.published_at || "",
    telegramSentAt: row.telegram_sent_at || "",
    updatedAt: row.job_updated_at || row.lead_updated_at || "",
  };
}

const JOB_SELECT = `
  SELECT
    j.lead_id, j.stage, j.status, j.need_score, j.need_label, j.need_evidence,
    j.contact_status, j.contact_confidence, j.contact_evidence, j.attempts,
    j.last_error, j.next_run_at, j.published_at, j.telegram_sent_at,
    j.updated_at AS job_updated_at,
    l.id, l.name, l.city, l.area, l.category, l.email, l.phone, l.website,
    l.updated_at AS lead_updated_at,
    l.contact_name, l.contact_role, l.contact_url, l.contact_source,
    l.latitude, l.longitude, l.coordinate_address, l.coordinate_source,
    l.validation_status, l.validation_evidence, l.validated_at, l.ai_confidence,
    l.screening_status, l.screening_evidence, l.screening_checked_at,
    l.screening_reviewed_at, l.screening_reviewed_by
  FROM corporate_robot_jobs j
  JOIN corporate_leads l ON l.id = j.lead_id
`;

async function readMeta(db, key) {
  const row = await db
    .prepare("SELECT value FROM corporate_meta WHERE key = ?")
    .bind(key)
    .first();
  return row?.value || "";
}

async function writeMeta(db, key, value) {
  // WHERE pada DO UPDATE membuat penulisan dilewati bila nilainya sama,
  // sehingga meta yang ditulis tiap tick tidak membakar kuota saat statis.
  await db
    .prepare(
      "INSERT INTO corporate_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE excluded.value <> corporate_meta.value",
    )
    .bind(key, value)
    .run();
}

/**
 * Hitung pekerjaan yang benar-benar jatuh tempo. Dipakai agar tick robot tidak
 * menulis apa pun saat antrean, outbox, dan screening sudah kosong.
 */
export async function robotDueWorkCounts(db, env = {}) {
  const now = nowIso();
  try {
    const jobs = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM corporate_robot_jobs WHERE status IN ('queued', 'ready_to_publish') AND (next_run_at = '' OR next_run_at <= ?)",
      )
      .bind(now)
      .first();
    const outbox = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM corporate_telegram_outbox WHERE status IN ('pending', 'failed') AND (next_attempt_at = '' OR next_attempt_at <= ?)",
      )
      .bind(now)
      .first();
    let screening = 0;
    if (opensanctionsConfigured(env)) {
      const cooldown = await opensanctionsQuotaCooldown(db);
      if (!cooldown.blocked) {
        const row = await db
          .prepare(
            "SELECT COUNT(*) AS total FROM corporate_leads WHERE screening_status = '' AND screening_reviewed_at = ''",
          )
          .first();
        screening = Number(row?.total || 0);
      }
    }
    return {
      jobs: Number(jobs?.total || 0),
      outbox: Number(outbox?.total || 0),
      screening,
    };
  } catch {
    // Gagal membaca antrean tidak boleh mematikan robot: anggap ada kerja.
    return { jobs: 1, outbox: 0, screening: 0 };
  }
}

async function readJob(db, leadId) {
  const row = await db
    .prepare(`${JOB_SELECT} WHERE j.lead_id = ?`)
    .bind(leadId)
    .first();
  return row ? rowToJob(row) : null;
}

async function updateJob(db, leadId, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) =>
    typeof value === "boolean" ? (value ? 1 : 0) : value,
  );
  await db
    .prepare(
      `UPDATE corporate_robot_jobs SET ${sets}, updated_at = ? WHERE lead_id = ?`,
    )
    .bind(...values, nowIso(), leadId)
    .run();
}

async function getSettings(db, ownerId = "") {
  if (ownerId) {
    return db
      .prepare("SELECT * FROM corporate_robot_settings WHERE owner_id = ?")
      .bind(ownerId)
      .first();
  }
  return db
    .prepare(
      "SELECT * FROM corporate_robot_settings WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1",
    )
    .first();
}

export async function updateRobotSettings(db, ownerId, input = {}) {
  await ensureRobotSchema(db);
  const previous = await getSettings(db, ownerId);
  // Robot ini sengaja tidak punya mode jeda/manual: scheduler harus selalu
  // aktif, dan setiap hasil yang lolos validasi wajib masuk Prospek.
  const enabled = true;
  const autoPublish = true;
  const telegramChatId =
    typeof input.telegramChatId === "string"
      ? clean(input.telegramChatId).replace(/[^0-9@A-Za-z_-]/g, "").slice(0, 64)
      : previous?.telegram_chat_id || "";
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO corporate_robot_settings
        (owner_id, enabled, auto_publish, telegram_chat_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         enabled = excluded.enabled,
         auto_publish = excluded.auto_publish,
         telegram_chat_id = excluded.telegram_chat_id,
         updated_at = excluded.updated_at`,
    )
    .bind(ownerId, enabled ? 1 : 0, autoPublish ? 1 : 0, telegramChatId, now, now)
    .run();
  return getSettings(db, ownerId);
}

async function ensureJobs(db) {
  const now = nowIso();
  // Job yang lead-nya sudah tidak ada lagi tidak boleh ikut dihitung sebagai
  // antrean. Tanpa pembersihan ini, angka robot bisa lebih besar dari
  // Corporate Engine dan membuat progres terlihat salah.
  await db
    .prepare(
      "DELETE FROM corporate_robot_jobs WHERE lead_id NOT IN (SELECT id FROM corporate_leads)",
    )
    .run();
  await db
    .prepare(
      `INSERT INTO corporate_robot_jobs
        (lead_id, stage, status, need_score, need_label, need_evidence,
         contact_status, contact_confidence, contact_evidence, attempts,
         last_error, next_run_at, published_at, telegram_sent_at, created_at, updated_at)
       SELECT l.id, 'finding', 'queued', 0, '', '[]', 'pending', 0, '[]', 0,
              '', ?, '', '', ?, ?
       FROM corporate_leads l
       WHERE NOT EXISTS (
         SELECT 1 FROM corporate_robot_jobs j WHERE j.lead_id = l.id
       )`,
    )
    .bind(now, now, now)
    .run();
  // Job lama yang dulu berhenti hanya karena skor kebutuhan belum terbukti
  // tetap harus diverifikasi kontaknya. Job yang berhenti karena validasi
  // gagal tidak direset berulang kali.
  await db
    .prepare(
      `UPDATE corporate_robot_jobs
       SET stage = 'clarification', status = 'queued', attempts = 0,
           next_run_at = ?, last_error = '', updated_at = ?
       WHERE stage = 'paused'
         AND attempts < 3`,
    )
    .bind(now, now)
    .run();
  // Stage publish versi lama melakukan Telegram + Prospek sekaligus. Pecah
  // data lama ke agen Telegram terlebih dahulu agar perilakunya konsisten.
  await db
    .prepare(
      "UPDATE corporate_robot_jobs SET stage = 'publish_telegram', updated_at = ? WHERE stage = 'publish'",
    )
    .bind(now)
    .run();
}

const NEED_DEFINITIONS = [
  {
    id: "upgrade-intent",
    label: "Rencana upgrade/pengadaan jaringan",
    weight: 20,
    strong: true,
    // Kata "upgrade" saja tidak cukup: ulasan "upgrade villa" bukan sinyal
    // jaringan. Objek upgrade harus eksplisit menyebut jaringan/internet/
    // perangkat dalam jarak dekat.
    re: /\b(?:upgrade|peningkatan|pengadaan|modernisasi|migrasi|perluasan|refresh|penggantian|replacement)\b[^.!?\n]{0,45}\b(?:jaringan|network|wifi|wi-fi|internet|bandwidth|perangkat|infrastruktur|server|access\s*point|akses\s*point)\b/i,
  },
  {
    id: "network",
    label: "Menyebut perangkat/jaringan",
    weight: 18,
    strong: true,
    re: /\b(?:access point|mikrotik|router|jaringan|network|lan|vpn|firewall|switch|poe|fiber|serat optik|bandwidth|internet dedicated|cctv)\b/i,
  },
  {
    id: "expansion",
    label: "Sinyal ekspansi/gedung baru",
    weight: 16,
    strong: true,
    re: /\b(?:renovasi|pembangunan|gedung baru|cabang baru|ekspansi|expansion|new branch|grand opening|pengembangan)\b/i,
  },
  {
    id: "digital-learning",
    label: "Digitalisasi/ujian berbasis komputer",
    weight: 14,
    strong: true,
    re: /\b(?:lab(?:oratorium)? komputer|cbt|computer based test|ujian online|e-?learning|lms|smart school|digitalisasi|kelas digital)\b/i,
  },
  {
    id: "hospitality-network",
    label: "Operasional hotel membutuhkan jaringan",
    weight: 12,
    strong: true,
    re: /\b(?:meeting room|ballroom|property management system|pms|smart hotel|renovasi kamar|new wing|upgrade wifi)\b/i,
  },
  {
    id: "it-role",
    label: "Menyebut peran/divisi IT",
    weight: 12,
    strong: true,
    re: /\b(?:it support|network engineer|sysadmin|system administrator|teknisi|helpdesk|teknologi informasi|divisi it)\b/i,
  },
  {
    id: "hiring",
    label: "Membuka posisi/rekrutmen",
    weight: 8,
    strong: false,
    re: /\b(?:lowongan|career|karir|rekrutmen|hiring|dibutuhkan|open position)\b/i,
  },
  {
    id: "internet",
    label: "Menyebut internet/WiFi/bandwidth",
    weight: 8,
    strong: false,
    re: /\b(?:wifi|wi-?fi|internet|hotspot|koneksi|uplink)\b/i,
  },
  {
    id: "many-users",
    label: "Operasional dengan banyak pengguna",
    weight: 6,
    strong: false,
    re: /\b(?:reservasi|booking|tamu|guest|siswa|mahasiswa|laboratorium komputer|kampus|ruang meeting|co-?working)\b/i,
  },
];

function excerptAround(text, index) {
  const start = Math.max(0, index - 80);
  return clean(text.slice(start, index + 150)).slice(0, 190);
}

/** Agen Finding 1: hanya membaca website resmi. */
async function runFindingProfileAgent(lead, options = {}) {
  const website = clean(lead.website);
  if (!website) {
    return {
      id: "finding-profile",
      name: "Profil Entitas",
      status: "skipped",
      summary: "Website belum tersedia; agen profil tidak memiliki halaman untuk dibaca.",
      evidence: [],
      text: "",
      pages: [],
    };
  }
  try {
    const sitePages = Math.max(1, Math.min(4, Number(options.sitePages) || 2));
    const site = await readPublicText(website, sitePages);
    const text = clean(site.text);
    if (!site.pages.length || text.length < 40) {
      return {
        id: "finding-profile",
        name: "Profil Entitas",
        status: "empty",
        summary: `Website ${website} tidak dapat dibaca atau isinya terlalu tipis.`,
        evidence: [],
        text,
        pages: site.pages,
      };
    }
    return {
      id: "finding-profile",
      name: "Profil Entitas",
      status: "ok",
      summary: `${site.pages.length} halaman website terbaca (${text.length} karakter).`,
      evidence: site.pages.slice(0, 3).map((url) => `Halaman dibaca: ${url}`),
      text,
      pages: site.pages,
    };
  } catch (error) {
    return {
      id: "finding-profile",
      name: "Profil Entitas",
      status: "error",
      summary: `Website ${website} gagal dibaca: ${
        error instanceof Error ? error.message : "kesalahan tidak diketahui"
      }.`,
      evidence: [],
      text: "",
      pages: [],
    };
  }
}

/** Query pencarian yang menargetkan sinyal upgrade, bukan hanya profil umum. */
export function findingSearchQueries(lead = {}) {
  const name = clean(lead.name);
  if (!name) return [];
  const place = [lead.area, lead.city, "Indonesia"].filter(Boolean).join(" ");
  const base = `"${name}" ${place}`;
  const categoryQuery =
    lead.category === "hotel"
      ? `${base} ("meeting room" OR ballroom OR "wifi hotel" OR "property management system" OR "renovasi kamar")`
      : lead.category === "school"
        ? `${base} ("lab komputer" OR CBT OR "ujian online" OR "wifi sekolah" OR "smart school" OR e-learning)`
        : `${base} (kantor cabang OR pabrik OR gudang OR server OR "network upgrade")`;
  return [
    `${base} (upgrade OR peningkatan OR pengadaan OR modernisasi) (wifi OR internet OR jaringan OR bandwidth OR "access point")`,
    `${base} (lowongan OR karir OR hiring) (IT OR network OR teknisi OR helpdesk)`,
    `${base} (renovasi OR "gedung baru" OR "cabang baru" OR ekspansi OR expansion) (wifi OR jaringan OR internet)`,
    categoryQuery,
  ];
}

/** Agen Finding 2: hanya mencari sumber publik lewat Exa; tidak membaca website. */
async function runFindingSignalAgent(lead, env = {}, options = {}) {
  if (!clean(env.EXA_API_KEY)) {
    return {
      id: "finding-signals",
      name: "Sinyal Publik",
      status: "disabled",
      summary: "Exa belum aktif; agen sinyal publik tidak dijalankan.",
      evidence: [],
      results: [],
      error: "",
    };
  }
  if (options.run === false) {
    return {
      id: "finding-signals",
      name: "Sinyal Publik",
      status: "skipped",
      summary: "Dilewati karena opsi pencarian publik dimatikan.",
      evidence: [],
      results: [],
      error: "",
    };
  }

  const queries = findingSearchQueries(lead);
  const searches = await Promise.all(
    queries.map((query) => exaSearch(env, query, { numResults: 4 })),
  );
  const results = [];
  const seen = new Set();
  let firstError = "";
  for (const search of searches) {
    if (search.error && !firstError) firstError = search.error;
    for (const result of search.results || []) {
      const highlights = Array.isArray(result?.highlights) ? result.highlights : [];
      const text = clean(
        `${result?.title || ""} ${highlights.join(" ")} ${result?.url || ""}`,
      );
      if (!searchResultMatches(lead, text)) continue;
      const key = clean(result?.url) || text.slice(0, 180);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push({
        text,
        source: /linkedin\.com/i.test(result?.url || "") ? "LinkedIn/publik" : "sumber publik",
        url: clean(result?.url),
      });
    }
  }
  return {
    id: "finding-signals",
    name: "Sinyal Publik",
    status: results.length > 0 ? "ok" : "empty",
    summary:
      results.length > 0
        ? `${results.length} hasil relevan dari ${queries.length} query Exa.`
        : `Exa tidak menemukan hasil relevan dari ${queries.length} query.`,
    evidence: results.slice(0, 4).map(
      (result) => `${result.source}: ${result.url || result.text.slice(0, 120)}`,
    ),
    results,
    error: firstError,
  };
}

/** Agen Finding 3: hanya menilai hasil dua agen sebelumnya; tidak mengambil data baru. */
export function runFindingQualifierAgent(lead, profile, signal) {
  const base = lead.category === "hotel" ? 34 : lead.category === "school" ? 36 : 22;
  const evidence = [];
  const seen = new Set();
  let strongCount = 0;
  let score = base;

  const scan = (text, source) => {
    if (!text) return;
    for (const definition of NEED_DEFINITIONS) {
      if (seen.has(definition.id)) continue;
      const match = definition.re.exec(text);
      if (!match) continue;
      seen.add(definition.id);
      score += definition.weight;
      if (definition.strong) strongCount += 1;
      evidence.push(`${definition.label} — ${source} — ${excerptAround(text, match.index)}`);
    }
  };

  scan(profile.text, "Profil Entitas/website");
  for (const result of signal.results || []) {
    scan(result.text, result.source);
  }

  score = Math.max(0, Math.min(100, score));
  // Satu kata "wifi" di website bukan bukti kebutuhan upgrade. Minimal harus
  // ada satu sinyal kuat (jaringan, upgrade, ekspansi, IT, digitalisasi, atau
  // kebutuhan jaringan hotel) sebelum lead dianggap qualified.
  const qualified = evidence.length > 0 && strongCount > 0 && score >= 48;
  const label =
    score >= 75
      ? "Kebutuhan kuat"
      : score >= 58
        ? "Peluang baik"
        : score >= 42
          ? "Perlu verifikasi"
          : "Belum terbukti";

  return {
    id: "finding-qualifier",
    name: "Penilai Kebutuhan",
    status: "ok",
    summary: `Skor ${score}/100 · ${label} · ${evidence.length} sinyal (${strongCount} kuat) dari dua agen sebelumnya.`,
    evidence: evidence.slice(0, 4),
    score,
    label,
    strongCount,
    qualified,
    allEvidence: evidence,
  };
}

/**
 * Orkestrasi tiga agen Finding. Setiap agen memiliki input dan proses sendiri:
 * profil membaca website, sinyal mencari sumber publik, lalu penilai hanya
 * mengolah keluaran keduanya. Hasil per agen dikembalikan untuk ditampilkan.
 */
export async function assessNeed(lead, env = {}, options = {}) {
  const shouldRunSignal = options.exaSearch !== false;
  const [profile, signal] = await Promise.all([
    runFindingProfileAgent(lead, options),
    runFindingSignalAgent(lead, env, { run: shouldRunSignal }),
  ]);
  const qualifier = runFindingQualifierAgent(lead, profile, signal);
  const agentResults = [profile, signal, qualifier];

  return {
    score: qualifier.score,
    label: qualifier.label,
    evidence: qualifier.allEvidence.slice(0, 6),
    qualified: qualifier.qualified,
    exaEnabled: signal.status !== "disabled",
    exaError: signal.error || "",
    agents: agentResults.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      summary: agent.summary,
      evidence: agent.evidence.slice(0, 4),
    })),
  };
}

function searchResultMatches(lead, haystack) {
  const tokens = clean(lead.name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  // Wilayah disimpan sebagai "Kab. Cianjur", "Kec. Gunung Sindur", dan
  // sejenisnya; teks hasil pencarian biasanya hanya menulis nama wilayahnya.
  const regionKey = (value) =>
    clean(value)
      .toLowerCase()
      .replace(/^(?:kota|kabupaten|kab\.?|kecamatan|kec\.?)\s+/, "")
      .trim();
  const city = regionKey(lead.city);
  const area = regionKey(lead.area);
  const hay = haystack.toLowerCase();
  return (
    tokens.some((token) => hay.includes(token)) ||
    Boolean(city && hay.includes(city)) ||
    Boolean(area && hay.includes(area))
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoryLabel(category) {
  return category === "hotel" ? "Hotel" : category === "school" ? "Sekolah" : "Perusahaan";
}

function telegramConfig(env, settings) {
  const token = clean(env?.TELEGRAM_BOT_TOKEN);
  const chatId = clean(settings?.telegram_chat_id) || clean(env?.TELEGRAM_CHAT_ID);
  return {
    token,
    chatId,
    target: clean(env?.TELEGRAM_TARGET_PHONE) || DEFAULT_TELEGRAM_PHONE,
    configured: Boolean(token && chatId),
  };
}

export async function sendTelegram(env, settings, text, options = {}) {
  const config = telegramConfig(env, settings);
  if (!config.token) {
    return { ok: false, configured: false, error: "TELEGRAM_BOT_TOKEN belum diatur." };
  }
  if (!config.chatId) {
    return { ok: false, configured: false, error: "TELEGRAM_CHAT_ID belum diatur." };
  }
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          ...(options.parseMode === "plain" ? {} : { parse_mode: "HTML" }),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      const description =
        typeof body?.description === "string" ? body.description.trim() : "";
      return {
        ok: false,
        configured: true,
        error: description
          ? `Telegram menolak pesan: ${description}`
          : "Telegram menolak pesan. Periksa bot token dan chat ID.",
      };
    }
    return {
      ok: true,
      configured: true,
      error: "",
      messageId: String(body?.result?.message_id || ""),
    };
  } catch (error) {
    console.error(
      "corporate_robot_telegram_error",
      error instanceof Error ? error.message : "unknown error",
    );
    // Hasil jaringan yang ambigu tidak boleh di-retry otomatis: Telegram bisa
    // saja sudah menerima pesan sebelum respons terputus.
    return {
      ok: false,
      configured: true,
      uncertain: true,
      error: "Telegram tidak dapat dihubungi; status pengiriman belum pasti.",
    };
  }
}

const TELEGRAM_PLACEHOLDER = "Belum tersedia";
const TELEGRAM_MESSAGE_TYPE = "lead_ready";
// Kurir Telegram tidak memakai kuota harian. Batas per batch hanya menjaga
// waktu respons Worker; sisa antrean dikirim pada batch cron berikutnya.
const TELEGRAM_BATCH_LIMIT = 10;
const TELEGRAM_MAX_ATTEMPTS = 8;
const TELEGRAM_RETRY_BASE_MS = 5 * 60 * 1000;
const TELEGRAM_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const TELEGRAM_SENDING_STALE_MS = 15 * 60 * 1000;
const TELEGRAM_UNCERTAIN_REVIEW_MS = 60 * 60 * 1000;
const TELEGRAM_REVIEW_BATCH_LIMIT = 10;

function retryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(6, Number(attempts || 1) - 1));
  return Math.min(TELEGRAM_RETRY_MAX_MS, TELEGRAM_RETRY_BASE_MS * 2 ** exponent);
}

/**
 * Menandai baris yang tidak mungkin dikirim lagi tanpa keputusan manusia.
 * `sending` yang tertinggal berarti Worker berhenti setelah klaim; hasilnya
 * tidak pasti, jadi jangan dikirim ulang otomatis (bisa duplikat). Setelah
 * tenggat, pesan masuk `needs_review` agar tidak menggantung selamanya.
 */
export async function reconcileTelegramOutbox(db, now = Date.now()) {
  const nowAt = new Date(now).toISOString();
  const sendingCutoff = new Date(now - TELEGRAM_SENDING_STALE_MS).toISOString();
  const uncertainCutoff = new Date(
    now - TELEGRAM_UNCERTAIN_REVIEW_MS,
  ).toISOString();
  await db
    .prepare(
      `UPDATE corporate_telegram_outbox
       SET status = 'uncertain', claimed_at = '', next_attempt_at = '',
           review_reason = 'uncertain',
           last_error = CASE WHEN last_error = '' THEN ? ELSE last_error END,
           updated_at = ?
       WHERE status = 'sending'
         AND (claimed_at = '' OR claimed_at < ?)`,
    )
    .bind(
      "Pengiriman terputus sebelum hasil diterima; status belum pasti.",
      nowAt,
      sendingCutoff,
    )
    .run();
  await db
    .prepare(
      `UPDATE corporate_telegram_outbox
       SET status = 'needs_review', claimed_at = '', next_attempt_at = '',
           review_reason = 'uncertain',
           last_error = CASE WHEN last_error = ''
             THEN 'Status pengiriman tidak pasti; perlu dicek atau dikirim ulang manual.'
             ELSE last_error END,
           updated_at = ?
       WHERE status = 'uncertain' AND updated_at < ?`,
    )
    .bind(nowAt, uncertainCutoff)
    .run();
  await db
    .prepare(
      `UPDATE corporate_telegram_outbox
       SET status = 'needs_review', claimed_at = '', next_attempt_at = '',
           review_reason = 'failed',
           last_error = CASE WHEN last_error = ''
             THEN 'Batas percobaan habis; perlu dicek atau dikirim ulang manual.'
             ELSE last_error END,
           updated_at = ?
       WHERE status = 'failed' AND attempts >= ?`,
    )
    .bind(nowAt, TELEGRAM_MAX_ATTEMPTS)
    .run();
}

export async function readTelegramOutboxHealth(db) {
  const rows = await db
    .prepare(
      "SELECT status, review_reason, COUNT(*) AS total FROM corporate_telegram_outbox GROUP BY status, review_reason",
    )
    .all();
  const health = {
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
  for (const row of rows.results ?? []) {
    const total = Number(row.total || 0);
    const status = String(row.status || "");
    const reason = String(row.review_reason || "");
    health.total += total;
    if (status === "needs_review") {
      health.needsReview += total;
      if (["failed", "invalid", ""].includes(reason)) health.retryable += total;
    } else if (status === "failed") {
      health.failed += total;
      health.retryable += total;
    } else if (status in health) {
      health[status] += total;
    }
  }
  health.attention =
    health.failed + health.uncertain + health.needsReview + health.sending;
  return health;
}

function telegramOutboxId(leadId, messageType = TELEGRAM_MESSAGE_TYPE) {
  return `${leadId}:${messageType}`;
}

async function enqueueTelegramOutbox(db, leadId, messageType = TELEGRAM_MESSAGE_TYPE) {
  const now = nowIso();
  const id = telegramOutboxId(leadId, messageType);
  await db
    .prepare(
      `INSERT INTO corporate_telegram_outbox
        (id, lead_id, message_type, status, attempts, claimed_at, sent_at,
         telegram_message_id, last_error, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, '', '', '', '', ?, ?)
       ON CONFLICT(lead_id, message_type) DO NOTHING`,
    )
    .bind(id, leadId, messageType, now, now)
    .run();
  return db
    .prepare("SELECT * FROM corporate_telegram_outbox WHERE id = ?")
    .bind(id)
    .first();
}

/** Melengkapi outbox untuk lead lama yang belum punya baris outbox. */
async function seedTelegramOutbox(db) {
  const now = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO corporate_telegram_outbox
        (id, lead_id, message_type, status, attempts, claimed_at, sent_at,
         telegram_message_id, last_error, created_at, updated_at)
       SELECT l.id || ':' || ?, l.id, ?, 'pending', 0, '', '', '', '', ?, ?
       FROM corporate_robot_jobs j
       JOIN corporate_leads l ON l.id = j.lead_id
       WHERE j.telegram_sent_at = ''
         AND j.stage IN ('publish', 'publish_telegram', 'publish_prospect', 'done')
         AND l.contact_name <> '' AND l.phone <> ''`,
    )
    .bind(TELEGRAM_MESSAGE_TYPE, TELEGRAM_MESSAGE_TYPE, now, now)
    .run();
}

async function enqueueWhatsAppOutreach(db, lead) {
  const phone = validPicPhone(lead?.phone) ? clean(lead.phone) : "";
  const contactName = sanitizePicName(lead?.contactName);
  if (!phone || !contactName || !isPicRole(lead?.contactRole)) return null;
  const now = nowIso();
  const id = `${lead.id}:lead_outreach`;
  await db
    .prepare(
      `INSERT INTO corporate_whatsapp_outbox
        (id, lead_id, status, attempts, claimed_at, sent_at, message_id,
         last_error, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, '', '', '', '', ?, ?)
       ON CONFLICT(lead_id) DO NOTHING`,
    )
    .bind(id, lead.id, now, now)
    .run();
  return id;
}

export async function readWhatsAppOutboxHealth(db) {
  const rows = await db
    .prepare(
      "SELECT status, COUNT(*) AS total FROM corporate_whatsapp_outbox GROUP BY status",
    )
    .all();
  const health = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    needsReview: 0,
    total: 0,
    attention: 0,
  };
  for (const row of rows.results ?? []) {
    const total = Number(row.total || 0);
    const status = String(row.status || "");
    health.total += total;
    if (status in health) health[status] += total;
  }
  health.attention =
    health.failed + health.uncertain + health.needsReview + health.sending;
  return health;
}

/**
 * Agen Publish WhatsApp. Hanya mengirim template resmi sekali per lead setelah
 * Klarifikasi menghasilkan PIC. Tidak memakai pesan bebas karena Meta
 * mewajibkan template untuk percakapan pertama di luar jendela 24 jam.
 */
async function notifyPendingWhatsApp(db, env, settings, limit = 2) {
  if (!whatsappOutreachConfigured(env)) {
    return { checked: 0, sent: 0, items: [] };
  }
  const rows = await db
    .prepare(
      `SELECT o.id AS outbox_id, o.attempts AS outbox_attempts, l.*
       FROM corporate_whatsapp_outbox o
       JOIN corporate_leads l ON l.id = o.lead_id
       WHERE o.status = 'pending'
       ORDER BY o.created_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  const items = [];
  let sent = 0;
  for (const row of rows.results ?? []) {
    const claimedAt = nowIso();
    const claim = await db
      .prepare(
        `UPDATE corporate_whatsapp_outbox
         SET status = 'sending', attempts = attempts + 1,
             claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(claimedAt, claimedAt, row.outbox_id)
      .run();
    if (!claim.meta?.changes) continue;

    const lead = rowToLead(row);
    if (!telegramLeadReady(lead)) {
      const error = "Nama PIC atau nomor PIC belum lolos gate WhatsApp.";
      await db
        .prepare(
          `UPDATE corporate_whatsapp_outbox
           SET status = 'needs_review', claimed_at = '', last_error = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(error, nowIso(), row.outbox_id)
        .run();
      items.push({ id: row.outbox_id, status: "needs_review", error });
      continue;
    }

    const result = await sendWhatsAppTemplate(env, db, {
      ownerId: settings?.owner_id || "",
      phone: lead.phone,
      parameters: [sanitizePicName(lead.contactName), clean(lead.name)],
    });
    const finishedAt = nowIso();
    const status = result.ok
      ? "sent"
      : result.uncertain
        ? "uncertain"
        : "needs_review";
    await db
      .prepare(
        `UPDATE corporate_whatsapp_outbox
         SET status = ?, claimed_at = '', sent_at = ?, message_id = ?,
             last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        status,
        result.ok ? finishedAt : "",
        result.messageId || "",
        result.ok ? "" : result.error || "WhatsApp gagal.",
        finishedAt,
        row.outbox_id,
      )
      .run();
    if (result.ok) sent += 1;
    items.push({
      id: row.outbox_id,
      status,
      error: result.ok ? "" : result.error || "WhatsApp gagal.",
    });
  }
  return { checked: (rows.results ?? []).length, sent, items };
}

/**
 * Mengirim isi outbox secara idempoten. Klaim dilakukan dengan UPDATE atomik
 * sebelum send, sehingga dua proses tidak dapat mengirim baris yang sama.
 */
async function flushTelegramOutbox(db, env, settings, limit = 2, onlyId = "") {
  const config = telegramConfig(env, settings);
  if (!config.configured) return { checked: 0, sent: 0, items: [] };

  const dueAt = nowIso();
  const where = onlyId
    ? "o.id = ?"
    : "o.status IN ('pending', 'failed') AND (o.next_attempt_at = '' OR o.next_attempt_at <= ?)";
  const bindings = onlyId ? [onlyId] : [dueAt];
  const rows = await db
    .prepare(
      `SELECT o.id AS outbox_id, o.lead_id AS outbox_lead_id,
              o.message_type, o.status AS outbox_status,
              o.attempts AS outbox_attempts, o.sent_at AS outbox_sent_at,
              o.telegram_message_id, o.last_error AS outbox_error, l.*
       FROM corporate_telegram_outbox o
       JOIN corporate_leads l ON l.id = o.lead_id
       WHERE ${where}
       ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END,
                o.created_at ASC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all();

  const items = [];
  let sent = 0;
  for (const row of rows.results ?? []) {
    const outbox = {
      id: row.outbox_id,
      leadId: row.outbox_lead_id,
      messageType: row.message_type,
      status: row.outbox_status,
      sentAt: row.outbox_sent_at || "",
      error: row.outbox_error || "",
    };

    if (outbox.status === "sent") {
      items.push({ ...outbox, alreadySent: true });
      continue;
    }

    const claimedAt = nowIso();
    const claim = await db
      .prepare(
        `UPDATE corporate_telegram_outbox
         SET status = 'sending', attempts = attempts + 1,
             claimed_at = ?, last_attempt_at = ?, next_attempt_at = '',
             updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(claimedAt, claimedAt, claimedAt, outbox.id)
      .run();
    if (!claim.meta?.changes) {
      items.push({
        ...outbox,
        status: "sending",
        error: "Pesan sedang dikirim oleh proses lain.",
      });
      continue;
    }

    const message = buildTelegramMessage(rowToLead(row));
    if (!message) {
      const error =
        "Telegram tidak dikirim: nama PIC atau nomor PIC belum lengkap.";
      await db
        .prepare(
          `UPDATE corporate_telegram_outbox
           SET status = 'needs_review', claimed_at = '', next_attempt_at = '',
               review_reason = 'invalid', last_attempt_at = ?, last_error = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(nowIso(), error, nowIso(), outbox.id)
        .run();
      items.push({ ...outbox, status: "needs_review", error });
      continue;
    }

    const result = await sendTelegram(env, settings, message);
    const finishedAt = nowIso();
    if (result.ok) {
      await db
        .prepare(
          `UPDATE corporate_telegram_outbox
           SET status = 'sent', sent_at = ?, telegram_message_id = ?,
               claimed_at = '', next_attempt_at = '', review_reason = '',
               last_error = '', updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          finishedAt,
          result.messageId || "",
          finishedAt,
          outbox.id,
        )
        .run();
      await updateJob(db, outbox.leadId, {
        telegram_sent_at: finishedAt,
      }).catch(() => undefined);
      sent += 1;
      items.push({
        ...outbox,
        status: "sent",
        sentAt: finishedAt,
        alreadySent: false,
        error: "",
      });
      continue;
    }

    // `failed` aman dicoba lagi dengan jeda eksponensial. `uncertain` terjadi
    // saat koneksi putus setelah request dikirim; jangan retry otomatis agar
    // tidak menghasilkan pesan ganda. Rekonsiliasi akan memindahkannya ke
    // needs_review setelah tenggat agar tidak menggantung selamanya.
    const attempts = Number(outbox.attempts || 0) + 1;
    const nextStatus = result.uncertain ? "uncertain" : "failed";
    const nextAttemptAt =
      nextStatus === "failed"
        ? new Date(Date.now() + retryDelayMs(attempts)).toISOString()
        : "";
    await db
      .prepare(
        `UPDATE corporate_telegram_outbox
         SET status = ?, claimed_at = '', next_attempt_at = ?,
             review_reason = '', last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        nextStatus,
        nextAttemptAt,
        result.error || "Telegram gagal.",
        finishedAt,
        outbox.id,
      )
      .run();
    items.push({
      ...outbox,
      status: nextStatus,
      nextAttemptAt,
      error: result.error || "Telegram gagal.",
    });
  }

  return { checked: (rows.results ?? []).length, sent, items };
}

function contactReadyForPublish(lead) {
  // Telegram hanya boleh membawa titik entitas yang sudah jelas sumbernya.
  // Pusat wilayah dan hasil geocoding jalan tidak cukup untuk publikasi.
  return Boolean(
    sanitizePicName(lead.contactName) &&
      isPicRole(lead.contactRole) &&
      validPicPhone(lead.phone) &&
      // E-mail PIC wajib: "verified" tanpa e-mail PIC bukan hasil Klarifikasi
      // yang lengkap, jadi Telegram dan Prospek harus menolaknya.
      picEmailReady(lead) &&
      hasBoundPicPhoneEvidence(lead) &&
      // Bukti harus menyebut orang yang sama, bukan orang lain di halaman itu.
      picEvidenceMatchesLead(lead) &&
      coordinateReadyForPublish(lead),
  );
}

function clarificationValid(lead) {
  // Tim Klarifikasi harus menyatakan seluruh identitas valid: nama PIC,
  // nomor PIC, e-mail PIC, website, dan koordinat entitas. `contactStatus`
  // saja tidak cukup karena tidak memeriksa e-mail, sehingga lead dengan
  // e-mail generik tidak boleh lolos ke Telegram atau Prospek.
  return (
    contactReadyForPublish(lead) &&
    clean(lead.validationStatus) === "verified"
  );
}

function telegramLeadReady(lead) {
  // Publish tidak boleh jalan selama hasil OpenSanctions berisiko tinggi
  // belum dikonfirmasi manusia di Robot AI, atau selama Klarifikasi belum
  // menyatakan identitas PIC/e-mail valid.
  return clarificationValid(lead) && !screeningReviewRequired(lead);
}

function prospectLeadReady(lead) {
  // Penulis Prospek menerima lead yang sama dengan Kurir Telegram. E-mail dan
  // website boleh kosong, tetapi koordinat dan review screening harus lolos.
  return telegramLeadReady(lead);
}

/**
 * Format tetap tujuh baris. Hanya nama PIC dan nomor PIC yang wajib; baris
 * lain yang belum tersedia diisi placeholder agar pesan tetap lengkap.
 */
export function buildTelegramMessage(lead) {
  if (!telegramLeadReady(lead)) return "";
  const coordinate = resolveLeadCoordinates(lead);
  const mapsUrl = coordinate
    ? `https://www.google.com/maps?q=${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`
    : TELEGRAM_PLACEHOLDER;
  const location =
    clean(lead.coordinateAddress) ||
    coordinate?.coordinateAddress ||
    [clean(lead.area), clean(lead.city)].filter(Boolean).join(", ") ||
    TELEGRAM_PLACEHOLDER;
  const entity = categoryLabel(lead.category);
  return [
    `Nama ${entity} : ${escapeHtml(clean(lead.name) || TELEGRAM_PLACEHOLDER)}`,
    `Titik Koordinat : ${mapsUrl}`,
    `Lokasi : ${escapeHtml(location)}`,
    `Nama PIC : ${escapeHtml(sanitizePicName(lead.contactName))}`,
    `Nomor PIC : ${escapeHtml(formatPicPhones(lead.phone, 2))}`,
    `Alamat E-mail : ${escapeHtml(clean(lead.email) || TELEGRAM_PLACEHOLDER)}`,
    `Alamat Website ${entity} : ${escapeHtml(clean(lead.website) || TELEGRAM_PLACEHOLDER)}`,
  ].join("\n");
}

/**
 * Setelah kontak diperbaiki, pesan lama yang sebelumnya ditolak gate masih
 * berstatus needs_review. Evaluasi ulang hanya baris yang sekarang punya nama
 * PIC dan nomor valid; baris yang masih lemah dibiarkan agar tidak dikirim.
 */
async function requeueCorrectedTelegram(db, limit = TELEGRAM_REVIEW_BATCH_LIMIT) {
  const rows = await db
    .prepare(
      `SELECT o.id AS outbox_id, l.*
       FROM corporate_telegram_outbox o
       JOIN corporate_leads l ON l.id = o.lead_id
       WHERE o.status = 'needs_review'
         AND o.review_reason IN ('invalid', 'failed')
       ORDER BY l.updated_at DESC, o.updated_at DESC
       LIMIT 100`,
    )
    .all();
  let requeued = 0;
  for (const row of rows.results ?? []) {
    if (requeued >= limit) break;
    if (!buildTelegramMessage(rowToLead(row))) continue;
    const now = nowIso();
    const reset = await db
      .prepare(
        `UPDATE corporate_telegram_outbox
         SET status = 'pending', attempts = 0, claimed_at = '',
             next_attempt_at = '', last_attempt_at = '', review_reason = '',
             last_error = '', updated_at = ?
         WHERE id = ? AND status = 'needs_review'
           AND review_reason IN ('invalid', 'failed')`,
      )
      .bind(now, row.outbox_id)
      .run();
    if (reset.meta?.changes) requeued += 1;
  }
  return requeued;
}

async function notifyPending(db, env, settings, limit = 2) {
  await reconcileTelegramOutbox(db);
  const config = telegramConfig(env, settings);
  if (!config.configured) return { checked: 0, sent: 0 };
  await seedTelegramOutbox(db);
  await requeueCorrectedTelegram(db).catch((error) => {
    console.error(
      "corporate_robot_telegram_requeue_error",
      error instanceof Error ? error.message : "unknown error",
    );
  });
  const result = await flushTelegramOutbox(db, env, settings, limit);
  return { checked: result.checked, sent: result.sent };
}

/**
 * Kirim ulang eksplisit untuk pesan yang sudah berhenti otomatis. Pesan
 * `uncertain` sengaja tidak termasuk: retry otomatis dapat menggandakan pesan
 * yang mungkin sudah diterima Telegram. Setelah dikarantina sebagai
 * `needs_review`, pengguna dapat memilih untuk mencoba lagi lewat aksi ini.
 */
export async function retryStuckTelegram(db, env, ownerId = "", options = {}) {
  const includeUncertain = Boolean(options?.includeUncertain);
  const leadIds = new Set(
    (Array.isArray(options?.leadIds) ? options.leadIds : [])
      .map((id) => clean(String(id || "")))
      .filter(Boolean),
  );
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  let settings = await getSettings(db, ownerId);
  if (!settings) settings = await ensureCronOwner(db);
  if (!telegramConfig(env, settings).configured) {
    return {
      ok: false,
      requeued: 0,
      sent: 0,
      message: "Telegram belum dikonfigurasi.",
      health: await readTelegramOutboxHealth(db),
    };
  }

  const rows = await db
    .prepare(
      `SELECT o.id AS outbox_id, l.*
       FROM corporate_telegram_outbox o
       JOIN corporate_leads l ON l.id = o.lead_id
       WHERE o.status = 'failed'
          OR (o.status = 'needs_review' AND (
            o.review_reason IN ('failed', 'invalid', '')
            OR (? = 1 AND o.review_reason = 'uncertain')
          ))
       ORDER BY l.updated_at DESC, o.created_at ASC
       LIMIT ?`,
    )
    .bind(includeUncertain ? 1 : 0, TELEGRAM_REVIEW_BATCH_LIMIT * 10)
    .all();
  let requeued = 0;
  let sent = 0;
  for (const row of rows.results ?? []) {
    if (requeued >= TELEGRAM_REVIEW_BATCH_LIMIT) break;
    if (leadIds.size > 0 && !leadIds.has(clean(row.id))) continue;
    // Jangan reset baris yang masih tidak lolos gate; biarkan needs_review
    // sampai kontaknya diperbaiki.
    if (!buildTelegramMessage(rowToLead(row))) continue;
    const now = nowIso();
    const reset = await db
      .prepare(
        `UPDATE corporate_telegram_outbox
         SET status = 'pending', attempts = 0, claimed_at = '',
             next_attempt_at = '', last_attempt_at = '', review_reason = '',
             last_error = '', updated_at = ?
         WHERE id = ? AND (status = 'failed'
           OR (status = 'needs_review' AND (
             review_reason IN ('failed', 'invalid', '')
             OR (? = 1 AND review_reason = 'uncertain')
           )))`,
      )
      .bind(now, row.outbox_id, includeUncertain ? 1 : 0)
      .run();
    if (!reset.meta?.changes) continue;
    requeued += 1;
    const flushed = await flushTelegramOutbox(db, env, settings, 1, row.outbox_id);
    if (flushed.items[0]?.status === "sent") sent += 1;
  }

  return {
    ok: true,
    requeued,
    sent,
    message:
      requeued > 0
        ? `${requeued} pesan dicoba ulang; ${sent} terkirim.`
        : "Tidak ada pesan macet yang bisa dikirim ulang.",
    health: await readTelegramOutboxHealth(db),
  };
}

function normalizeCompanyName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pt|cv|tbk|persero|ud|pd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRobotCompanyRecord(company) {
  return (
    Boolean(clean(company?.sourceLeadId)) ||
    /robot ai|corporate engine/i.test(clean(company?.source))
  );
}

function isRobotProspectCompany(company) {
  return (
    Boolean(clean(company?.sourceLeadId)) ||
    /robot ai|^corporate engine$/i.test(clean(company?.source))
  );
}

async function readProspectCompanies(db, ownerId) {
  const row = await db
    .prepare("SELECT payload FROM app_state WHERE user_id = ?")
    .bind(ownerId)
    .first();
  if (!row?.payload) return null;
  try {
    const data = JSON.parse(row.payload);
    return Array.isArray(data?.companies) ? data.companies : null;
  } catch {
    return null;
  }
}

/**
 * Audit read-only: bandingkan pesan Telegram yang sudah terkirim dengan
 * Prospek yang benar-benar tersimpan. Hasilnya juga dipakai untuk menjelaskan
 * alasan lead yang tidak bisa ditambahkan.
 */
export async function auditTelegramProspects(db, ownerId) {
  if (!ownerId) {
    return {
      telegramSent: 0,
      inProspect: 0,
      queued: 0,
      eligible: 0,
      notEligible: 0,
      eligibleLeadIds: [],
      reasons: [{ name: "", reason: "Pemilik robot belum ditentukan." }],
    };
  }
  const rows = await db
    .prepare(
      `SELECT l.id AS lead_id, l.name, l.city, l.area, l.contact_name, l.phone,
              l.latitude, l.longitude, l.coordinate_address, l.coordinate_source,
              j.stage AS job_stage, j.attempts AS job_attempts,
              j.last_error AS job_last_error,
              j.telegram_sent_at, j.published_at,
              o.status AS outbox_status, o.sent_at AS outbox_sent_at
       FROM corporate_leads l
       LEFT JOIN corporate_robot_jobs j ON j.lead_id = l.id
       LEFT JOIN corporate_telegram_outbox o
         ON o.lead_id = l.id AND o.message_type = ?
       WHERE j.telegram_sent_at <> '' OR o.status = 'sent'
       ORDER BY l.name ASC`,
    )
    .bind(TELEGRAM_MESSAGE_TYPE)
    .all();
  const sent = rows.results ?? [];
  const companies = await readProspectCompanies(db, ownerId);
  if (!companies) {
    return {
      telegramSent: sent.length,
      inProspect: 0,
      queued: 0,
      eligible: 0,
      notEligible: sent.length,
      eligibleLeadIds: [],
      reasons: sent.map((row) => ({
        leadId: clean(row.lead_id),
        name: clean(row.name) || "Tanpa nama",
        reason: "Data Prospek pemilik robot tidak tersedia atau tidak dapat dibaca.",
      })),
    };
  }
  const bySource = new Map(
    companies.map((company) => [clean(company.sourceLeadId), company]),
  );
  const byName = new Map(
    companies.map((company) => [normalizeCompanyName(company.name), company]),
  );
  const reasons = [];
  const eligibleLeadIds = [];
  let inProspect = 0;
  let queued = 0;
  for (const row of sent) {
    const leadId = clean(row.lead_id);
    const name = clean(row.name);
    const matched =
      (leadId && bySource.get(leadId)) ||
      (name && byName.get(normalizeCompanyName(name)));
    if (matched) {
      inProspect += 1;
      continue;
    }
    let reason = "";
    if (!row.job_stage) reason = "Job robot tidak ditemukan.";
    else if (!name) reason = "Nama perusahaan kosong.";
    else if (!sanitizePicName(row.contact_name)) reason = "Nama PIC kosong.";
    else if (!validPicPhone(row.phone)) {
      reason = "Nomor PIC kosong atau tidak valid.";
    } else if (!coordinateReadyForPublish(rowToLead(row))) {
      reason = "Koordinat entitas belum tepat atau belum dikonfirmasi.";
    } else if (row.job_stage === "publish_prospect") {
      queued += 1;
      continue;
    } else if (
      row.job_stage === "paused" &&
      Number(row.job_attempts) >= 3 &&
      /prospek|data akun|terlalu besar|batas jumlah|berubah saat robot/i.test(
        clean(row.job_last_error),
      )
    ) {
      reason = clean(row.job_last_error) || "Robot berhenti setelah 3 percobaan.";
    }
    if (reason) {
      reasons.push({ leadId, name: name || "Tanpa nama", reason });
    } else {
      eligibleLeadIds.push(leadId);
    }
  }
  return {
    telegramSent: sent.length,
    inProspect,
    queued,
    eligible: eligibleLeadIds.length,
    notEligible: reasons.length,
    eligibleLeadIds,
    reasons,
  };
}

/**
 * Audit arah sebaliknya: Prospek robot yang tidak punya catatan Telegram
 * terkirim. Hasilnya membedakan data lama, antrean yang belum selesai, dan
 * Prospek yang ditulis tanpa catatan pengiriman.
 */
export async function auditProspectTelegramHistory(db, ownerId) {
  if (!ownerId) return null;
  const companies = await readProspectCompanies(db, ownerId);
  if (!companies) return null;
  const robotCompanies = companies.filter(isRobotProspectCompany);
  const sourceIds = [
    ...new Set(robotCompanies.map((company) => clean(company.sourceLeadId)).filter(Boolean)),
  ];
  const leadMap = new Map();
  const jobMap = new Map();
  if (sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => "?").join(", ");
    const [leadRows, jobRows] = await Promise.all([
      db
        .prepare(`SELECT id, name FROM corporate_leads WHERE id IN (${placeholders})`)
        .bind(...sourceIds)
        .all(),
      db
        .prepare(
          `SELECT j.lead_id, j.stage, j.status, j.telegram_sent_at, j.published_at,
                  o.status AS outbox_status, o.sent_at AS outbox_sent_at,
                  o.review_reason AS outbox_review_reason,
                  o.last_error AS outbox_last_error
           FROM corporate_robot_jobs j
           LEFT JOIN corporate_telegram_outbox o
             ON o.lead_id = j.lead_id AND o.message_type = ?
           WHERE j.lead_id IN (${placeholders})`,
        )
        .bind(TELEGRAM_MESSAGE_TYPE, ...sourceIds)
        .all(),
    ]);
    for (const row of leadRows.results ?? []) leadMap.set(clean(row.id), row);
    for (const row of jobRows.results ?? []) jobMap.set(clean(row.lead_id), row);
  }

  const categories = {
    "tanpa-source": 0,
    "lead-hilang": 0,
    "job-hilang": 0,
    "antrean-telegram": 0,
    "perlu-ditinjau": 0,
    "tanpa-catatan": 0,
    "belum-terkirim": 0,
  };
  const items = [];
  let withTelegram = 0;
  for (const company of robotCompanies) {
    const sourceLeadId = clean(company.sourceLeadId);
    const lead = sourceLeadId ? leadMap.get(sourceLeadId) : null;
    const job = sourceLeadId ? jobMap.get(sourceLeadId) : null;
    const outboxStatus = clean(job?.outbox_status);
    const outboxReviewReason = clean(job?.outbox_review_reason);
    const hasTelegram = Boolean(clean(job?.telegram_sent_at) || outboxStatus === "sent");
    if (hasTelegram) {
      withTelegram += 1;
      continue;
    }
    let category = "belum-terkirim";
    let reason = "Job robot belum mencapai tahap pengiriman Telegram.";
    if (!sourceLeadId) {
      category = "tanpa-source";
      reason = "Prospek robot tidak menyimpan sourceLeadId, sehingga tidak bisa dicocokkan dengan riwayat Telegram.";
    } else if (!lead) {
      category = "lead-hilang";
      reason = "Lead sumber tidak ditemukan; kemungkinan Prospek lama atau lead sudah dihapus.";
    } else if (!job) {
      category = "job-hilang";
      reason = "Job robot tidak ditemukan; kemungkinan Prospek lama atau dibuat di luar antrean robot.";
    } else if (["pending", "sending", "failed", "uncertain"].includes(outboxStatus)) {
      category = "antrean-telegram";
      reason = `Antrean Telegram masih berstatus ${outboxStatus}; pesan belum tercatat terkirim.`;
    } else if (!outboxStatus) {
      category = "tanpa-catatan";
      reason = "Job robot ada, tetapi tidak ada catatan outbox Telegram.";
    } else if (["done", "publish_prospect", "publish"].includes(clean(job.stage))) {
      if (outboxStatus) {
        category = "perlu-ditinjau";
        reason = `Antrean Telegram berstatus ${outboxStatus}; hasil pengiriman belum dapat dipastikan.`;
      } else {
        category = "tanpa-catatan";
        reason = "Job atau Prospek sudah selesai, tetapi tidak ada catatan Telegram terkirim.";
      }
    }
    categories[category] += 1;
    items.push({
      name: clean(company.name),
      sourceLeadId,
      leadName: clean(lead?.name),
      stage: clean(job?.stage),
      outboxStatus,
      outboxReviewReason,
      outboxError: clean(job?.outbox_last_error),
      category,
      reason,
    });
  }
  return {
    totalProspects: companies.length,
    robotCompanies: robotCompanies.length,
    manualCompanies: companies.length - robotCompanies.length,
    withTelegram,
    withoutTelegram: items.length,
    categories,
    items,
  };
}

/** Requeue lead terkirim yang memenuhi syarat tetapi belum ada di Prospek. */
export async function reconcileTelegramProspects(db, ownerId) {
  const audit = await auditTelegramProspects(db, ownerId);
  if (audit.eligibleLeadIds.length === 0) return { ...audit, requeued: 0 };
  const now = nowIso();
  let requeued = 0;
  for (const leadId of audit.eligibleLeadIds) {
    const result = await db
      .prepare(
        `UPDATE corporate_robot_jobs
         SET stage = 'publish_prospect', status = 'ready_to_publish',
             attempts = 0, published_at = '', next_run_at = ?, last_error = '',
             updated_at = ?
         WHERE lead_id = ?`,
      )
      .bind(now, now, leadId)
      .run();
    if (result.meta?.changes) requeued += 1;
  }
  return { ...audit, requeued };
}

/**
 * Menambahkan lead yang sudah dikirim Kurir Telegram ke data Prospek milik
 * pemilik robot. Ini dilakukan server-side agar hasil robot langsung tersedia
 * di aplikasi.
 */
export async function publishLeadToProspect(db, ownerId, lead) {
  if (!ownerId) return { added: false, reason: "Pemilik robot belum ditentukan." };
  if (!prospectLeadReady(lead)) {
    return {
      added: false,
      reason:
        "Klarifikasi belum menyatakan nama PIC, nomor PIC, e-mail PIC, dan koordinat entitas valid.",
    };
  }
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  await ensureRobotSchema(db);
  const row = await db
    .prepare("SELECT payload, revision FROM app_state WHERE user_id = ?")
    .bind(ownerId)
    .first();

  let data;
  let revision = 0;
  if (row) {
    revision = Number(row.revision || 0);
    try {
      data = JSON.parse(row.payload);
    } catch {
      return { added: false, reason: "Data akun tidak dapat dibaca." };
    }
  } else {
    data = {
      companies: [],
      quotes: [],
      locations: ["Jakarta"],
      profile: { username: "", phone: "", email: "" },
    };
  }
  if (!data || !Array.isArray(data.companies)) {
    return { added: false, reason: "Struktur Prospek tidak dikenali." };
  }
  if (data.companies.length > 4900) {
    return { added: false, reason: "Batas jumlah prospek tercapai." };
  }

  const existing =
    data.companies.find((company) => company?.sourceLeadId === lead.id) ||
    data.companies.find(
      (company) =>
        isRobotCompanyRecord(company) &&
        normalizeCompanyName(company?.name) === normalizeCompanyName(lead.name),
    );
  const prior = existing || {};
  const now = nowIso();
  const location =
    [clean(lead.area), clean(lead.city)].filter(Boolean).join(", ") ||
    clean(prior.location) ||
    data.locations?.[0] ||
    "Jakarta";
  // Koreksi manusia atau pusat elemen OSM yang sudah tersimpan tidak boleh
  // ditimpa koordinat lama dari lead robot. Lazuardi sempat kembali ke titik
  // jalan karena publish ulang membawa koordinat Panel AI yang lama.
  const lockPriorCoordinate = Boolean(
    existing &&
      coordinateReadyForPublish(prior) &&
      (/^Dikonfirmasi manual\b/i.test(clean(prior.coordinateSource)) ||
        /^OpenStreetMap (?:node|way|relation)\b/i.test(clean(prior.coordinateSource))),
  );
  const coordinateFields = lockPriorCoordinate
    ? {
        latitude: Number(prior.latitude),
        longitude: Number(prior.longitude),
        coordinateAddress: clean(prior.coordinateAddress),
        coordinateSource: clean(prior.coordinateSource),
      }
    : {
        latitude:
          Number.isFinite(latitude) && latitude !== 0
            ? latitude
            : Number(prior.latitude || 0),
        longitude:
          Number.isFinite(longitude) && longitude !== 0
            ? longitude
            : Number(prior.longitude || 0),
        coordinateAddress:
          clean(lead.coordinateAddress) || clean(prior.coordinateAddress),
        coordinateSource:
          clean(lead.coordinateSource) || clean(prior.coordinateSource),
      };
  const robotFields = {
    name: clean(lead.name),
    location,
    email: clean(lead.email) || clean(prior.email),
    picPhone: formatPicPhones(lead.phone, 2),
    website: clean(lead.website) || clean(prior.website),
    contactName: sanitizePicName(lead.contactName),
    contactRole: clean(lead.contactRole) || clean(prior.contactRole),
    contactSource: clean(lead.contactSource) || clean(prior.contactSource),
    ...coordinateFields,
    // Status terbaru dari Klarifikasi selalu menang. Jangan mempertahankan
    // `verified` lama bila riset ulang menyatakan partial, karena itu membuat
    // lead yang sudah tidak valid tetap tampil seolah tervalidasi.
    validationStatus:
      clean(lead.validationStatus) || clean(prior.validationStatus) || "partial",
    validationEvidence:
      Array.isArray(lead.validationEvidence) && lead.validationEvidence.length
        ? lead.validationEvidence
        : Array.isArray(prior.validationEvidence)
          ? prior.validationEvidence
          : [],
    validatedAt: lead.validatedAt || clean(prior.validatedAt) || now,
    aiConfidence: Number(lead.aiConfidence || prior.aiConfidence || 0),
    // Simpan hasil screening bersama record Prospek. Tanpa ini, audit ulang
    // terhadap record hasil Publish selalu gagal gate screening karena
    // statusnya tidak pernah ikut tersimpan, bukan karena lead berisiko.
    screeningStatus: clean(lead.screeningStatus) || clean(prior.screeningStatus),
    screeningEvidence:
      Array.isArray(lead.screeningEvidence) && lead.screeningEvidence.length
        ? lead.screeningEvidence
        : Array.isArray(prior.screeningEvidence)
          ? prior.screeningEvidence
          : [],
    screeningCheckedAt:
      clean(lead.screeningCheckedAt) || clean(prior.screeningCheckedAt),
    screeningReviewedAt:
      clean(lead.screeningReviewedAt) || clean(prior.screeningReviewedAt),
    screeningReviewedBy:
      clean(lead.screeningReviewedBy) || clean(prior.screeningReviewedBy),
    source: "Corporate Engine · Robot AI",
    sourceLeadId: lead.id,
  };

  let companyId = "";
  let added = false;
  if (existing) {
    companyId = existing.id;
    const updated = {
      ...existing,
      ...robotFields,
      id: existing.id,
      createdAt: existing.createdAt || now,
      visitDate: existing.visitDate || "",
      lostReason: existing.lostReason || "",
      lostAt: existing.lostAt || "",
    };
    data.companies = data.companies.map((company) =>
      company.id === existing.id ? updated : company,
    );
  } else {
    const company = {
      id: `co_robot_${crypto.randomUUID()}`,
      ...robotFields,
      visitDate: "",
      createdAt: now,
      lostReason: "",
      lostAt: "",
    };
    companyId = company.id;
    added = true;
    data.companies = [company, ...data.companies];
  }
  if (Array.isArray(data.locations) && !data.locations.includes(location)) {
    data.locations = [...data.locations, location];
  }
  const payload = JSON.stringify(data);
  if (payload.length > MAX_APP_STATE_CHARS) {
    return { added: false, reason: "Data Prospek terlalu besar untuk ditambah otomatis." };
  }
  if (revision === 0) {
    const result = await db
      .prepare(
        "INSERT INTO app_state (user_id, payload, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING",
      )
      .bind(ownerId, payload, now)
      .run();
    if (!result.meta?.changes) {
      return { added: false, reason: "Data berubah saat robot menyimpan; tambahkan lewat Visit." };
    }
    return { added, companyId, updated: Boolean(existing), reason: "" };
  }

  const result = await db
    .prepare(
      "UPDATE app_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?",
    )
    .bind(payload, now, ownerId, revision)
    .run();
  if (!result.meta?.changes) {
    return { added: false, reason: "Data berubah saat robot menyimpan; tambahkan lewat Visit." };
  }
  return { added, companyId, updated: Boolean(existing), reason: "" };
}

// D1 memakai optimistic revision untuk app_state. Saat beberapa lead selesai
// bersamaan, jangan biarkan dua penulisan Prospek saling menimpa; antrekan
// penulisan state di dalam isolate yang sama.
let publishQueue = Promise.resolve();
function enqueuePublish(work) {
  const next = publishQueue.then(work, work);
  publishQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Agen Publish 2 — Penulis Prospek. Menulis lead yang sudah diterima Kurir
 * Telegram ke Prospek; tidak mengirim Telegram.
 */
async function publishProspectAgent(db, settings, ownerId, lead) {
  if (!settings?.auto_publish || !ownerId) {
    return { added: false, updated: false, reason: "Penulisan Prospek belum diaktifkan." };
  }
  return enqueuePublish(() => publishLeadToProspect(db, ownerId, lead));
}

/**
 * Agen Publish 1 — Kurir Telegram. Semua pengiriman masuk ke outbox dengan
 * kunci unik `lead_id + jenis pesan`; tidak ada jalur kirim langsung.
 */
export async function sendPublishTelegram(db, row, env, settings, lead) {
  const configured = Boolean(telegramConfig(env, settings).configured);
  if (row.telegram_sent_at) {
    return {
      ok: true,
      configured,
      alreadySent: true,
      sentAt: row.telegram_sent_at,
      error: "",
    };
  }
  if (!telegramLeadReady(lead)) {
    return {
      ok: false,
      configured,
      alreadySent: false,
      sentAt: "",
      error: "Telegram tidak dikirim: nama PIC atau nomor PIC belum lengkap.",
    };
  }

  const leadId = row.lead_id || lead.id;
  const outbox = await enqueueTelegramOutbox(db, leadId);
  if (outbox?.status === "sent") {
    return {
      ok: true,
      configured,
      alreadySent: true,
      sentAt: outbox.sent_at || "",
      error: "",
    };
  }

  const flushed = await flushTelegramOutbox(db, env, settings, 1, outbox.id);
  const item = flushed.items[0];
  if (item?.status === "sent") {
    return {
      ok: true,
      configured,
      alreadySent: Boolean(item.alreadySent),
      sentAt: item.sentAt || "",
      error: "",
    };
  }
  return {
    ok: false,
    configured,
    alreadySent: false,
    sentAt: "",
    pending: item?.status === "sending",
    error: item?.error || "Telegram belum dapat dikirim.",
  };
}

async function advanceJob(db, row, env, settings, ownerId) {
  let lead = rowToLead(row);
  let stage = row.stage || "finding";
  // Job lama dari sebelum pemisahan stage Publish.
  if (stage === "publish") stage = "publish_telegram";
  let attempts = Number(row.attempts || 0);
  let needScore = Number(row.need_score || 0);
  let needLabel = row.need_label || "";
  let needEvidence = parseEvidence(row.need_evidence);
  let contactStatus = row.contact_status || "pending";
  let contactConfidence = Number(row.contact_confidence || 0);
  let contactEvidence = parseEvidence(row.contact_evidence);
  let published = 0;
  let prospectAdded = 0;
  let notified = 0;
  let found = false;

  // Satu tahap per invokasi. Cloudflare membatasi subrequest per request;
  // Finding + Klarifikasi + Publish sekaligus menghabiskan kuota sehingga
  // panel riset dan screening berikutnya gagal. Tahap berikutnya dijalankan
  // oleh tick/retrigger selanjutnya dengan kuota jaringan baru.
  for (let step = 0; step < 1; step += 1) {
    if (stage === "finding") {
      const assessment = await assessNeed(lead, env, {
        exaSearch: true,
        sitePages: 8,
      });
      needScore = assessment.score;
      needLabel = assessment.label;
      const findingTrace = (assessment.agents || []).flatMap((agent) => [
        `[${agent.name}] ${findingStatusLabel(agent.status)}: ${agent.summary}`,
        ...agent.evidence.map((item) => `[${agent.name}] ${item}`),
      ]);
      needEvidence = findingTrace.slice(0, 12);
      attempts += 1;
      // Skor kebutuhan tidak boleh menghentikan verifikasi identitas dan
      // kontak. Semua lead Corporate Engine tetap masuk ke klarifikasi agar
      // data Prospek hanya berisi informasi yang lengkap dan tervalidasi.
      found = true;
      stage = "clarification";
      await updateJob(db, lead.id, {
        stage,
        status: assessment.qualified ? "qualified" : "needs_validation",
        need_score: needScore,
        need_label: needLabel,
        need_evidence: JSON.stringify(needEvidence),
        attempts,
        last_error: assessment.qualified
          ? ""
          : "Kebutuhan belum terbukti; validasi kontak tetap dilakukan.",
        next_run_at: nowIso(),
      });
      continue;
    }

    if (stage === "clarification") {
      let researched = null;
      try {
        researched = await researchCorporateLead(db, lead.id, env);
      } catch (error) {
        console.error(
          "corporate_robot_research_error",
          error instanceof Error ? error.message : "unknown error",
        );
      }
      if (researched?.lead) lead = researched.lead;
      const validation = researched?.validation || {};
      contactStatus = validation.contactStatus || validation.status || "missing";
      contactConfidence = Number(researched?.lead?.aiConfidence || 0);
      contactEvidence = Array.isArray(validation.evidence)
        ? validation.evidence
        : [];
      attempts += 1;

      // Lead dengan hasil OpenSanctions berisiko tinggi ditahan di review
      // manusia. Robot tetap memproses lead lain; lead ini baru dilanjutkan
      // setelah tombol konfirmasi ditekan di Robot AI.
      if (screeningReviewRequired(lead)) {
        stage = "paused";
        await updateJob(db, lead.id, {
          stage,
          status: "screening_review",
          contact_status: contactStatus,
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error: screeningHoldReason(lead),
          next_run_at: addDays(1),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }

      // Klarifikasi selesai bila nama PIC, nomor PIC, dan koordinat entitas
      // benar-benar tervalidasi—bukan hanya karena field-nya terisi. Stage
      // berikutnya hanya mengirim Telegram; stage ini tidak menulis Prospek.
      if (telegramLeadReady(lead) && contactStatus === "verified") {
        found = true;
        stage = "publish_telegram";
        await updateJob(db, lead.id, {
          stage,
          status: "ready_to_publish",
          contact_status: contactStatus,
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error: "",
          next_run_at: nowIso(),
        });
        await enqueueWhatsAppOutreach(db, lead).catch((error) => {
          console.error(
            "corporate_robot_whatsapp_enqueue_error",
            error instanceof Error ? error.message : "unknown error",
          );
        });
        continue;
      }

      const exhausted = attempts >= 3;
      const nextStage = exhausted ? "paused" : "clarification";
      await updateJob(db, lead.id, {
        stage: nextStage,
        status: exhausted ? "waiting" : "needs_validation",
        contact_status: contactStatus,
        contact_confidence: contactConfidence,
        contact_evidence: JSON.stringify(contactEvidence),
        attempts,
        last_error:
          "Lead belum lolos validasi website, e-mail PIC, nomor PIC, dan koordinat. Sumber publik akan diperiksa lagi.",
        next_run_at: exhausted ? addDays(1) : addHours(2),
      });
      return {
        found: false,
        published: 0,
        prospectAdded: 0,
        notified,
        job: await readJob(db, lead.id),
      };
    }

    if (stage === "publish_telegram") {
      if (contactStatus !== "verified" || !clarificationValid(lead)) {
        attempts += 1;
        const exhausted = attempts >= 3;
        const nextStage = exhausted ? "paused" : "clarification";
        await updateJob(db, lead.id, {
          stage: nextStage,
          status: exhausted ? "waiting" : "needs_validation",
          contact_status: contactStatus || "partial",
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error:
            "PIC, nomor PIC, atau koordinat entitas belum tervalidasi; lead dikembalikan ke Klarifikasi.",
          next_run_at: exhausted ? addDays(1) : addHours(2),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }
      if (screeningReviewRequired(lead)) {
        await updateJob(db, lead.id, {
          stage: "paused",
          status: "screening_review",
          contact_status: contactStatus,
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error: screeningHoldReason(lead),
          next_run_at: addDays(1),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }
      // Agen Publish 1 — hanya mengirim Telegram. Tidak menulis Prospek.
      const telegram = await sendPublishTelegram(db, row, env, settings, lead);
      if (telegram.ok) {
        row = { ...row, telegram_sent_at: telegram.sentAt };
        if (!telegram.alreadySent) notified = 1;
      }

      if (!prospectLeadReady(lead)) {
        const exhausted = attempts >= 3;
        const nextStage = exhausted ? "paused" : "clarification";
        await updateJob(db, lead.id, {
          stage: nextStage,
          status: exhausted ? "waiting" : "needs_validation",
          contact_status: contactStatus || "partial",
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error:
            telegram.error ||
            "Telegram selesai; nama PIC, nomor PIC, atau koordinat entitas belum lengkap.",
          next_run_at: exhausted ? addDays(1) : addHours(2),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }

      stage = "publish_prospect";
      await updateJob(db, lead.id, {
        stage,
        status: "ready_to_publish",
        contact_status: contactStatus,
        contact_confidence: contactConfidence,
        contact_evidence: JSON.stringify(contactEvidence),
        attempts,
        last_error: "",
        next_run_at: nowIso(),
      });
      continue;
    }

    if (stage === "publish_prospect") {
      if (contactStatus !== "verified" || !clarificationValid(lead)) {
        attempts += 1;
        const exhausted = attempts >= 3;
        const nextStage = exhausted ? "paused" : "clarification";
        await updateJob(db, lead.id, {
          stage: nextStage,
          status: exhausted ? "waiting" : "needs_validation",
          contact_status: contactStatus || "partial",
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error:
            "PIC, nomor PIC, atau koordinat entitas belum tervalidasi; lead dikembalikan ke Klarifikasi.",
          next_run_at: exhausted ? addDays(1) : addHours(2),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }
      if (screeningReviewRequired(lead)) {
        await updateJob(db, lead.id, {
          stage: "paused",
          status: "screening_review",
          contact_status: contactStatus,
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error: screeningHoldReason(lead),
          next_run_at: addDays(1),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }
      // Agen Publish 2 — hanya menulis Prospek. Tidak mengirim Telegram.
      if (!prospectLeadReady(lead)) {
        const exhausted = attempts >= 3;
        const nextStage = exhausted ? "paused" : "clarification";
        await updateJob(db, lead.id, {
          stage: nextStage,
          status: exhausted ? "waiting" : "needs_validation",
          contact_status: contactStatus || "partial",
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          last_error:
            "Nama PIC, nomor PIC, atau koordinat entitas belum lengkap; lead dikembalikan ke Klarifikasi.",
          next_run_at: exhausted ? addDays(1) : addHours(2),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }

      const prospect = await publishProspectAgent(db, settings, ownerId, lead);
      if (!prospect.added && !prospect.updated) {
        attempts += 1;
        const exhausted = attempts >= 3;
        await updateJob(db, lead.id, {
          stage: exhausted ? "paused" : "publish_prospect",
          status: exhausted ? "waiting" : "ready_to_publish",
          contact_status: contactStatus,
          contact_confidence: contactConfidence,
          contact_evidence: JSON.stringify(contactEvidence),
          attempts,
          telegram_sent_at: row.telegram_sent_at || "",
          last_error: prospect.reason || "Prospek gagal ditulis; akan dicoba lagi.",
          next_run_at: exhausted ? addDays(1) : addHours(2),
        });
        return {
          found: false,
          published: 0,
          prospectAdded: 0,
          notified,
          job: await readJob(db, lead.id),
        };
      }
      prospectAdded = 1;

      const now = nowIso();
      attempts += 1;
      published = 1;
      await updateJob(db, lead.id, {
        stage: "done",
        status: "published",
        contact_status: contactStatus,
        contact_confidence: contactConfidence,
        contact_evidence: JSON.stringify(contactEvidence),
        attempts,
        published_at: now,
        telegram_sent_at: row.telegram_sent_at || "",
        last_error: "",
      });
      return {
        found: true,
        published,
        prospectAdded,
        notified,
        job: await readJob(db, lead.id),
      };
    }

    return {
      found,
      published,
      prospectAdded,
      notified,
      job: await readJob(db, lead.id),
    };
  }

  return {
    found,
    published,
    prospectAdded,
    notified,
    job: await readJob(db, lead.id),
  };
}

export async function readStats(db) {
  const stageRows = await db
    .prepare(
      `SELECT j.stage, COUNT(*) AS total
       FROM corporate_robot_jobs j
       JOIN corporate_leads l ON l.id = j.lead_id
       GROUP BY j.stage`,
    )
    .all();
  const stats = {
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
    whatsappSent: 0,
  };
  for (const row of stageRows.results ?? []) {
    const count = Number(row.total || 0);
    stats.total += count;
    if (row.stage === "publish" || row.stage === "publish_telegram") {
      stats.publish += count;
      stats.publishTelegram += count;
    } else if (row.stage === "publish_prospect") {
      stats.publish += count;
      stats.publishProspect += count;
    } else if (row.stage in stats) {
      stats[row.stage] = count;
    }
  }
  stats.active = stats.finding + stats.clarification + stats.publish;
  const extras = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN j.published_at <> '' THEN 1 ELSE 0 END) AS published,
        SUM(CASE WHEN j.telegram_sent_at <> '' THEN 1 ELSE 0 END) AS notified
       FROM corporate_robot_jobs j
       JOIN corporate_leads l ON l.id = j.lead_id`,
    )
    .first();
  stats.published = Number(extras?.published || 0);
  stats.notified = Number(extras?.notified || 0);
  const whatsapp = await db
    .prepare("SELECT COUNT(*) AS total FROM corporate_whatsapp_outbox WHERE status = 'sent'")
    .first()
    .catch(() => null);
  stats.whatsappSent = Number(whatsapp?.total || 0);
  const searches = await db
    .prepare("SELECT COUNT(*) AS total FROM corporate_leads")
    .first();
  stats.searches = Number(searches?.total || 0);
  return stats;
}

export async function ensureCronOwner(db) {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  const anySettings = await db
    .prepare("SELECT * FROM corporate_robot_settings ORDER BY updated_at DESC LIMIT 1")
    .first();
  if (anySettings) {
    if (anySettings.enabled && anySettings.auto_publish) return anySettings;
    return updateRobotSettings(db, anySettings.owner_id, {
      enabled: true,
      autoPublish: true,
    });
  }
  const owner = await db
    .prepare("SELECT user_id FROM app_state ORDER BY updated_at DESC LIMIT 1")
    .first();
  if (!owner?.user_id) return null;
  return updateRobotSettings(db, owner.user_id, { enabled: true, autoPublish: true });
}

export async function markCronTick(db) {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  await writeMeta(db, "robot_last_cron_tick", nowIso());
}

export async function getCronHealth(db) {
  if (!db) return { ok: false, lastTick: "", lastRun: "", lastRunStats: null };
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  const last = await db
    .prepare(
      "SELECT started_at, finished_at, checked, found, published, notified, error FROM corporate_robot_runs ORDER BY started_at DESC LIMIT 1",
    )
    .first();
  return {
    ok: true,
    lastTick: await readMeta(db, "robot_last_cron_tick"),
    lastRun: await readMeta(db, "robot_last_run"),
    lastRunStats: last
      ? {
          startedAt: last.started_at || "",
          finishedAt: last.finished_at || "",
          checked: Number(last.checked || 0),
          found: Number(last.found || 0),
          published: Number(last.published || 0),
          notified: Number(last.notified || 0),
          error: last.error || "",
        }
      : null,
  };
}

/**
 * Backfill status screening untuk lead lama tanpa mengubah tahap robot.
 * Jalankan dalam batch kecil dari tick robot atau endpoint admin; lead yang
 * sudah punya status tidak disentuh agar hasil review tidak ter-flag ulang.
 */
export async function backfillCorporateScreening(db, env = {}, limit = 5) {
  if (!opensanctionsConfigured(env)) {
    return {
      skipped: true,
      checked: 0,
      review: 0,
      remaining: 0,
      reason: "OPENSANCTIONS_API_KEY belum tersedia.",
    };
  }
  await ensureCorporateSchema(db);
  const cooldown = await opensanctionsQuotaCooldown(db);
  if (cooldown.blocked) {
    const remainingRow = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM corporate_leads WHERE screening_status = '' AND screening_reviewed_at = ''",
      )
      .first()
      .catch(() => null);
    return {
      skipped: true,
      checked: 0,
      review: 0,
      remaining: Number(remainingRow?.total || 0),
      reason: `OpenSanctions kuota/billing habis (HTTP 402); backfill ditunda sampai ${cooldown.until}.`,
    };
  }
  const size = Math.max(1, Math.min(25, Number(limit) || 5));
  const rows = await db
    .prepare(
      `SELECT id, name, contact_name
       FROM corporate_leads
       WHERE screening_status = '' AND screening_reviewed_at = ''
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .bind(size)
    .all();
  let checked = 0;
  let review = 0;
  for (const row of rows.results ?? []) {
    try {
      const result = await screenLeadOpenSanctions(
        db,
        { id: row.id, name: row.name, contactName: row.contact_name || "" },
        env,
      );
      if (!result || result.status === "disabled") continue;
      const evidence = Array.isArray(result.evidence) ? result.evidence : [];
      await db
        .prepare(
          `UPDATE corporate_leads
           SET screening_status = ?, screening_evidence = ?, screening_checked_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          result.status,
          JSON.stringify(evidence.slice(0, 12)),
          result.checkedAt || nowIso(),
          nowIso(),
          row.id,
        )
        .run();
      checked += 1;
      if (result.status === "review") review += 1;
    } catch (error) {
      console.error(
        "corporate_screening_backfill_error",
        row.id,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  const remainingRow = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM corporate_leads WHERE screening_status = '' AND screening_reviewed_at = ''",
    )
    .first()
    .catch(() => null);
  return {
    skipped: false,
    checked,
    review,
    remaining: Number(remainingRow?.total || 0),
  };
}

async function readScreeningStats(db) {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN screening_status = 'clear' THEN 1 ELSE 0 END) AS clear_total,
         SUM(CASE WHEN screening_status = 'review' THEN 1 ELSE 0 END) AS review_total,
         SUM(CASE WHEN screening_status = 'error' THEN 1 ELSE 0 END) AS error_total,
         SUM(CASE WHEN screening_status = 'disabled' THEN 1 ELSE 0 END) AS disabled_total,
         SUM(CASE WHEN screening_status = 'review' AND screening_reviewed_at = '' THEN 1 ELSE 0 END) AS pending_review,
         SUM(CASE WHEN screening_status = '' THEN 1 ELSE 0 END) AS unchecked_total,
         COUNT(*) AS total
       FROM corporate_leads`,
    )
    .first()
    .catch(() => null);
  return {
    clear: Number(row?.clear_total || 0),
    review: Number(row?.review_total || 0),
    error: Number(row?.error_total || 0),
    disabled: Number(row?.disabled_total || 0),
    pendingReview: Number(row?.pending_review || 0),
    unchecked: Number(row?.unchecked_total || 0),
    total: Number(row?.total || 0),
  };
}

/**
 * Konfirmasi atau buka kembali flag review OpenSanctions. Konfirmasi tidak
 * mengubah hasil screening; ia hanya mencatat bahwa manusia sudah meninjau
 * bukti dan mengizinkan lead melanjutkan Publish.
 */
export async function reviewCorporateScreening(
  db,
  ownerId,
  leadId,
  reviewed,
) {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  const row = await db
    .prepare(
      "SELECT id, screening_status FROM corporate_leads WHERE id = ?",
    )
    .bind(leadId)
    .first();
  if (!row) return { ok: false, message: "Lead tidak ditemukan." };
  if (row.screening_status === "clear") {
    return {
      ok: false,
      message: "Lead ini sudah lolos screening OpenSanctions.",
    };
  }
  // Review, error kuota, layanan nonaktif, dan status yang belum diperiksa
  // sama-sama ditahan gate. Manusia boleh mengonfirmasi tinjauan manual untuk
  // melepas penahanan; hasil screening tetap disimpan apa adanya.
  const now = nowIso();
  if (reviewed) {
    await db
      .prepare(
        `UPDATE corporate_leads
         SET screening_reviewed_at = ?, screening_reviewed_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, clean(ownerId), now, leadId)
      .run();
    await db
      .prepare(
        `UPDATE corporate_robot_jobs
         SET stage = 'clarification', status = 'needs_validation', attempts = 0,
             last_error = '', next_run_at = ?, updated_at = ?
         WHERE lead_id = ?`,
      )
      .bind(now, now, leadId)
      .run();
    return {
      ok: true,
      reviewed: true,
      reviewedAt: now,
      message:
        row.screening_status === "review"
          ? "Review OpenSanctions dikonfirmasi. Lead dilanjutkan ke Publish."
          : "Tinjauan manual screening dikonfirmasi. Lead dilanjutkan ke Publish.",
    };
  }
  await db
    .prepare(
      `UPDATE corporate_leads
       SET screening_reviewed_at = '', screening_reviewed_by = '', updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, leadId)
    .run();
  await db
    .prepare(
      `UPDATE corporate_robot_jobs
       SET stage = 'paused', status = 'screening_review',
           last_error = ?, next_run_at = ?, updated_at = ?
       WHERE lead_id = ?`,
    )
    .bind(
      "Tinjauan manual screening dibuka kembali. Konfirmasi diperlukan sebelum Publish.",
      addDays(1),
      now,
      leadId,
    )
    .run();
  return {
    ok: true,
    reviewed: false,
    reviewedAt: "",
    message: "Penahanan screening dipasang kembali.",
  };
}

export async function getRobotStatus(db, env = {}, ownerId = "") {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  await ensureJobs(db);
  let settings = await getSettings(db, ownerId);
  if (!settings) settings = await ensureCronOwner(db);
  if (settings && (!settings.enabled || !settings.auto_publish)) {
    settings = await updateRobotSettings(db, settings.owner_id, {
      enabled: true,
      autoPublish: true,
    });
  }
  await reconcileTelegramOutbox(db);
  const outbox = await readTelegramOutboxHealth(db);
  const whatsappOutbox = await readWhatsAppOutboxHealth(db).catch(() => null);
  const stats = await readStats(db);
  const screeningStats = await readScreeningStats(db);
  let prospectSync = null;
  try {
    prospectSync = await auditTelegramProspects(db, ownerId || settings?.owner_id || "");
  } catch (error) {
    console.error(
      "corporate_robot_prospect_audit_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  let prospectHistory = null;
  try {
    prospectHistory = await auditProspectTelegramHistory(
      db,
      ownerId || settings?.owner_id || "",
    );
  } catch (error) {
    console.error(
      "corporate_robot_prospect_history_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  // Kirim beberapa nama per tim, bukan satu daftar campuran, agar halaman
  // Robot AI bisa menampilkan pekerjaan Finding, Klarifikasi, dan Publish
  // sesuai urutan timnya tanpa kehilangan salah satu tim. Lead yang sudah
  // selesai tidak lagi "sedang dikerjakan" sehingga tidak masuk daftar ini.
  const teamStages = [
    ["finding"],
    ["clarification", "paused"],
    ["publish", "publish_telegram", "publish_prospect"],
  ];
  const teamRows = await Promise.all(
    teamStages.map(async (stages) => {
      const placeholders = stages.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `${JOB_SELECT}
           WHERE j.stage IN (${placeholders})
           ORDER BY j.need_score DESC, j.updated_at DESC
           LIMIT 6`,
        )
        .bind(...stages)
        .all();
      return (result.results ?? []).map(rowToJob);
    }),
  );
  const jobs = teamRows.flat();
  const lastRun = await db
    .prepare(
      "SELECT started_at, finished_at, checked, found, published, notified, error FROM corporate_robot_runs ORDER BY started_at DESC LIMIT 1",
    )
    .first();
  const lastRunAt = lastRun?.finished_at || lastRun?.started_at || "";
  const nextRunAt =
    settings?.enabled && lastRunAt
      ? new Date(Date.parse(lastRunAt) + ROBOT_INTERVAL_MS).toISOString()
      : "";
  const config = telegramConfig(env, settings);
  const notes = [];
  if (!env.EXA_API_KEY) {
    notes.push(
      "Pencarian lintas web (LinkedIn/direktori publik) belum aktif. Tambahkan EXA_API_KEY untuk memperdalam Finding dan Klarifikasi.",
    );
  }
  if (!config.token) {
    notes.push(
      "Notifikasi Telegram belum aktif. Tambahkan TELEGRAM_BOT_TOKEN sebagai secret Worker.",
    );
  }
  if (!config.chatId) {
    notes.push(
      "Chat ID Telegram belum diatur. Tambahkan TELEGRAM_CHAT_ID atau simpan chat ID lewat panel robot.",
    );
  }
  if (outbox.attention > 0) {
    notes.push(
      `${outbox.failed} pesan gagal, ${outbox.uncertain} tidak pasti, dan ${outbox.needsReview} perlu dicek. Pesan gagal dicoba ulang otomatis; pesan yang macet dapat dikirim ulang dari panel robot.`,
    );
  }
  if (!opensanctionsConfigured(env)) {
    notes.push(
      "OpenSanctions belum aktif. Tambahkan OPENSANCTIONS_API_KEY di Sites → Secrets; robot tetap berjalan dan tidak memblokir lead sampai secret tersedia.",
    );
  } else if (screeningStats.pendingReview > 0) {
    notes.push(
      `${screeningStats.pendingReview} lead menunggu konfirmasi review OpenSanctions sebelum Publish. Buka detail lead di Robot AI untuk mengonfirmasi.`,
    );
  }
  notes.push(
    "Scheduler 24/7 memakai GitHub Actions OIDC; tidak perlu repository secret tambahan.",
  );
  notes.push(
    "Struktur 11 agen: 3 Finding (Profil Entitas, Sinyal Publik, Penilai Kebutuhan), 5 Klarifikasi (Scout, Contact Finder, Verifier, OpenOSINT, OpenSanctions), 3 Publish (Kurir Telegram, Agen WhatsApp, Penulis Prospek).",
  );
  notes.push(
    "Klarifikasi memakai Exa Answer, OpenOSINT native untuk DNS/DNS-over-HTTPS dan RDAP domain, serta OpenSanctions untuk screening nama perusahaan/PIC terhadap sanksi, debarment, dan PEP; Finding memakai website publik gratis dan Exa Search. Tidak ada provider WormGPT/FraudGPT/GhostGPT/HackerGPT/Hexstrike.",
  );
  notes.push(
    "Publish dipisah menjadi tiga pekerjaan: publish_telegram mengirim pesan, agen WhatsApp masih berupa draft yang belum membalas otomatis, dan publish_prospect menulis daftar Prospek. Telegram dikirim satu kali setelah Klarifikasi menerima lead.",
  );
  notes.push(
    "Draft agen WhatsApp hanya menyimpan balasan dengan status draft. Pengiriman template dan balasan otomatis belum diaktifkan sampai gateway, nomor, template, dan penyedia AI ditentukan.",
  );
  notes.push(
    "Telegram mewajibkan nama PIC yang lolos gate (bukan resepsionis/customer service, bukan placeholder, bukan beberapa nama), peran yang bukan resepsionis/customer service, dan minimal satu nomor PIC valid. Sampai dua nomor (kontak perusahaan dan nomor PIC) ditampilkan pada baris Nomor PIC. E-mail atau website yang kosong memakai placeholder; koordinat selalu diisi dari titik entitas atau pusat wilayah lead. Pesan tetap tujuh baris.",
    "Penulis Prospek memakai syarat yang sama dengan Kurir Telegram: lead yang sudah terkirim langsung ditambahkan ke Prospek meski e-mail atau website belum tersedia.",
  );

  return {
    enabled: true,
    autoPublish: true,
    telegramConfigured: config.configured,
    telegramTokenSet: Boolean(config.token),
    telegramChatIdSet: Boolean(config.chatId),
    telegramTarget: config.target,
    whatsappConfigured: whatsappOutreachConfigured(env),
    whatsappOutbox,
    exaConfigured: Boolean(env.EXA_API_KEY),
    openosintConfigured: openosintConfigured(env),
    opensanctionsConfigured: opensanctionsConfigured(env),
    screeningStats,
    agents: agentStructure(env, config.configured),
    cronConfigured: true,
    lastRunAt,
    nextRunAt,
    lastRun: lastRun
      ? {
          checked: Number(lastRun.checked || 0),
          found: Number(lastRun.found || 0),
          published: Number(lastRun.published || 0),
          notified: Number(lastRun.notified || 0),
          error: lastRun.error || "",
        }
      : null,
    stats,
    outbox,
    prospectSync,
    prospectHistory,
    jobs,
    notes,
  };
}

export async function detectTelegramChat(db, env, ownerId) {
  await ensureRobotSchema(db);
  const token = clean(env?.TELEGRAM_BOT_TOKEN);
  if (!token) {
    return {
      ok: false,
      message: "TELEGRAM_BOT_TOKEN belum diatur. Buat bot di BotFather lalu simpan tokennya di Sites → Secrets.",
    };
  }
  const current = await getSettings(db, ownerId);
  if (current?.telegram_chat_id) {
    return {
      ok: true,
      chatId: current.telegram_chat_id,
      message: `Chat ID ${current.telegram_chat_id} sudah tersimpan; webhook AI Leader aktif.`,
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=20&timeout=0`,
      { signal: AbortSignal.timeout(12_000) },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      const description =
        typeof body?.description === "string" ? body.description.trim() : "";
      return {
        ok: false,
        message: description
          ? `Telegram menolak permintaan: ${description}`
          : "Bot token belum valid atau Telegram menolak permintaan.",
      };
    }

    let chat = null;
    for (const update of Array.isArray(body?.result) ? body.result : []) {
      const message = update?.message || update?.edited_message;
      const candidate = message?.chat;
      if (candidate && candidate.type === "private" && candidate.id) {
        chat = candidate;
      }
    }
    if (!chat) {
      return {
        ok: false,
        message:
          "Belum ada pesan. Buka bot Anda di Telegram, tekan Start atau kirim /start, lalu coba Deteksi lagi.",
      };
    }

    const chatId = String(chat.id);
    const current = await getSettings(db, ownerId);
    await updateRobotSettings(db, ownerId, {
      enabled: Boolean(current?.enabled),
      telegramChatId: chatId,
    });
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    return {
      ok: true,
      chatId,
      message: `Chat ID ${chatId}${name ? ` (${name})` : ""} tersimpan.`,
    };
  } catch (error) {
    console.error(
      "corporate_robot_telegram_detect_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, message: "Telegram tidak dapat dihubungi. Coba lagi." };
  }
}

export async function sendTestTelegram(db, env, ownerId) {
  await ensureRobotSchema(db);
  const settings = await getSettings(db, ownerId);
  const result = await sendTelegram(
    env,
    settings,
    `<b>Robot Corporate Engine aktif</b>\n\nTes koneksi berhasil. Target notifikasi: ${escapeHtml(
      clean(env?.TELEGRAM_TARGET_PHONE) || DEFAULT_TELEGRAM_PHONE,
    )}.`,
  );
  return {
    ok: result.ok,
    message: result.ok
      ? "Tes Telegram terkirim."
      : result.error || "Telegram belum dapat digunakan.",
  };
}

/**
 * Intake kandidat nyata ke antrean Corporate Engine. Identitas dan website
 * wajib; PIC/koordinat boleh dikirim sebagai petunjuk yang sudah dibaca dari
 * sumber publik. Riset tetap memverifikasi ulang nama, nomor, dan titik
 * sebelum lead boleh dipublikasikan.
 */
export async function addRobotCandidates(db, candidates = []) {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);
  const now = nowIso();
  const ids = [];
  const rejected = [];
  for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 12) : []) {
    const name = clean(candidate?.name);
    const city = clean(candidate?.city);
    const website = clean(candidate?.website);
    const category = clean(candidate?.category).toLowerCase();
    if (
      !name ||
      !city ||
      !["company", "school", "hotel"].includes(category) ||
      !/^https?:\/\//i.test(website)
    ) {
      rejected.push(name || "(tanpa nama)");
      continue;
    }
    const slug = `${name}-${city}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    const id = `manual:${slug}`;
    const phone = clean(candidate?.phone);
    const contactName = sanitizePicName(candidate?.contactName);
    const contactRole = clean(candidate?.contactRole);
    const contactUrl = clean(candidate?.contactUrl);
    const coordinateSource = clean(candidate?.coordinateSource);
    const latitude = Number(candidate?.latitude);
    const longitude = Number(candidate?.longitude);
    const hasCoordinate =
      coordinateSource !== "" &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180;
    await db
      .prepare(
        `INSERT INTO corporate_leads
          (id, name, city, area, category, email, phone, website,
           contact_name, contact_role, contact_url, latitude, longitude,
           coordinate_address, coordinate_source, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           city = excluded.city,
           area = CASE WHEN corporate_leads.area = '' THEN excluded.area ELSE corporate_leads.area END,
           category = excluded.category,
           website = excluded.website,
           phone = CASE WHEN excluded.phone = '' THEN corporate_leads.phone ELSE excluded.phone END,
           contact_name = CASE WHEN excluded.contact_name = '' THEN corporate_leads.contact_name ELSE excluded.contact_name END,
           contact_role = CASE WHEN excluded.contact_role = '' THEN corporate_leads.contact_role ELSE excluded.contact_role END,
           contact_url = CASE WHEN excluded.contact_url = '' THEN corporate_leads.contact_url ELSE excluded.contact_url END,
           latitude = CASE WHEN excluded.coordinate_source = '' THEN corporate_leads.latitude ELSE excluded.latitude END,
           longitude = CASE WHEN excluded.coordinate_source = '' THEN corporate_leads.longitude ELSE excluded.longitude END,
           coordinate_address = CASE WHEN excluded.coordinate_source = '' THEN corporate_leads.coordinate_address ELSE excluded.coordinate_address END,
           coordinate_source = CASE WHEN excluded.coordinate_source = '' THEN corporate_leads.coordinate_source ELSE excluded.coordinate_source END,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        name,
        city,
        clean(candidate?.area),
        category,
        phone,
        website,
        contactName,
        contactRole,
        contactUrl,
        hasCoordinate ? latitude : 0,
        hasCoordinate ? longitude : 0,
        clean(candidate?.coordinateAddress),
        hasCoordinate ? coordinateSource : "",
        now,
      )
      .run();
    ids.push(id);
  }
  return { ok: ids.length > 0, ids, rejected };
}

/**
 * Menjalankan satu batch. Satu lead diproses melewati finding, klarifikasi,
 * dan publish sekaligus agar hasilnya langsung terlihat. `limit` membatasi
 * jumlah lead, bukan jumlah stage.
 */
export async function runCorporateRobot(db, env = {}, options = {}) {
  await ensureCorporateSchema(db);
  await ensureRobotSchema(db);

  await ensureCronOwner(db);
  let settings = await getSettings(db, options.ownerId || "");
  if (!settings) settings = await ensureCronOwner(db);
  if (settings && (!settings.enabled || !settings.auto_publish)) {
    settings = await updateRobotSettings(db, settings.owner_id, {
      enabled: true,
      autoPublish: true,
    });
  }
  const ownerId = options.ownerId || settings?.owner_id || "";
  const force = Boolean(options.force);

  if (!force && !settings?.enabled) {
    return {
      skipped: true,
      reason: "Robot sedang dijeda.",
      checked: 0,
      found: 0,
      published: 0,
      prospectAdded: 0,
      notified: 0,
      remaining: 0,
      updated: [],
      status: await getRobotStatus(db, env, ownerId),
    };
  }

  const lock = await readMeta(db, "robot_running_at");
  if (lock) {
    const age = Date.now() - Date.parse(lock);
    if (Number.isFinite(age) && age >= 0 && age < ROBOT_LOCK_MS) {
      return {
        skipped: true,
        reason: "Robot sedang berjalan.",
        checked: 0,
        found: 0,
        published: 0,
        prospectAdded: 0,
        notified: 0,
        remaining: 0,
        updated: [],
        status: await getRobotStatus(db, env, ownerId),
      };
    }
  }

  // Tick tanpa antrean tidak perlu menulis baris run, meta, atau skema.
  // Pemeliharaan (perbaikan koordinat, screening, rekonsiliasi Prospek) tetap
  // berjalan, tetapi cukup sekali sejam agar kuota punya sisa aman.
  const requestedLeadIds = (Array.isArray(options.leadIds) ? options.leadIds : [])
    .map((id) => clean(String(id || "")))
    .filter(Boolean)
    .slice(0, 12);
  let maintenanceOnly = false;
  if (requestedLeadIds.length === 0) {
    const due = await robotDueWorkCounts(db, env);
    if (due.jobs + due.outbox + due.screening === 0) {
      const lastMaintenance = await readMeta(db, "robot_last_maintenance");
      const age = lastMaintenance ? Date.now() - Date.parse(lastMaintenance) : NaN;
      if (Number.isFinite(age) && age >= 0 && age < ROBOT_MAINTENANCE_MS) {
        return {
          skipped: true,
          reason: "Tidak ada antrean jatuh tempo; pemeliharaan berikutnya dalam 1 jam.",
          checked: 0,
          found: 0,
          published: 0,
          prospectAdded: 0,
          notified: 0,
          whatsappSent: 0,
          remaining: 0,
          updated: [],
          status: await getRobotStatus(db, env, ownerId),
        };
      }
      maintenanceOnly = true;
    }
  }

  const startedAt = nowIso();
  const runId = crypto.randomUUID();
  await writeMeta(db, "robot_running_at", startedAt);
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 2));
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 4));
  let checked = 0;
  let found = 0;
  let published = 0;
  let prospectAdded = 0;
  let notified = 0;
  let whatsappSent = 0;
  let lastError = "";
  let prospectSync = null;
  let coordinateRepair = null;
  let screeningBackfill = null;
  const updated = [];

  try {
    // Kurir Telegram menjalankan pesan yang sudah siap sebelum antrean baru
    // diproses. Ini terjadi di dalam lock robot, jadi tidak ada dua proses
    // yang berlomba mengirim lead yang sama. Pesan tetap terkirim tanpa
    // membuka aplikasi selama cron berjalan.
    const preflight = await notifyPending(
      db,
      env,
      settings,
      TELEGRAM_BATCH_LIMIT,
    ).catch((error) => {
      console.error(
        "corporate_robot_telegram_preflight_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return { checked: 0, sent: 0 };
    });
    notified += preflight.sent;
    const whatsappPreflight = await notifyPendingWhatsApp(
      db,
      env,
      settings,
      TELEGRAM_BATCH_LIMIT,
    ).catch((error) => {
      console.error(
        "corporate_robot_whatsapp_preflight_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return { checked: 0, sent: 0 };
    });
    whatsappSent += whatsappPreflight.sent;

    await ensureJobs(db);
    // Perbaiki titik pusat wilayah yang tersisa secara bertahap. Ini tidak
    // memakai panel AI dan tidak mengubah status validasi lead.
    coordinateRepair = await repairCorporateCoordinates(db, 10).catch((error) => {
      console.error(
        "corporate_robot_coordinate_repair_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    prospectSync = await reconcileTelegramProspects(db, ownerId).catch((error) => {
      console.error(
        "corporate_robot_prospect_reconcile_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    const selectedLeadIds = (Array.isArray(options.leadIds) ? options.leadIds : [])
      .map((id) => clean(String(id || "")))
      .filter(Boolean)
      .slice(0, 12);
    // Bila lead dipilih eksplisit, hanya lead itu yang diproses, tanpa
    // mencampurnya dengan antrean jatuh tempo lain. Ini membuat retrigger
    // manual deterministik untuk audit dan demo tiga vertical.
    // Satu lead per invokasi: riset memakai banyak subrequest (Exa, website,
    // DNS, OpenSanctions). Memproses beberapa lead sekaligus membuat Cloudflare
    // menghentikan lead berikutnya dengan "Too many subrequests".
    const effectiveLimit = selectedLeadIds.length > 0 ? 1 : limit;
    if (selectedLeadIds.length > 0 && options.restartSelected) {
      const now = nowIso();
      await db
        .prepare(
          `UPDATE corporate_robot_jobs
           SET stage = 'finding', status = 'queued', need_score = 0,
               need_label = '', need_evidence = '[]', contact_status = 'pending',
               contact_confidence = 0, contact_evidence = '[]', attempts = 0,
               last_error = '', next_run_at = ?, updated_at = ?
           WHERE lead_id IN (${selectedLeadIds.map(() => "?").join(", ")})`,
        )
        .bind(now, now, ...selectedLeadIds)
        .run();
    } else if (selectedLeadIds.length > 0 && options.resendSelected) {
      const now = nowIso();
      await db
        .prepare(
          `UPDATE corporate_robot_jobs
           SET stage = 'clarification', status = 'queued', attempts = 0,
               last_error = '', telegram_sent_at = '', published_at = '',
               next_run_at = ?, updated_at = ?
           WHERE lead_id IN (${selectedLeadIds.map(() => "?").join(", ")})`,
        )
        .bind(now, now, ...selectedLeadIds)
        .run();
      // Outbox idempoten menyimpan status sent. Untuk resend yang diminta
      // eksplisit, buka kembali baris lead yang dipilih agar pesan baru bisa
      // dikirim tanpa menghapus riwayat outbox.
      await db
        .prepare(
          `UPDATE corporate_telegram_outbox
           SET status = 'pending', sent_at = '', telegram_message_id = '',
               claimed_at = '', next_attempt_at = '', last_error = '', updated_at = ?
           WHERE lead_id IN (${selectedLeadIds.map(() => "?").join(", ")})`,
        )
        .bind(now, ...selectedLeadIds)
        .run();
    }
    const selectedClause =
      selectedLeadIds.length > 0
        ? `j.lead_id IN (${selectedLeadIds.map(() => "?").join(", ")})`
        : "j.next_run_at <= ?";
    const rows = await db
      .prepare(
        `${JOB_SELECT}
         WHERE ${selectedClause}
           AND j.stage IN ('finding', 'clarification', 'publish', 'publish_telegram', 'publish_prospect')
         ORDER BY
           CASE j.stage
             WHEN 'publish' THEN 0
             WHEN 'publish_telegram' THEN 0
             WHEN 'publish_prospect' THEN 1
             WHEN 'clarification' THEN 2
             ELSE 3
           END,
           j.need_score DESC,
           j.updated_at ASC
         LIMIT ?`,
      )
      .bind(
        ...(selectedLeadIds.length > 0 ? selectedLeadIds : [nowIso()]),
        effectiveLimit,
      )
      .all();

    const processRow = async (row) => {
      checked += 1;
      try {
        const result = await advanceJob(db, row, env, settings, ownerId);
        found += result.found ? 1 : 0;
        published += result.published;
        prospectAdded += result.prospectAdded;
        notified += result.notified;
        if (result.job) updated.push(result.job);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Kesalahan robot.";
        console.error("corporate_robot_job_error", lastError);
        await updateJob(db, row.lead_id, {
          attempts: Number(row.attempts || 0) + 1,
          last_error: "Robot gagal memproses lead ini. Akan dicoba lagi.",
          next_run_at: addHours(1),
        }).catch(() => undefined);
        const job = await readJob(db, row.lead_id).catch(() => null);
        if (job) updated.push(job);
      }
    };

    // Beberapa lead diproses paralel. Pekerjaan AI tetap dibatasi 3-4 lead agar
    // tidak membanjiri penyedia riset sekaligus.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, (rows.results ?? []).length) },
      async () => {
        while (cursor < (rows.results ?? []).length) {
          const index = cursor;
          cursor += 1;
          await processRow((rows.results ?? [])[index]);
        }
      },
    );
    await Promise.all(workers);

    const pending = await notifyPending(
      db,
      env,
      settings,
      TELEGRAM_BATCH_LIMIT,
    );
    notified += pending.sent;
    const whatsappPending = await notifyPendingWhatsApp(
      db,
      env,
      settings,
      TELEGRAM_BATCH_LIMIT,
    ).catch((error) => {
      console.error(
        "corporate_robot_whatsapp_pending_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return { checked: 0, sent: 0 };
    });
    whatsappSent += whatsappPending.sent;

    // Backfill screening berjalan setelah antrean utama selesai, sehingga
    // lead lama tidak memperlambat atau memblokir pekerjaan robot baru.
    screeningBackfill = await backfillCorporateScreening(db, env, 3).catch(
      (error) => {
        console.error(
          "corporate_robot_screening_backfill_error",
          error instanceof Error ? error.message : "unknown error",
        );
        return null;
      },
    );

    const finishedAt = nowIso();
    await db
      .prepare(
        `INSERT INTO corporate_robot_runs
          (id, started_at, finished_at, checked, found, published, notified, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(runId, startedAt, finishedAt, checked, found, published, notified, lastError)
      .run();
    await writeMeta(db, "robot_last_run", finishedAt);
    if (maintenanceOnly) {
      await writeMeta(db, "robot_last_maintenance", finishedAt).catch(() => undefined);
    }

    const remainingRow = await db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM corporate_robot_jobs j
         JOIN corporate_leads l ON l.id = j.lead_id
         WHERE j.stage IN ('finding', 'clarification', 'publish', 'publish_telegram', 'publish_prospect')`,
      )
      .first();

    return {
      skipped: false,
      runId,
      checked,
      found,
      published,
      prospectAdded,
      notified,
      whatsappSent,
      remaining: Number(remainingRow?.total || 0),
      error: lastError,
      prospectSync,
      coordinateRepair,
      screeningBackfill,
      updated,
      status: await getRobotStatus(db, env, ownerId),
    };
  } finally {
    await writeMeta(db, "robot_running_at", "").catch(() => undefined);
  }
}

/** Dipanggil dari request GET agar pekerjaan berlanjut saat aplikasi dibuka. */
export async function maybeRunCorporateRobot(db, env = {}) {
  if (!db) return null;
  try {
    await ensureCorporateSchema(db);
    await ensureRobotSchema(db);
    let settings = await getSettings(db);
    if (!settings) settings = await ensureCronOwner(db);
    if (!settings?.enabled) return null;
    const last = await readMeta(db, "robot_last_run");
    if (last) {
      const age = Date.now() - Date.parse(last);
      if (Number.isFinite(age) && age >= 0 && age < ROBOT_INTERVAL_MS) return null;
    }
    return await runCorporateRobot(db, env, {
      ownerId: settings.owner_id,
      limit: 1,
      source: "heartbeat",
    });
  } catch (error) {
    console.error(
      "corporate_robot_heartbeat_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}
