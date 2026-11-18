/**
 * Agen OpenSanctions untuk Tim Klarifikasi.
 *
 * Memakai endpoint /match milik OpenSanctions/yente untuk menyaring nama
 * perusahaan dan nama PIC terhadap daftar sanksi, debarment, dan PEP.
 *
 * Penting: OpenSanctions bukan layanan verifikasi kepemilikan nomor telepon
 * atau alamat e-mail. Hasilnya adalah sinyal risiko yang harus dibaca bersama
 * bukti kontak lain, bukan bukti bahwa kontak tersebut benar.
 */

const DEFAULT_API_URL = "https://api.opensanctions.org";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_THRESHOLD = 0.8;
const TOPICS = ["sanction", "sanction.linked", "debarment", "role.pep", "role.rca"];
const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const QUOTA_KEY = "opensanctions:quota-block";

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function opensanctionsConfigured(env = {}) {
  const key = clean(env.OPENSANCTIONS_API_KEY);
  const customUrl = clean(env.OPENSANCTIONS_API_URL);
  return Boolean(key || customUrl);
}

function apiUrl(env = {}) {
  return (clean(env.OPENSANCTIONS_API_URL) || DEFAULT_API_URL).replace(/\/+$/, "");
}

function isQuotaFailure(error) {
  return Number(error?.status) === 402 || /HTTP 402/.test(String(error?.message || ""));
}

/**
 * Cooldown global setelah OpenSanctions menolak karena kuota/billing. Semua
 * lead berbagi satu API key, jadi retry per lead hanya membuang waktu dan
 * subrequest. Lead tetap berstatus error dan tertahan gate sampai ditinjau.
 */
export async function opensanctionsQuotaCooldown(db) {
  if (!db) return { blocked: false, until: "" };
  try {
    const row = await db
      .prepare("SELECT value FROM corporate_meta WHERE key = ?")
      .bind(QUOTA_KEY)
      .first();
    if (!row?.value) return { blocked: false, until: "" };
    const parsed = JSON.parse(row.value);
    const until = Date.parse(parsed?.until || "");
    if (Number.isFinite(until) && until > Date.now()) {
      return { blocked: true, until: new Date(until).toISOString() };
    }
    return { blocked: false, until: "" };
  } catch {
    return { blocked: false, until: "" };
  }
}

async function writeQuotaCooldown(db) {
  if (!db) return;
  const now = Date.now();
  try {
    await db
      .prepare(
        "INSERT INTO corporate_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(
        QUOTA_KEY,
        JSON.stringify({
          until: new Date(now + QUOTA_COOLDOWN_MS).toISOString(),
          detectedAt: new Date(now).toISOString(),
        }),
      )
      .run();
  } catch {
    /* cooldown opsional; kegagalan cache tidak boleh menggagalkan klarifikasi */
  }
}

function quotaEvidence(until = "") {
  const resume = until
    ? ` Pemeriksaan dicoba lagi setelah ${new Date(until).toLocaleString("id-ID")}.`
    : " Periksa kuota atau billing API key OpenSanctions.";
  return `OpenSanctions: kuota/billing API habis (HTTP 402).${resume} Lead ditahan sampai pemeriksaan berhasil atau ditinjau manual.`;
}

function dataset(env = {}) {
  return clean(env.OPENSANCTIONS_DATASET) || "default";
}

function threshold(env = {}) {
  const value = Number(env.OPENSANCTIONS_THRESHOLD);
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_THRESHOLD;
}

/** Query hanya memakai nama dan negara; nomor/e-mail tidak dikirim ke API. */
export function buildOpenSanctionsQueries(lead = {}) {
  const companyName = clean(lead.name);
  const personName = clean(lead.contactName).replace(/\s+/g, " ");
  const queries = {};
  if (companyName) {
    queries.company = {
      schema: "LegalEntity",
      properties: {
        name: [companyName],
        country: ["Indonesia"],
      },
    };
  }
  if (personName) {
    queries.person = {
      schema: "Person",
      properties: {
        name: [personName],
        country: ["Indonesia"],
      },
    };
  }
  return queries;
}

function topicsOf(candidate = {}) {
  const values = candidate?.properties?.topics;
  return Array.isArray(values)
    ? values.map((value) => clean(value).toLowerCase()).filter(Boolean)
    : [];
}

function resultUrl(candidate = {}) {
  return candidate?.id
    ? `https://opensanctions.org/entities/${encodeURIComponent(candidate.id)}`
    : "";
}

function resultLine(label, candidate) {
  const topics = topicsOf(candidate);
  const score = Number(candidate?.score);
  const scoreText = Number.isFinite(score) ? score.toFixed(2) : "?";
  const topicText = topics.length ? ` [${topics.join(", ")}]` : "";
  const url = resultUrl(candidate);
  return `OpenSanctions ${label}: ${clean(candidate?.caption) || "tanpa nama"} — skor ${scoreText}${topicText}${url ? ` — ${url}` : ""}`;
}

/**
 * Ubah respons /match menjadi hasil yang aman ditampilkan. Hanya kandidat
 * yang benar-benar match, target risiko, dan memenuhi threshold yang dipakai.
 */
export function parseOpenSanctionsResponse(body, options = {}) {
  const minScore = Number.isFinite(Number(options.threshold))
    ? Number(options.threshold)
    : DEFAULT_THRESHOLD;
  const responses = body?.responses || {};
  const evidence = [];
  const matches = [];
  const queryErrors = [];

  for (const key of ["company", "person"]) {
    const result = responses[key];
    if (!result) continue;
    const label = key === "company" ? "perusahaan" : "PIC";
    if (Number(result.status) >= 400) {
      queryErrors.push(`${label}: HTTP ${result.status}`);
      continue;
    }
    if (!Array.isArray(result.results)) continue;
    const strong = result.results.filter((candidate) => {
      const score = Number(candidate?.score);
      return (
        candidate?.match === true &&
        candidate?.target !== false &&
        Number.isFinite(score) &&
        score >= minScore
      );
    });
    if (strong.length === 0) continue;
    for (const candidate of strong.slice(0, 3)) {
      matches.push({
        query: key,
        id: clean(candidate.id),
        caption: clean(candidate.caption),
        score: Number(candidate.score),
        topics: topicsOf(candidate),
        datasets: Array.isArray(candidate.datasets)
          ? candidate.datasets.map(clean).filter(Boolean).slice(0, 5)
          : [],
      });
      evidence.push(resultLine(label, candidate));
    }
  }

  if (matches.length === 0 && queryErrors.length > 0) {
    const quota = queryErrors.some((item) => /HTTP 402/.test(item));
    return {
      status: "error",
      matches: [],
      evidence: [
        quota ? quotaEvidence() : `OpenSanctions: ${queryErrors.join("; ")}.`,
      ],
      error: queryErrors.join("; "),
      quota,
    };
  }

  return {
    status: matches.length > 0 ? "review" : "clear",
    matches,
    evidence:
      evidence.length > 0
        ? evidence
        : ["OpenSanctions: tidak ada kandidat kuat untuk perusahaan/PIC."],
  };
}

function cacheKey(lead) {
  const company = clean(lead.name).toLowerCase().slice(0, 100);
  const person = clean(lead.contactName).toLowerCase().slice(0, 100);
  return `opensanctions:v1:${company}:${person}`;
}

async function readCache(db, key) {
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT value FROM corporate_meta WHERE key = ?")
      .bind(key)
      .first();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    if (!parsed?.cachedAt) return null;
    if (Date.now() - Date.parse(parsed.cachedAt) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(db, key, value) {
  if (!db) return;
  try {
    await db
      .prepare(
        "INSERT INTO corporate_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(key, JSON.stringify({ ...value, cachedAt: new Date().toISOString() }))
      .run();
  } catch {
    /* cache opsional; jangan gagalkan klarifikasi */
  }
}

async function postMatch(env, queries) {
  const url = new URL(`${apiUrl(env)}/match/${encodeURIComponent(dataset(env))}`);
  url.searchParams.set("limit", "3");
  url.searchParams.set("threshold", String(threshold(env)));
  // Pin algoritma agar skor tidak berubah diam-diam saat default berubah.
  url.searchParams.set("algorithm", "logic-v2");
  for (const topic of TOPICS) url.searchParams.append("topics", topic);
  const key = clean(env.OPENSANCTIONS_API_KEY);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(key ? { Authorization: `ApiKey ${key}` } : {}),
    },
    body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => ""))
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const quota = response.status === 402;
    const error = new Error(
      quota
        ? `OpenSanctions HTTP 402: kuota/billing API habis${detail ? ` — ${detail}` : ""}`
        : `OpenSanctions HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
    );
    error.status = response.status;
    error.quota = quota;
    throw error;
  }
  return response.json();
}

export async function screenLeadOpenSanctions(db, lead = {}, env = {}) {
  const checkedAt = new Date().toISOString();
  if (!opensanctionsConfigured(env)) {
    return {
      configured: false,
      status: "disabled",
      matches: [],
      evidence: [],
      checkedAt,
      error: "",
    };
  }

  const queries = buildOpenSanctionsQueries(lead);
  if (Object.keys(queries).length === 0) {
    return {
      configured: true,
      status: "clear",
      matches: [],
      evidence: ["OpenSanctions: nama perusahaan/PIC belum tersedia untuk diperiksa."],
      checkedAt,
      error: "",
    };
  }

  const key = cacheKey(lead);
  const cached = await readCache(db, key);
  if (cached) return { ...cached, configured: true, cached: true, checkedAt: cached.checkedAt || checkedAt };

  const cooldown = await opensanctionsQuotaCooldown(db);
  if (cooldown.blocked) {
    return {
      configured: true,
      status: "error",
      matches: [],
      evidence: [quotaEvidence(cooldown.until)],
      checkedAt,
      error: "OpenSanctions HTTP 402: kuota/billing API habis.",
      quotaBlocked: true,
    };
  }

  try {
    const body = await postMatch(env, queries);
    const parsed = parseOpenSanctionsResponse(body, { threshold: threshold(env) });
    if (parsed.status === "error" && parsed.quota) {
      await writeQuotaCooldown(db);
    }
    const result = {
      configured: true,
      ...parsed,
      checkedAt,
      error: parsed.status === "error" ? parsed.error || "Pemeriksaan gagal." : "",
    };
    // Jangan cache error: kegagalan API bisa pulih setelah kuota/billing
    // diperbaiki, dan hasil error lama tidak boleh menahan lead selama TTL.
    if (parsed.status !== "error") await writeCache(db, key, result);
    return result;
  } catch (error) {
    const quota = isQuotaFailure(error);
    if (quota) await writeQuotaCooldown(db);
    const until = quota ? (await opensanctionsQuotaCooldown(db)).until : "";
    const message = error instanceof Error ? error.message : "kesalahan tidak diketahui";
    return {
      configured: true,
      status: "error",
      matches: [],
      evidence: [
        quota
          ? quotaEvidence(until)
          : `OpenSanctions: pemeriksaan belum berhasil (${message}).`,
      ],
      checkedAt,
      error: error instanceof Error ? error.message : "OpenSanctions tidak dapat dihubungi.",
      quotaBlocked: quota,
    };
  }
}
