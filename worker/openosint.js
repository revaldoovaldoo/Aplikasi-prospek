/**
 * Agen OpenOSINT native untuk Tim Klarifikasi.
 *
 * Worker tidak dapat menjalankan Python/FastAPI. Karena itu agen ini
 * menjalankan pemeriksaan OpenOSINT pasif langsung dari Worker:
 * - DNS publik melalui Cloudflare DNS-over-HTTPS.
 * - Registrasi domain melalui RDAP.
 *
 * Hanya domain publik dari website lead yang diperiksa. Tidak ada data PIC,
 * e-mail pribadi, username, atau area berlogin yang dikirim.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const RDAP_URL = "https://rdap.org/domain/";

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function hostOf(value) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

/** Agen native selalu tersedia; tidak membutuhkan URL server eksternal. */
export function openosintConfigured() {
  return true;
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

function compactOutput(value, max = 420) {
  const text = clean(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function dnsQuery(domain, type) {
  const url = new URL(DOH_URL);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", type);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`DNS ${type} HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || body.Status !== 0) return [];
  return Array.isArray(body.Answer) ? body.Answer : [];
}

async function runDns(domain) {
  const types = ["A", "AAAA", "NS", "MX", "TXT"];
  const results = await Promise.allSettled(types.map((type) => dnsQuery(domain, type)));
  const lines = [];
  let requestsOk = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      requestsOk += 1;
      const values = result.value
        .map((answer) => clean(answer.data))
        .filter(Boolean)
        .slice(0, 4);
      if (values.length > 0) lines.push(`${types[index]}: ${values.join("; ")}`);
    }
  });
  if (requestsOk === 0) {
    return {
      tool: "search_dns",
      ok: false,
      output: "",
      error: "DNS publik tidak dapat dihubungi.",
    };
  }
  return {
    tool: "search_dns",
    ok: true,
    output: lines.join(" | ") || "Tidak ada record A/AAAA/NS/MX/TXT publik.",
    error: "",
  };
}

function rdapSummary(body) {
  const status = Array.isArray(body?.status) ? body.status.join(", ") : "";
  const events = new Map(
    (Array.isArray(body?.events) ? body.events : [])
      .map((event) => [clean(event?.eventAction), clean(event?.eventDate)])
      .filter(([action, date]) => action && date),
  );
  const nameservers = (Array.isArray(body?.nameservers) ? body.nameservers : [])
    .map((item) => clean(item?.ldhName).toLowerCase())
    .filter(Boolean)
    .slice(0, 4);
  const registrarEntity = (Array.isArray(body?.entities) ? body.entities : []).find(
    (entity) => (entity?.roles || []).includes("registrar"),
  );
  const registrar =
    clean(registrarEntity?.vcardArray?.[1]?.find?.((item) => item?.[0] === "fn")?.[3]) ||
    clean(registrarEntity?.handle);
  return [
    status ? `status: ${status}` : "",
    events.get("registration") ? `terdaftar: ${events.get("registration")}` : "",
    events.get("expiration") ? `kedaluwarsa: ${events.get("expiration")}` : "",
    events.get("last changed") ? `diperbarui: ${events.get("last changed")}` : "",
    registrar ? `registrar: ${registrar}` : "",
    nameservers.length > 0 ? `nameserver: ${nameservers.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

async function runRdap(domain) {
  try {
    const response = await fetch(`${RDAP_URL}${encodeURIComponent(domain)}`, {
      headers: {
        Accept: "application/rdap+json, application/json",
        "User-Agent": "HalloPane/1.0 (Corporate Engine)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        tool: "search_rdap",
        ok: false,
        output: "",
        error: `RDAP menolak permintaan (HTTP ${response.status}).`,
      };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { tool: "search_rdap", ok: false, output: "", error: "RDAP tidak mengembalikan data." };
    }
    return {
      tool: "search_rdap",
      ok: true,
      output: compactOutput(rdapSummary(body)) || "Data RDAP domain tersedia.",
      error: "",
    };
  } catch (error) {
    return {
      tool: "search_rdap",
      ok: false,
      output: "",
      error:
        error instanceof Error && /timeout|abort/i.test(error.name + error.message)
          ? "RDAP melewati batas waktu."
          : "RDAP tidak dapat dihubungi.",
    };
  }
}

/**
 * Mengumpulkan bukti domain dari OpenOSINT native. Domain adalah input publik
 * yang sudah tercantum di website lead; kegagalan konektor tidak menggagalkan
 * klarifikasi dan tidak mengubah status verified.
 */
export async function collectOpenOsintEvidence(db, lead) {
  const domain = hostOf(lead?.website);
  if (!domain) {
    return {
      configured: true,
      status: "skipped",
      domain: "",
      evidence: [],
      error: "Website/domain belum tersedia.",
      tools: [],
    };
  }

  const cacheKey = `openosint:${domain}`;
  const cachedText = await readMeta(db, cacheKey).catch(() => "");
  if (cachedText) {
    try {
      const cached = JSON.parse(cachedText);
      if (cached?.at && Date.now() - Date.parse(cached.at) < CACHE_TTL_MS) {
        return {
          configured: true,
          status: cached.status || "ok",
          domain,
          evidence: Array.isArray(cached.evidence) ? cached.evidence : [],
          error: clean(cached.error),
          tools: Array.isArray(cached.tools) ? cached.tools : [],
          cached: true,
        };
      }
    } catch {
      /* cache rusak; ambil ulang */
    }
  }

  const tools = await Promise.all([runDns(domain), runRdap(domain)]);
  const succeeded = tools.filter((tool) => tool.ok);
  const evidence = succeeded
    .map((tool) => (tool.output ? `OpenOSINT ${tool.tool}: ${tool.output}` : ""))
    .filter(Boolean);
  const errors = tools.filter((tool) => !tool.ok).map((tool) => tool.error);
  const result = {
    configured: true,
    status: succeeded.length > 0 ? "ok" : "error",
    domain,
    evidence,
    error: errors[0] || "",
    tools: tools.map((tool) => ({
      tool: tool.tool,
      ok: tool.ok,
      error: tool.error || "",
    })),
  };

  // Hanya cache hasil yang berhasil supaya gangguan sementara dicoba lagi.
  if (succeeded.length > 0) {
    await writeMeta(
      db,
      cacheKey,
      JSON.stringify({ ...result, at: new Date().toISOString() }),
    ).catch(() => undefined);
  }
  return result;
}
