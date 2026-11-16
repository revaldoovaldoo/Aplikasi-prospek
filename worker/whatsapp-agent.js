/**
 * Draft logic for the future WhatsApp sales agent.
 *
 * This module deliberately does NOT send messages and is NOT connected to the
 * WhatsApp webhook yet. It only defines conversation state, requirement
 * discovery, guardrails, and the handoff summary. Activation waits until the
 * gateway, sender number, approved template, and AI provider are decided.
 *
 * Guardrails:
 * - never quotes a price, discount, SLA, or contract term;
 * - never promises availability;
 * - stops after an opt-out request;
 * - hands off to the owner when the client asks for price/human/contract,
 *   complains, or confirms the requirement summary.
 */

const schemaDatabases = new WeakSet();

const CONVERSATION_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_agent_conversations (
  wa_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'new',
  requirements TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  last_inbound_at TEXT NOT NULL DEFAULT '',
  last_outbound_at TEXT NOT NULL DEFAULT '',
  follow_up_at TEXT NOT NULL DEFAULT '',
  handoff_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const MESSAGE_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_agent_messages (
  id TEXT PRIMARY KEY,
  wa_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
)`;

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS whatsapp_agent_messages_wa
  ON whatsapp_agent_messages (wa_id, created_at)`;

export async function ensureWhatsAppAgentSchema(db) {
  if (!db || schemaDatabases.has(db)) return;
  await db.prepare(CONVERSATION_SQL).run();
  await db.prepare(MESSAGE_SQL).run();
  await db.prepare(INDEX_SQL).run();
  schemaDatabases.add(db);
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function nowIso() {
  return new Date().toISOString();
}

const EMPTY_REQUIREMENTS = {
  internet: false,
  upgrade: false,
  devices: false,
  dataCenter: false,
  server: false,
  quota: "",
  timeline: "",
  location: "",
};

export function emptyRequirements() {
  return { ...EMPTY_REQUIREMENTS };
}

function parseRequirements(text, current = {}) {
  const value = clean(text);
  const requirements = { ...EMPTY_REQUIREMENTS, ...(current || {}) };
  if (/\b(?:internet|wifi|wi-fi|jaringan|bandwidth|kuota|provider|isp)\b/i.test(value)) {
    requirements.internet = true;
  }
  if (/\b(?:upgrade|tingkatkan|tambah|lemot|lambat|kurang cepat|percepat)\b/i.test(value)) {
    requirements.upgrade = true;
  }
  if (
    /\b(?:perangkat|router|akses poin|access point|switch|kabel|mikrotik|cctv)\b/i.test(
      value,
    )
  ) {
    requirements.devices = true;
  }
  if (/\b(?:data\s*center|data center|ruang server|server room|rak server)\b/i.test(value)) {
    requirements.dataCenter = true;
  }
  if (/\b(?:server|backup|virtual|cloud|hosting)\b/i.test(value)) {
    requirements.server = true;
  }
  const quota = value.match(/\b(\d{1,4})\s*(mbps|gb|tb|giga|mega)\b/i);
  if (quota) requirements.quota = `${quota[1]} ${quota[2]}`;
  const location = value.match(/\b(?:di|area|lokasi)\s+([A-Za-z][A-Za-z .-]{2,40})$/i);
  if (location) requirements.location = clean(location[1]).slice(0, 60);
  if (/\b(?:segera|minggu ini|bulan ini|tahun ini|rencana|secepatnya)\b/i.test(value)) {
    requirements.timeline = value.slice(0, 100);
  }
  return requirements;
}

function hasAnyRequirement(requirements) {
  return Boolean(
    requirements.internet ||
      requirements.upgrade ||
      requirements.devices ||
      requirements.dataCenter ||
      requirements.server,
  );
}

function requirementSummary(requirements) {
  const parts = [];
  if (requirements.internet) parts.push("internet/jaringan");
  if (requirements.upgrade) parts.push("upgrade bandwidth/jaringan");
  if (requirements.devices) parts.push("perangkat pendukung internet");
  if (requirements.dataCenter) parts.push("Data Center");
  if (requirements.server) parts.push("server");
  if (requirements.quota) parts.push(`kebutuhan ${requirements.quota}`);
  if (requirements.timeline) parts.push(`waktu: ${requirements.timeline}`);
  if (requirements.location) parts.push(`lokasi: ${requirements.location}`);
  return parts.length > 0 ? parts.join(", ") : "kebutuhan layanan yang akan didiskusikan";
}

function nextQuestion(requirements) {
  if (!hasAnyRequirement(requirements)) {
    return "Kebutuhan mana yang ingin Bapak/Ibu diskusikan: internet/upgrade jaringan, perangkat pendukung, Data Center, atau server?";
  }
  if (requirements.internet && !requirements.quota) {
    return "Berapa perkiraan kapasitas atau kuota internet yang dibutuhkan saat ini?";
  }
  if (!requirements.devices && !requirements.dataCenter && !requirements.server) {
    return "Apakah Bapak/Ibu juga membutuhkan perangkat jaringan, Data Center, atau server?";
  }
  return "";
}

function handoff(reason, requirements, extra = {}) {
  return {
    reason,
    summary: requirementSummary(requirements),
    ...extra,
  };
}

function greeting(lead) {
  const name = clean(lead?.contactName);
  const company = clean(lead?.companyName || lead?.name);
  return `${name ? `Bapak/Ibu ${name}` : "Bapak/Ibu"}${company ? ` dari ${company}` : ""}`;
}

export function draftWhatsAppReply(input = {}) {
  const text = clean(input.text);
  const lead = input.lead || {};
  const state = clean(input.state) || "new";
  const requirements = parseRequirements(text, input.requirements);
  const greetingName = greeting(lead);
  const pricePattern =
    /\b(?:harga|biaya|tarif|penawaran|diskon|nego|kontrak|invoice|tagihan|sla|garansi)\b/i;
  const humanPattern =
    /\b(?:manusia|orang|tim|sales|salesnya|hubungi saya|telepon|ditelepon|bertemu|meeting|jadwal)\b/i;
  const optOutPattern = /\b(?:stop|berhenti|jangan hubungi|unsubscribe|cabut)\b/i;
  const confirmPattern = /^(?:ya|iya|betul|benar|setuju|boleh|ok|oke|silakan|lanjut)\b/i;
  const rejectPattern = /^(?:tidak|belum|bukan|jangan dulu)\b/i;

  if (optOutPattern.test(text)) {
    return {
      state: "closed",
      reply:
        "Baik, saya tidak akan mengirim pesan lanjutan. Terima kasih atas waktunya.",
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (state === "closed") {
    return {
      state: "closed",
      reply: "",
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (state === "handoff") {
    return {
      state: "handoff",
      reply:
        "Percakapan ini sudah saya teruskan ke tim ASNET. Untuk penawaran dan diskusi lanjutan, Bapak/Ibu akan dihubungi dari nomor WhatsApp pribadi kami.",
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (pricePattern.test(text)) {
    return {
      state: "handoff",
      reply:
        `Baik, ${greetingName}. Untuk harga, paket, dan penawaran resmi, saya teruskan ke tim ASNET. Bapak/Ibu akan dihubungi dari nomor WhatsApp pribadi kami untuk diskusi lanjutan.`,
      requirements,
      handoff: handoff("price_or_contract", requirements),
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (humanPattern.test(text)) {
    return {
      state: "handoff",
      reply:
        `Baik, ${greetingName}. Saya teruskan percakapan ini ke tim ASNET agar bisa berdiskusi langsung dengan Bapak/Ibu.`,
      requirements,
      handoff: handoff("requested_human", requirements),
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (state === "summary" && confirmPattern.test(text)) {
    return {
      state: "handoff",
      reply:
        `Baik, ${greetingName}. Ringkasan kebutuhan sudah saya teruskan ke tim ASNET. Bapak/Ibu akan dihubungi dari nomor WhatsApp pribadi kami untuk penawaran dan jadwal diskusi.`,
      requirements,
      handoff: handoff("confirmed_summary", requirements),
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (state === "summary" && rejectPattern.test(text)) {
    return {
      state: "discovery",
      reply: `Baik, ${greetingName}. Bagian mana yang perlu saya perbaiki atau tambahkan?`,
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  if (state === "new") {
    return {
      state: "discovery",
      reply:
        `Halo ${greetingName}, saya asisten digital ASNET. Kami membantu kebutuhan internet, upgrade jaringan/perangkat, serta pembangunan dan perawatan Data Center atau server. ${nextQuestion(requirements)}`,
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  const question = nextQuestion(requirements);
  if (!question) {
    return {
      state: "summary",
      reply:
        `Baik, ${greetingName}. Ringkasan kebutuhan Bapak/Ibu: ${requirementSummary(requirements)}. Apakah sudah sesuai? Jika ya, saya teruskan ke tim ASNET untuk diskusi jadwal dan penawaran.`,
      requirements,
      handoff: null,
      followUpAt: "",
      draftOnly: true,
    };
  }

  return {
    state: "discovery",
    reply: `Baik, ${greetingName}. ${question}`,
    requirements,
    handoff: null,
    followUpAt: "",
    draftOnly: true,
  };
}

export async function loadDraftConversation(db, waId) {
  await ensureWhatsAppAgentSchema(db);
  return db
    .prepare("SELECT * FROM whatsapp_agent_conversations WHERE wa_id = ?")
    .bind(clean(waId))
    .first();
}

/**
 * Rekam satu giliran percakapan sebagai draft. Fungsi ini tidak memanggil
 * WhatsApp API; balasan hanya disimpan dengan status `draft` sampai agen
 * diaktifkan.
 */
export async function recordDraftTurn(db, input = {}) {
  const waId = clean(input.waId);
  if (!waId) return { ok: false, error: "wa_id kosong." };
  await ensureWhatsAppAgentSchema(db);
  const previous = await loadDraftConversation(db, waId);
  const result = draftWhatsAppReply({
    text: input.text,
    lead: input.lead || {
      companyName: previous?.company_name,
      contactName: previous?.contact_name,
    },
    state: previous?.state || "new",
    requirements: previous ? safeJson(previous.requirements) : emptyRequirements(),
  });
  const now = nowIso();
  const lead = input.lead || {};
  const handoffAt = result.handoff ? now : previous?.handoff_at || "";
  const followUpAt =
    result.reply && !["handoff", "closed"].includes(result.state)
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : "";
  await db
    .prepare(
      `INSERT INTO whatsapp_agent_messages
        (id, wa_id, direction, body, status, created_at)
       VALUES (?, ?, 'inbound', ?, 'received', ?)`,
    )
    .bind(crypto.randomUUID(), waId, clean(input.text).slice(0, 4000), now)
    .run();
  if (result.reply) {
    await db
      .prepare(
        `INSERT INTO whatsapp_agent_messages
          (id, wa_id, direction, body, status, created_at)
         VALUES (?, ?, 'outbound', ?, 'draft', ?)`,
      )
      .bind(crypto.randomUUID(), waId, result.reply.slice(0, 4000), now)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO whatsapp_agent_conversations
        (wa_id, owner_id, lead_id, company_name, contact_name, state,
         requirements, summary, last_inbound_at, last_outbound_at, follow_up_at,
         handoff_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wa_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         lead_id = excluded.lead_id,
         company_name = excluded.company_name,
         contact_name = excluded.contact_name,
         state = excluded.state,
         requirements = excluded.requirements,
         summary = excluded.summary,
         last_inbound_at = excluded.last_inbound_at,
         last_outbound_at = excluded.last_outbound_at,
         follow_up_at = excluded.follow_up_at,
         handoff_at = excluded.handoff_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      waId,
      clean(input.ownerId),
      clean(lead.id || lead.leadId || previous?.lead_id),
      clean(lead.companyName || lead.name || previous?.company_name),
      clean(lead.contactName || previous?.contact_name),
      result.state,
      JSON.stringify(result.requirements),
      result.handoff?.summary || previous?.summary || "",
      now,
      result.reply ? now : previous?.last_outbound_at || "",
      followUpAt,
      handoffAt,
      previous?.created_at || now,
      now,
    )
    .run();
  return { ok: true, ...result, followUpAt, handoff: result.handoff };
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
