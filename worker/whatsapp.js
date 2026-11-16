/**
 * WhatsApp Cloud API: penerimaan webhook dan pengiriman dokumen.
 *
 * Pengiriman otomatis hanya diizinkan bila PIC sudah mengirim pesan ke nomor
 * bisnis dalam 24 jam terakhir. Di luar jendela itu, pesan harus dimulai
 * manual atau memakai template berbayar; modul ini tidak mengirim cold
 * outreach.
 */

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_API_VERSION = "v23.0";
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const schemaDatabases = new WeakSet();

const CONTACT_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  wa_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  last_inbound_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const MESSAGE_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT '',
  wa_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
)`;

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export async function ensureWhatsAppSchema(db) {
  if (!db || schemaDatabases.has(db)) return;
  await db.prepare(CONTACT_SQL).run();
  await db.prepare(MESSAGE_SQL).run();
  schemaDatabases.add(db);
}

function toWaId(digits) {
  if (digits.startsWith("620")) return `62${digits.slice(3)}`;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/** Ubah satu nomor PIC menjadi wa_id Cloud API (62...). */
export function normalizeWaId(input) {
  const candidates = String(input || "")
    .split(/[;\/|,\r\n]+/)
    .map((part) => part.replace(/\D/g, ""))
    .filter(Boolean)
    .map(toWaId)
    .filter(isValidWaId);
  return candidates.find((number) => number.startsWith("628")) ?? candidates[0] ?? "";
}

export function isValidWaId(value) {
  return /^62\d{8,13}$/.test(value);
}

function apiVersion(env) {
  const configured = clean(env?.WHATSAPP_API_VERSION);
  return /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_API_VERSION;
}

function apiUrl(env, path) {
  const phoneId = encodeURIComponent(clean(env?.WHATSAPP_PHONE_NUMBER_ID));
  return `https://graph.facebook.com/${apiVersion(env)}/${phoneId}${path}`;
}

function whatsappConfigured(env) {
  return Boolean(
    clean(env?.WHATSAPP_ACCESS_TOKEN) && clean(env?.WHATSAPP_PHONE_NUMBER_ID),
  );
}

function webhookConfigured(env) {
  return Boolean(
    clean(env?.WHATSAPP_APP_SECRET) && clean(env?.WHATSAPP_VERIFY_TOKEN),
  );
}

function safeFilename(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 160) || "Penawaran.pdf";
}

function timestampIso(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    const date = new Date(seconds * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Verifikasi X-Hub-Signature-256 dari Meta. */
export async function verifyWebhookSignature(appSecret, rawBody, header) {
  const secret = clean(appSecret);
  const signature = clean(header).toLowerCase();
  if (!secret || !signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  return constantTimeEqual(hex(digest), signature.slice("sha256=".length));
}

export async function readWhatsAppWindow(db, phone, now = Date.now()) {
  const waId = normalizeWaId(phone);
  if (!isValidWaId(waId)) {
    return {
      configured: false,
      phone: waId,
      open: false,
      lastInboundAt: "",
      expiresAt: "",
    };
  }
  await ensureWhatsAppSchema(db);
  const row = await db
    .prepare("SELECT last_inbound_at FROM whatsapp_contacts WHERE wa_id = ?")
    .bind(waId)
    .first();
  const last = Date.parse(row?.last_inbound_at || "");
  const open = Number.isFinite(last) && now - last >= 0 && now - last < SERVICE_WINDOW_MS;
  return {
    configured: false,
    phone: waId,
    open,
    lastInboundAt: open ? row.last_inbound_at : clean(row?.last_inbound_at),
    expiresAt: Number.isFinite(last)
      ? new Date(last + SERVICE_WINDOW_MS).toISOString()
      : "",
  };
}

async function recordInbound(db, waId, displayName, inboundAt) {
  const now = new Date().toISOString();
  await ensureWhatsAppSchema(db);
  await db
    .prepare(
      `INSERT INTO whatsapp_contacts
         (wa_id, phone, display_name, last_inbound_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wa_id) DO UPDATE SET
         phone = excluded.phone,
         display_name = CASE
           WHEN excluded.display_name = '' THEN whatsapp_contacts.display_name
           ELSE excluded.display_name
         END,
         last_inbound_at = excluded.last_inbound_at,
         updated_at = excluded.updated_at`,
    )
    .bind(waId, `+${waId}`, clean(displayName), inboundAt, now, now)
    .run();
}

async function recordMessage(db, { ownerId = "", waId, direction, messageId = "", status = "", error = "" }) {
  await ensureWhatsAppSchema(db);
  await db
    .prepare(
      `INSERT INTO whatsapp_messages
         (id, owner_id, wa_id, direction, message_id, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      clean(ownerId),
      clean(waId),
      direction,
      clean(messageId),
      clean(status),
      clean(error).slice(0, 500),
      new Date().toISOString(),
    )
    .run();
}

function parseGraphError(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    return clean(
      parsed?.error?.error_user_msg ||
        parsed?.error?.message ||
        parsed?.error?.error_data?.details ||
        "",
    ).slice(0, 500);
  } catch {
    return clean(body).slice(0, 500);
  }
}

export async function getWhatsAppStatus(env, db, phone) {
  if (!db) {
    return {
      configured: whatsappConfigured(env),
      webhookConfigured: webhookConfigured(env),
      phone: normalizeWaId(phone),
      open: false,
      lastInboundAt: "",
      expiresAt: "",
    };
  }
  const window = await readWhatsAppWindow(db, phone);
  return {
    ...window,
    configured: whatsappConfigured(env),
    webhookConfigured: webhookConfigured(env),
  };
}

export async function handleWhatsAppWebhook(db, env, request) {
  if (!db) {
    return new Response("Database belum tersedia", { status: 503 });
  }
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (
      mode === "subscribe" &&
      clean(env.WHATSAPP_VERIFY_TOKEN) &&
      constantTimeEqual(token, clean(env.WHATSAPP_VERIFY_TOKEN))
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!webhookConfigured(env)) {
    return new Response("WhatsApp webhook belum dikonfigurasi", { status: 503 });
  }
  const rawBody = await request.text();
  if (
    !(await verifyWebhookSignature(
      env.WHATSAPP_APP_SECRET,
      rawBody,
      request.headers.get("x-hub-signature-256") || "",
    ))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const names = new Map(
        contacts
          .map((contact) => [clean(contact?.wa_id), clean(contact?.profile?.name)])
          .filter(([waId]) => waId),
      );
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of messages) {
        const waId = normalizeWaId(message?.from);
        if (!isValidWaId(waId)) continue;
        const inboundAt = timestampIso(message?.timestamp);
        await recordInbound(db, waId, names.get(waId) || "", inboundAt);
        await recordMessage(db, {
          waId,
          direction: "inbound",
          messageId: clean(message?.id),
          status: "received",
        }).catch(() => undefined);
      }
    }
  }
  return new Response("EVENT_RECEIVED", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Template resmi untuk pesan pertama ke PIC di luar jendela 24 jam. */
export function whatsappOutreachTemplate(env) {
  const name = clean(env?.WHATSAPP_OUTREACH_TEMPLATE);
  const language = clean(env?.WHATSAPP_OUTREACH_LANGUAGE) || "id";
  return {
    name: /^[a-z0-9_]{1,80}$/i.test(name) ? name : "",
    language: /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language) ? language : "id",
  };
}

export function whatsappOutreachConfigured(env) {
  const template = whatsappOutreachTemplate(env);
  return Boolean(
    clean(env?.WHATSAPP_ACCESS_TOKEN) &&
      clean(env?.WHATSAPP_PHONE_NUMBER_ID) &&
      clean(env?.WHATSAPP_OUTREACH_ENABLED).toLowerCase() === "true" &&
      template.name,
  );
}

/**
 * Kirim template WhatsApp (bukan pesan bebas) untuk kontak pertama. Meta
 * mewajibkan template yang sudah disetujui untuk percakapan di luar 24 jam.
 * Parameter body yang dipakai agen: {{1}} nama PIC, {{2}} nama entitas.
 */
export async function sendWhatsAppTemplate(env, db, input = {}) {
  if (!whatsappOutreachConfigured(env)) {
    return {
      ok: false,
      status: 503,
      error:
        "WhatsApp outreach belum aktif. Isi WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OUTREACH_ENABLED=true, dan WHATSAPP_OUTREACH_TEMPLATE.",
    };
  }
  const waId = normalizeWaId(input.phone);
  if (!isValidWaId(waId)) {
    return { ok: false, status: 400, error: "Nomor WhatsApp PIC tidak valid." };
  }
  const template = whatsappOutreachTemplate(env);
  const parameters = (Array.isArray(input.parameters) ? input.parameters : [])
    .map((value) => clean(String(value || "")).slice(0, 300))
    .filter(Boolean);
  if (parameters.length < 2) {
    return { ok: false, status: 400, error: "Parameter template WhatsApp belum lengkap." };
  }

  let response;
  try {
    response = await fetch(apiUrl(env, "/messages"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components: [
            {
              type: "body",
              parameters: parameters.slice(0, 2).map((text) => ({
                type: "text",
                text,
              })),
            },
          ],
        },
      }),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      uncertain: true,
      error: "WhatsApp tidak dapat dihubungi; status pengiriman belum pasti.",
    };
  }
  const text = await response.text();
  if (!response.ok) {
    const error = parseGraphError(text) || "WhatsApp menolak template outreach.";
    await recordMessage(db, {
      ownerId: input.ownerId,
      waId,
      direction: "outbound",
      status: "failed",
      error,
    }).catch(() => undefined);
    return { ok: false, status: 502, error };
  }
  let messageId = "";
  try {
    messageId = clean(JSON.parse(text)?.messages?.[0]?.id);
  } catch {
    /* ID opsional; pesan tetap dianggap terkirim bila respons sukses. */
  }
  await recordMessage(db, {
    ownerId: input.ownerId,
    waId,
    direction: "outbound",
    messageId,
    status: "sent",
  }).catch(() => undefined);
  return { ok: true, status: 200, messageId, to: waId };
}

export async function sendQuoteWhatsApp(env, db, ownerId, input = {}) {
  if (!whatsappConfigured(env)) {
    return {
      ok: false,
      status: 503,
      error:
        "WhatsApp API belum dikonfigurasi. Tambahkan WHATSAPP_ACCESS_TOKEN dan WHATSAPP_PHONE_NUMBER_ID.",
    };
  }
  if (!db || !env.FILES) {
    return { ok: false, status: 503, error: "Penyimpanan data belum tersedia." };
  }
  const waId = normalizeWaId(input.phone);
  if (!isValidWaId(waId)) {
    return { ok: false, status: 400, error: "Nomor WhatsApp PIC tidak valid." };
  }
  const window = await readWhatsAppWindow(db, waId);
  if (!window.open) {
    return {
      ok: false,
      status: 409,
      windowOpen: false,
      error:
        "PIC belum mengirim pesan ke nomor bisnis dalam 24 jam terakhir. Hubungi PIC secara manual lebih dulu.",
    };
  }

  const fileId = clean(input.fileId);
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) {
    return { ok: false, status: 400, error: "File PDF tidak valid." };
  }
  const fileKey = `${ownerId}/${fileId}.pdf`;
  let object;
  try {
    object = await env.FILES.get(fileKey);
  } catch {
    return { ok: false, status: 502, error: "PDF tidak bisa dibaca." };
  }
  if (!object) {
    return { ok: false, status: 404, error: "PDF penawaran tidak ditemukan." };
  }
  if (Number(object.size) > MAX_DOCUMENT_BYTES) {
    return { ok: false, status: 413, error: "PDF melebihi batas 100 MB." };
  }

  const filename = safeFilename(input.filename || "Penawaran.pdf");
  const caption = String(input.message || "").trim().slice(0, 1024);
  let bytes;
  try {
    bytes = await object.arrayBuffer();
  } catch {
    return { ok: false, status: 502, error: "PDF tidak bisa dibaca." };
  }

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    filename,
  );

  let mediaResponse;
  try {
    mediaResponse = await fetch(apiUrl(env, "/media"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: form,
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Tidak dapat menghubungi WhatsApp. Coba lagi.",
    };
  }
  const mediaText = await mediaResponse.text();
  if (!mediaResponse.ok) {
    const error = parseGraphError(mediaText) || "Upload PDF ke WhatsApp gagal.";
    await recordMessage(db, {
      ownerId,
      waId,
      direction: "outbound",
      status: "failed",
      error,
    }).catch(() => undefined);
    return { ok: false, status: 502, error };
  }
  let mediaId = "";
  try {
    mediaId = clean(JSON.parse(mediaText)?.id);
  } catch {
    return { ok: false, status: 502, error: "Respons upload WhatsApp tidak valid." };
  }
  if (!mediaId) {
    return { ok: false, status: 502, error: "WhatsApp tidak mengembalikan media ID." };
  }

  let sendResponse;
  try {
    sendResponse = await fetch(apiUrl(env, "/messages"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "document",
        document: {
          id: mediaId,
          filename,
          caption,
        },
      }),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "PDF sudah diunggah, tetapi pengiriman WhatsApp gagal. Coba lagi.",
    };
  }
  const sendText = await sendResponse.text();
  if (!sendResponse.ok) {
    const error = parseGraphError(sendText) || "WhatsApp menolak pengiriman PDF.";
    await recordMessage(db, {
      ownerId,
      waId,
      direction: "outbound",
      status: "failed",
      error,
    }).catch(() => undefined);
    return { ok: false, status: 502, error };
  }
  let messageId = "";
  try {
    messageId = clean(JSON.parse(sendText)?.messages?.[0]?.id);
  } catch {
    /* ID opsional; pesan tetap dianggap terkirim bila respons sukses. */
  }
  await recordMessage(db, {
    ownerId,
    waId,
    direction: "outbound",
    messageId,
    status: "sent",
  }).catch(() => undefined);
  return { ok: true, status: 200, messageId, to: waId, windowOpen: true };
}
