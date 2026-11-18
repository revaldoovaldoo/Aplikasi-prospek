import { createFreebuffAuth, isSameOriginRequest } from "@freebuff/auth";
import corporateSeed from "./corporate-seed.json";
import {
  corporateLeadMissing,
  enrichCorporateEmails,
  findCorporateLeadForCompany,
  isCorporateLeadComplete,
  readCorporateLeads,
  refreshCorporateCity,
} from "./corporate.js";
import {
  repairCorporateCoordinates,
  researchCorporateLead,
} from "./research.js";
import { verifyGithubOidc } from "./github-oidc.js";
import {
  ensureTelegramWebhook,
  handleTelegramLeaderWebhook,
} from "./leader.js";
import {
  getWhatsAppStatus,
  handleWhatsAppWebhook,
  sendQuoteWhatsApp,
} from "./whatsapp.js";
import {
  backfillCorporateScreening,
  detectTelegramChat,
  ensureCronOwner,
  getCronHealth,
  getRobotStatus,
  markCronTick,
  maybeRunCorporateRobot,
  retryStuckTelegram,
  reviewCorporateScreening,
  runCorporateRobot,
  sendTestTelegram,
  updateRobotSettings,
} from "./robot.js";

const MAX_PAYLOAD_CHARS = 1_500_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
)`;

let authInstance;
let appHandler;
let schemaPromise;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function getAuth(env) {
  if (!authInstance) {
    if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN) {
      throw new Error("Konfigurasi autentikasi belum lengkap");
    }
    authInstance = createFreebuffAuth({
      clientId: env.FREEBUFF_CLIENT_ID,
      issuer: env.FREEBUFF_ISSUER,
      baseUrl: env.APP_ORIGIN,
      allowInsecureLocalhost: isLoopbackOrigin(env.APP_ORIGIN),
    });
  }
  return authInstance;
}

function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db
      .prepare(TABLE_SQL)
      .run()
      .then(
        () => undefined,
        (error) => {
          schemaPromise = undefined;
          throw error;
        },
      );
  }
  return schemaPromise;
}

async function readRow(db, userId) {
  return db
    .prepare("SELECT payload, revision, updated_at FROM app_state WHERE user_id = ?")
    .bind(userId)
    .first();
}

function parseData(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function isStoredFile(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 120 &&
    typeof value.name === "string" &&
    value.name.length <= 300 &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    typeof value.uploadedAt === "string"
  );
}

function isValidDatabase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { companies, quotes, locations } = value;
  if (!Array.isArray(companies) || !Array.isArray(quotes) || !Array.isArray(locations)) {
    return false;
  }
  if (companies.length > 5000 || quotes.length > 5000 || locations.length > 200) {
    return false;
  }
  if (!locations.every((loc) => typeof loc === "string" && loc.length > 0 && loc.length <= 150)) {
    return false;
  }
  const companiesValid = companies.every(
    (company) =>
      company &&
      typeof company === "object" &&
      typeof company.id === "string" &&
      company.id.length <= 120 &&
      typeof company.name === "string" &&
      company.name.length <= 300 &&
      typeof company.location === "string",
  );
  const quotesValid = quotes.every((quote) => {
    if (!quote || typeof quote !== "object") return false;
    if (typeof quote.id !== "string" || quote.id.length > 120) return false;
    if (typeof quote.companyId !== "string" || quote.companyId.length > 120) return false;
    if (quote.poFile !== undefined && quote.poFile !== null && !isStoredFile(quote.poFile)) {
      return false;
    }
    if (quote.bastFile !== undefined && quote.bastFile !== null && !isStoredFile(quote.bastFile)) {
      return false;
    }
    if (
      quote.bastSignedFile !== undefined &&
      quote.bastSignedFile !== null &&
      !isStoredFile(quote.bastSignedFile)
    ) {
      return false;
    }
    if (
      quote.quoteHistory !== undefined &&
      (!Array.isArray(quote.quoteHistory) ||
        !quote.quoteHistory.every((file) => isStoredFile(file)))
    ) {
      return false;
    }
    if (quote.quoteFile !== undefined && quote.quoteFile !== null) {
      return isStoredFile(quote.quoteFile);
    }
    // Draft lama (sebelum alur upload) masih diterima saat data lama dimuat.
    return Array.isArray(quote.items);
  });
  return companiesValid && quotesValid;
}

function sanitizeFilename(input) {
  const cleaned = String(input || "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return cleaned || "penawaran.pdf";
}

function contentDisposition(name, download = false) {
  const ascii = sanitizeFilename(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const mode = download ? "attachment" : "inline";
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handleFiles(request, env, auth) {
  if (!env.FILES) return json({ error: "Penyimpanan file belum tersedia" }, 500);

  const url = new URL(request.url);

  if (url.pathname === "/api/files") {
    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "private, no-store" },
      });
    }
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
      return json({ error: "Forbidden" }, 403);
    }

    const user = await auth.getUser(request);
    if (!user) return json({ error: "Sign in required" }, 401);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Content-Type harus multipart/form-data" }, 415);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES + 256 * 1024) {
      return json({ error: "Ukuran PDF melebihi batas 15 MB" }, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Form unggahan tidak valid" }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "File PDF belum dipilih" }, 400);
    }
    if (file.size === 0) return json({ error: "File PDF kosong" }, 400);
    if (file.size > MAX_FILE_BYTES) {
      return json({ error: "Ukuran PDF melebihi batas 15 MB" }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf =
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d;
    if (!isPdf) return json({ error: "File harus berupa PDF" }, 415);

    const id = crypto.randomUUID();
    const key = `${user.sub}/${id}.pdf`;
    const name = sanitizeFilename(file.name || "penawaran.pdf");
    const uploadedAt = new Date().toISOString();

    try {
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { name },
      });
    } catch (error) {
      console.error(
        "file_put_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return json({ error: "Gagal menyimpan PDF" }, 500);
    }

    return json(
      { file: { id, name, size: bytes.byteLength, uploadedAt } },
      201,
    );
  }

  const match = /^\/api\/files\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (!match) return json({ error: "Not found" }, 404);
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "DELETE"
  ) {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD, DELETE", "Cache-Control": "private, no-store" },
    });
  }

  if (request.method === "DELETE" && !isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }

  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  const key = `${user.sub}/${match[1]}.pdf`;
  if (request.method === "DELETE") {
    try {
      await env.FILES.delete(key);
    } catch (error) {
      console.error(
        "file_delete_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return json({ error: "Gagal menghapus PDF" }, 500);
    }
    return json({ ok: true });
  }

  let object;
  try {
    object = await env.FILES.get(key);
  } catch (error) {
    console.error(
      "file_get_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Gagal membaca PDF" }, 500);
  }
  if (!object) return json({ error: "PDF tidak ditemukan" }, 404);

  const name = sanitizeFilename(object.customMetadata?.name || "penawaran.pdf");
  const download = url.searchParams.get("download") === "1";
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(name, download),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(object.size),
  });
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function handleCorporate(request, env, auth, isRefresh) {
  const db = env.DB;
  if (!db) return json({ error: "Database belum tersedia" }, 500);

  if (isRefresh) {
    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "private, no-store" },
      });
    }
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
      return json({ error: "Forbidden" }, 403);
    }
  } else if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "private, no-store" },
    });
  }

  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  try {
    if (isRefresh) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Body bukan JSON yang valid" }, 400);
      }
      const city = typeof body?.city === "string" ? body.city.trim() : "";
      if (!city) return json({ error: "Kota belum dipilih" }, 400);
      return json(await refreshCorporateCity(db, city, corporateSeed));
    }
    return json(await readCorporateLeads(db, corporateSeed));
  } catch (error) {
    console.error(
      "corporate_api_error",
      error instanceof Error ? error.message : "unknown error",
    );
    if (error && error.status === 400) {
      return json({ error: error.message }, 400);
    }
    return json(
      { error: "Gagal menarik data Corporate Engine dari sumber publik. Coba lagi." },
      502,
    );
  }
}

async function handleCorporateEnrich(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);

  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  try {
    return json(await enrichCorporateEmails(env.DB, 8));
  } catch (error) {
    console.error(
      "corporate_enrich_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Pencarian email belum berhasil. Coba lagi nanti." }, 502);
  }
}

async function handleCorporateProspectSync(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }
  const company = body?.company;
  if (!company || (!company.name && !company.website && !company.sourceLeadId)) {
    return json({ error: "Perusahaan belum dipilih" }, 400);
  }

  try {
    const match = await findCorporateLeadForCompany(env.DB, company);
    if (!match) {
      return json(
        {
          error: "Belum ada lead Corporate Engine yang cocok untuk perusahaan ini.",
          complete: false,
          missing: ["lead Corporate Engine"],
        },
        404,
      );
    }
    let lead = match;
    if (!isCorporateLeadComplete(lead)) {
      const researched = await researchCorporateLead(env.DB, lead.id, env);
      if (researched?.lead) lead = researched.lead;
    }
    const missing = corporateLeadMissing(lead);
    const complete = missing.length === 0;
    return json({
      lead,
      complete,
      missing,
      message: complete
        ? "Data lengkap dan tervalidasi ditemukan."
        : `Robot belum melengkapi: ${missing.join(", ")}.`,
    });
  } catch (error) {
    console.error(
      "corporate_prospect_sync_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Robot belum bisa melengkapi data perusahaan ini." }, 502);
  }
}

async function handleCorporateLeadEnrich(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);

  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 160) return json({ error: "Lead belum dipilih" }, 400);

  try {
    const result = await researchCorporateLead(env.DB, id, env);
    if (!result) return json({ error: "Lead tidak ditemukan" }, 404);
    return json(result);
  } catch (error) {
    console.error(
      "corporate_lead_enrich_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Pencarian kontak belum berhasil. Coba lagi." }, 502);
  }
}

async function handleCorporateCoordinateRepair(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* limit opsional */
  }
  try {
    const result = await repairCorporateCoordinates(env.DB, body?.limit);
    return json(result);
  } catch (error) {
    console.error(
      "corporate_coordinate_repair_api_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Perbaikan koordinat belum berhasil." }, 502);
  }
}

async function handleCorporateRobotStatus(request, env, auth) {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "private, no-store" },
    });
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  try {
    return json(await getRobotStatus(env.DB, env, user.sub));
  } catch (error) {
    console.error(
      "corporate_robot_status_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Status robot belum bisa dimuat." }, 502);
  }
}

async function handleCorporateScreeningBackfill(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* limit opsional */
  }
  try {
    return json(await backfillCorporateScreening(env.DB, env, body?.limit));
  } catch (error) {
    console.error(
      "corporate_screening_backfill_api_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Backfill screening belum berhasil." }, 502);
  }
}

async function handleCorporateRobotScreeningReview(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }
  const leadId = typeof body?.leadId === "string" ? body.leadId.trim() : "";
  if (!leadId || leadId.length > 160) {
    return json({ error: "Lead belum dipilih" }, 400);
  }
  if (typeof body?.reviewed !== "boolean") {
    return json({ error: "Status review tidak valid" }, 400);
  }
  try {
    const result = await reviewCorporateScreening(
      env.DB,
      user.sub,
      leadId,
      body.reviewed,
    );
    return json(result, result.ok ? 200 : 400);
  } catch (error) {
    console.error(
      "corporate_robot_screening_review_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Review OpenSanctions belum bisa disimpan." }, 502);
  }
}

async function handleCorporateRobotSettings(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }
  try {
    await updateRobotSettings(env.DB, user.sub, body || {});
    return json(await getRobotStatus(env.DB, env, user.sub));
  } catch (error) {
    console.error(
      "corporate_robot_settings_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Pengaturan robot belum bisa disimpan." }, 502);
  }
}

async function handleCorporateRobotRun(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* body opsional */
  }
  try {
    const limit = Math.max(1, Math.min(8, Number(body?.limit) || 4));
    const leadIds = Array.isArray(body?.leadIds)
      ? body.leadIds.filter((id) => typeof id === "string" && id.trim()).slice(0, 12)
      : [];
    const result = await runCorporateRobot(env.DB, env, {
      ownerId: user.sub,
      limit,
      leadIds,
      force: true,
      source: "manual",
    });
    return json(result);
  } catch (error) {
    console.error(
      "corporate_robot_run_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Robot belum bisa dijalankan. Coba lagi." }, 502);
  }
}

async function handleCorporateRobotTelegramTest(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  try {
    return json(await sendTestTelegram(env.DB, env, user.sub));
  } catch (error) {
    console.error(
      "corporate_robot_telegram_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ ok: false, message: "Tes Telegram belum berhasil." }, 502);
  }
}

async function handleCorporateRobotTelegramRetry(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    return json(
      await retryStuckTelegram(env.DB, env, user.sub, {
        includeUncertain: body?.includeUncertain === true,
        leadIds: Array.isArray(body?.leadIds) ? body.leadIds : [],
      }),
    );
  } catch (error) {
    console.error(
      "corporate_robot_telegram_retry_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Pesan macet belum bisa dikirim ulang." }, 502);
  }
}

async function handleCorporateRobotTelegramDetect(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  try {
    return json(await detectTelegramChat(env.DB, env, user.sub));
  } catch (error) {
    console.error(
      "corporate_robot_telegram_detect_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ ok: false, message: "Deteksi chat ID belum berhasil." }, 502);
  }
}

async function handleCorporateRobotCronHealth(request, env) {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "private, no-store" },
    });
  }
  try {
    return json(await getCronHealth(env.DB));
  } catch {
    return json({ ok: false, lastTick: "", lastRun: "" }, 502);
  }
}

async function runRobotBatchAndEnsureWebhook(db, env, options) {
  try {
    return await runCorporateRobot(db, env, options);
  } finally {
    // AI Leader memakai webhook, bukan polling. Pastikan webhook tetap
    // terdaftar sekali meskipun batch robot melempar error. Kegagalan
    // pendaftaran webhook tidak boleh menutupi hasil/error batch.
    await ensureTelegramWebhook(db, env).catch((error) => {
      console.error(
        "ai_leader_webhook_maintenance_error",
        error instanceof Error ? error.message : "unknown error",
      );
    });
  }
}

async function handleCorporateRobotCron(request, env) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!env.ROBOT_CRON_SECRET) {
    return json({ error: "Scheduler robot belum diaktifkan." }, 503);
  }
  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${env.ROBOT_CRON_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* body opsional */
  }
  try {
    await markCronTick(env.DB);
    await ensureCronOwner(env.DB);
    const result = await runRobotBatchAndEnsureWebhook(env.DB, env, {
      limit: Math.max(1, Math.min(12, Number(body?.limit) || 4)),
      force: true,
      source: "cron",
    });
    return json(result);
  } catch (error) {
    console.error(
      "corporate_robot_cron_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Robot cron gagal dijalankan." }, 502);
  }
}

async function handleCorporateRobotCronOidc(request, env) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!env.DB) return json({ error: "Database belum tersedia" }, 500);
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* body opsional */
  }

  try {
    const verification = await verifyGithubOidc(token, env);
    if (!verification.ok) {
      console.error("corporate_robot_oidc_rejected", verification.reason);
      return json({ error: "Unauthorized" }, 401);
    }
    await markCronTick(env.DB);
    await ensureCronOwner(env.DB);
    const result = await runRobotBatchAndEnsureWebhook(env.DB, env, {
      limit: Math.max(1, Math.min(12, Number(body?.limit) || 4)),
      force: true,
      source: "github-oidc",
    });
    return json(result);
  } catch (error) {
    console.error(
      "corporate_robot_oidc_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Robot cron gagal dijalankan." }, 502);
  }
}

async function conflictResponse(db, userId) {
  const row = await readRow(db, userId);
  return json(
    {
      error: "conflict",
      revision: row?.revision ?? 0,
      data: row ? parseData(row.payload) : null,
      updatedAt: row?.updated_at ?? null,
    },
    409,
  );
}

async function handleWhatsAppStatus(request, env, auth) {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "private, no-store" },
    });
  }
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);
  const url = new URL(request.url);
  try {
    return json(await getWhatsAppStatus(env, env.DB, url.searchParams.get("phone") || ""));
  } catch (error) {
    console.error(
      "whatsapp_status_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Status WhatsApp belum bisa dimuat." }, 502);
  }
}

async function handleWhatsAppSend(request, env, auth) {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "private, no-store" },
    });
  }
  if (!isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }
  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }
  try {
    const result = await sendQuoteWhatsApp(env, env.DB, user.sub, body || {});
    return json(result, result.status || 200);
  } catch (error) {
    console.error(
      "whatsapp_send_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ ok: false, error: "PDF belum bisa dikirim otomatis." }, 502);
  }
}

async function handleState(request, env, auth) {
  const db = env.DB;
  if (!db) return json({ error: "Database belum tersedia" }, 500);

  // Tolak permintaan lintas-origin untuk semua perubahan data.
  if (request.method === "PUT" && !isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: "Forbidden" }, 403);
  }

  const user = await auth.getUser(request);
  if (!user) return json({ error: "Sign in required" }, 401);

  try {
    await ensureSchema(db);

    if (request.method === "GET") {
      const row = await readRow(db, user.sub);
      if (!row) return json({ data: null, revision: 0, updatedAt: null });
      return json({
        data: parseData(row.payload),
        revision: row.revision,
        updatedAt: row.updated_at,
      });
    }

    if (request.method !== "PUT") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, PUT", "Cache-Control": "private, no-store" },
      });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return json({ error: "Content-Type harus application/json" }, 415);
    }

    const text = await request.text();
    if (text.length > MAX_PAYLOAD_CHARS) {
      return json({ error: "Data terlalu besar" }, 413);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Body bukan JSON yang valid" }, 400);
    }

    const baseRevision = body?.baseRevision;
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      return json({ error: "baseRevision tidak valid" }, 400);
    }
    if (!isValidDatabase(body?.data)) {
      return json({ error: "Struktur data tidak valid" }, 400);
    }

    const payload = JSON.stringify(body.data);
    if (payload.length > MAX_PAYLOAD_CHARS) {
      return json({ error: "Data terlalu besar" }, 413);
    }
    const now = new Date().toISOString();

    if (baseRevision === 0) {
      const result = await db
        .prepare(
          "INSERT INTO app_state (user_id, payload, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING",
        )
        .bind(user.sub, payload, now)
        .run();
      if (!result.meta?.changes) return conflictResponse(db, user.sub);
      return json({ ok: true, revision: 1, updatedAt: now });
    }

    const result = await db
      .prepare(
        "UPDATE app_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?",
      )
      .bind(payload, now, user.sub, baseRevision)
      .run();
    if (!result.meta?.changes) return conflictResponse(db, user.sub);
    return json({ ok: true, revision: baseRevision + 1, updatedAt: now });
  } catch (error) {
    console.error(
      "state_api_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Gagal memproses data" }, 500);
  }
}

function setup(env) {
  const auth = getAuth(env);

  if (!appHandler) {
    appHandler = auth.wrap(async (request, environment) => {
      const url = new URL(request.url);

      if (url.pathname === "/api/data") {
        return handleState(request, environment, auth);
      }
      if (url.pathname === "/api/whatsapp/status") {
        return handleWhatsAppStatus(request, environment, auth);
      }
      if (url.pathname === "/api/whatsapp/send") {
        return handleWhatsAppSend(request, environment, auth);
      }
      if (url.pathname === "/api/files" || url.pathname.startsWith("/api/files/")) {
        return handleFiles(request, environment, auth);
      }
      if (url.pathname === "/api/corporate") {
        return handleCorporate(request, environment, auth, false);
      }
      if (url.pathname === "/api/corporate/refresh") {
        return handleCorporate(request, environment, auth, true);
      }
      if (url.pathname === "/api/corporate/enrich") {
        return handleCorporateEnrich(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/lead") {
        return handleCorporateLeadEnrich(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/coordinates/repair") {
        return handleCorporateCoordinateRepair(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/prospect/sync") {
        return handleCorporateProspectSync(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot") {
        return handleCorporateRobotStatus(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/settings") {
        return handleCorporateRobotSettings(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/screening/review") {
        return handleCorporateRobotScreeningReview(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/screening/backfill") {
        return handleCorporateScreeningBackfill(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/run") {
        return handleCorporateRobotRun(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/telegram/test") {
        return handleCorporateRobotTelegramTest(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/telegram/retry") {
        return handleCorporateRobotTelegramRetry(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/telegram/detect") {
        return handleCorporateRobotTelegramDetect(request, environment, auth);
      }
      if (url.pathname === "/api/corporate/robot/cron") {
        return handleCorporateRobotCron(request, environment);
      }
      if (url.pathname === "/api/corporate/robot/cron-oidc") {
        return handleCorporateRobotCronOidc(request, environment);
      }
      if (url.pathname === "/api/corporate/robot/cron-health") {
        return handleCorporateRobotCronHealth(request, environment);
      }
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }
      if (!environment.ASSETS) {
        return new Response("Assets tidak tersedia", { status: 500 });
      }
      return environment.ASSETS.fetch(request);
    });
  }

  return appHandler;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      // WhatsApp memverifikasi webhook lewat GET dan mengirim update lewat POST.
      // Keduanya memakai secret webhook, bukan sesi pengguna.
      if (
        (request.method === "GET" || request.method === "POST") &&
        url.pathname === "/api/whatsapp/webhook"
      ) {
        return await handleWhatsAppWebhook(env.DB, env, request);
      }
      // Telegram memanggil endpoint ini langsung setelah update masuk.
      // Jangan lewat auth aplikasi: autentikasi memakai secret webhook.
      if (
        request.method === "POST" &&
        url.pathname === "/api/telegram/webhook"
      ) {
        const result = await handleTelegramLeaderWebhook(env.DB, env, request);
        return json({ ok: result.ok }, result.status);
      }
      // Worker hosting tidak punya proses latar terus-menerus. Heartbeat ini
      // melanjutkan antrean saat aplikasi dibuka; cron endpoint menangani
      // pemicu terjadwal ketika scheduler tersedia.
      if (ctx?.waitUntil && env.DB) {
        if (
          request.method === "GET" &&
          (url.pathname === "/" ||
            url.pathname === "/api/corporate" ||
            url.pathname === "/api/corporate/robot")
        ) {
          ctx.waitUntil(maybeRunCorporateRobot(env.DB, env));
          if (url.pathname === "/api/corporate/robot") {
            ctx.waitUntil(ensureTelegramWebhook(env.DB, env));
          }
        }
      }
      return await setup(env)(request, env);
    } catch (error) {
      console.error(
        "worker_error",
        error instanceof Error ? error.message : "unknown error",
      );
      return json({ error: "Terjadi kesalahan pada server" }, 500);
    }
  },

  async scheduled(_controller, env) {
    if (!env.DB) return;
    try {
      await markCronTick(env.DB);
      await ensureCronOwner(env.DB);
      await runRobotBatchAndEnsureWebhook(env.DB, env, {
        limit: 3,
        force: false,
        source: "cron",
      });
    } catch (error) {
      console.error(
        "corporate_robot_scheduled_error",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  },
};
