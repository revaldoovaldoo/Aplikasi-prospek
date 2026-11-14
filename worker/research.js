/**
 * Panel riset dan validasi lead Corporate Engine.
 *
 * Empat agen Klarifikasi berjalan bersamaan:
 * 1. Scout          — profil, website resmi, alamat, koordinat (Exa Answer).
 * 2. Contact Finder — PIC, jabatan, e-mail, nomor telepon (Exa Answer).
 * 3. Verifier       — memeriksa ulang temuan secara independen (Exa Answer).
 * 4. OpenOSINT      — DNS/RDAP pasif dari domain resmi (self-host opsional).
 *
 * Hasil AI tidak langsung dipercaya. Worker memeriksa ulang website yang bisa
 * dibuka, kecocokan nama, domain/MX e-mail, nomor telepon, dan koordinat.
 * Hanya lead dengan semua bukti itu yang boleh masuk Prospek dan Telegram.
 */

import {
  coordinateInRegion,
  enrichCorporateLead,
  ensureCorporateSchema,
  exaAnswer,
  isRegionCoordinateSource,
  readPublicText,
  regionCoordinate,
  rowToLead,
  sanitizePicName,
} from "./corporate.js";
import { collectOpenOsintEvidence } from "./openosint.js";
import {
  formatPicPhones,
  selectPicPhones,
  validPicPhone,
} from "./phone.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const PHOTON_URL = "https://photon.komoot.io/api/";
const USER_AGENT =
  "HalloPane/1.0 (Corporate Engine; +https://site-112732548e6d4039b0803f571aea6817.freebuff.page)";
const GEO_TIMEOUT_MS = 9000;
const MAX_SOURCES = 12;
const GENERIC_EMAIL_RE =
  /^(?:info|sales|marketing|reservation|reservasi|contact|kontak|admin|office|hello|support|cs|frontdesk|front\.office|hrd|career|recruitment|purchasing|procurement)@/i;

const SOCIAL_OR_AGGREGATOR_HOSTS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "wa.me",
  "whatsapp.com",
  "t.me",
  "linktr.ee",
  "google.com",
  "goo.gl",
  "bit.ly",
  "tripadvisor.com",
  "tripadvisor.co.id",
  "yelp.com",
  "booking.com",
  "agoda.com",
  "traveloka.com",
  "tiket.com",
  "tokopedia.com",
  "shopee.co.id",
  "olx.co.id",
]);

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "entityName",
    "officialWebsite",
    "address",
    "city",
    "latitude",
    "longitude",
    "confidence",
    "notes",
    "sources",
  ],
  properties: {
    entityName: { type: "string" },
    officialWebsite: { type: "string" },
    address: { type: "string" },
    city: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    notes: { type: "string" },
    sources: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
};

const CONTACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "personName",
    "role",
    "email",
    "phone",
    "website",
    "address",
    "city",
    "confidence",
    "notes",
    "sources",
  ],
  properties: {
    personName: { type: "string" },
    role: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    website: { type: "string" },
    address: { type: "string" },
    city: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    notes: { type: "string" },
    sources: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
};

const VERIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "websiteVerified",
    "emailVerified",
    "phoneVerified",
    "personVerified",
    "locationVerified",
    "website",
    "personName",
    "role",
    "email",
    "phone",
    "address",
    "city",
    "latitude",
    "longitude",
    "confidence",
    "conflicts",
    "notes",
    "sources",
  ],
  properties: {
    websiteVerified: { type: "boolean" },
    emailVerified: { type: "boolean" },
    phoneVerified: { type: "boolean" },
    personVerified: { type: "boolean" },
    locationVerified: { type: "boolean" },
    website: { type: "string" },
    personName: { type: "string" },
    role: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    address: { type: "string" },
    city: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    conflicts: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    notes: { type: "string" },
    sources: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
};

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function uniqueStrings(values, limit = MAX_SOURCES) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = clean(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
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

function normalizeUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
      return "";
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isSocialOrAggregator(value) {
  const host = hostOf(value);
  if (!host) return true;
  return [...SOCIAL_OR_AGGREGATOR_HOSTS].some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

function firstUsableWebsite(values) {
  for (const value of values) {
    const url = normalizeUrl(value);
    if (url && !isSocialOrAggregator(url)) return url;
  }
  return "";
}

function validCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function inIndonesia(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return lat >= -11.5 && lat <= 6.5 && lng >= 94 && lng <= 142;
}

function nameTokens(name) {
  return clean(name)
    .toLowerCase()
    .replace(
      /\b(?:pt|cv|tbk|persero|ud|pd|hotel|resort|sekolah|school|sma|smk|smp|sd|universitas|university|institut|kampus|the|and|by)\b/g,
      " ",
    )
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function nameMatchesSite(name, text) {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return false;
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function personNameTokens(name) {
  return clean(name)
    .toLowerCase()
    .replace(/\b(?:ir|dr|drs|hj|h|mr|mrs|ms|bapak|ibu|pak|bu)\b\.?/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function personNameOnSite(name, text) {
  const tokens = personNameTokens(name);
  if (tokens.length === 0) return false;
  const haystack = text.toLowerCase();
  if (haystack.includes(clean(name).toLowerCase())) return true;
  const matched = tokens.filter((token) => haystack.includes(token));
  return tokens.length === 1 ? matched.length === 1 : matched.length >= 2;
}

function digitsOf(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneTail(value) {
  let digits = digitsOf(value);
  if (!digits) return "";
  if (digits.startsWith("62")) digits = `0${digits.slice(2)}`;
  return digits.slice(-8);
}

function hasValidPhone(value) {
  return validPicPhone(value);
}

function hasValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(clean(value));
}

async function hasMxRecord(domain) {
  if (!domain) return null;
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(4500),
      },
    );
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.Status !== 0) return false;
    return Array.isArray(body?.Answer) && body.Answer.length > 0;
  } catch {
    return null;
  }
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

async function geocodeAddress(db, address) {
  const query = clean(address);
  if (!query) return null;
  const cacheKey = `geocode:${query.toLowerCase().slice(0, 220)}`;
  const cached = await readMeta(db, cacheKey).catch(() => "");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.lat && parsed?.lon) return parsed;
    } catch {
      /* cache rusak; ulangi pencarian */
    }
  }

  const runNominatim = async (text) => {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "id");
    url.searchParams.set("accept-language", "id");
    url.searchParams.set("q", /indonesia/i.test(text) ? text : `${text}, Indonesia`);
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const first = Array.isArray(body) ? body[0] : null;
    if (!first || !validCoordinate(first.lat, first.lon)) return null;
    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      displayName: clean(first.display_name).slice(0, 300),
      source: "Nominatim/OpenStreetMap",
    };
  };

  const runPhoton = async (text) => {
    const url = new URL(PHOTON_URL);
    url.searchParams.set("q", /indonesia/i.test(text) ? text : `${text}, Indonesia`);
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "id");
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const feature = body?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!validCoordinate(lat, lon)) return null;
    const properties = feature?.properties || {};
    return {
      lat,
      lon,
      displayName: clean(
        [
          properties.name,
          properties.street,
          properties.district,
          properties.city,
          properties.state,
          properties.country,
        ]
          .filter(Boolean)
          .join(", "),
      ).slice(0, 300),
      source: "Photon/OpenStreetMap",
    };
  };

  try {
    let result = await runNominatim(query);
    if (!result) result = await runPhoton(query);
    if (!result && query.length < 90) {
      result = await runNominatim(`${query}, Indonesia`);
    }
    if (result) {
      await writeMeta(
        db,
        cacheKey,
        JSON.stringify({ ...result, cachedAt: new Date().toISOString() }),
      ).catch(() => undefined);
    }
    return result;
  } catch {
    return null;
  }
}

function categoryLabel(category) {
  return category === "hotel"
    ? "hotel"
    : category === "school"
      ? "sekolah"
      : "perusahaan";
}

function panelPrompt(lead) {
  return `${lead.name}, ${categoryLabel(lead.category)}, ${lead.area ? `${lead.area}, ` : ""}${lead.city}, Indonesia`;
}

const COMMON_RULES = `Anda peneliti data bisnis publik. Hanya gunakan halaman publik yang dapat dibuka. Jangan mengakses area login, CCTV, akun sosial media pribadi, atau data pribadi non-bisnis. Jangan mengarang nama, email, nomor, alamat, atau koordinat. Jika tidak ada bukti, kembalikan string kosong atau angka 0 dan confidence rendah. Sertakan URL sumber yang benar-benar mendukung jawaban.`;

function sourceList(...results) {
  return uniqueStrings(
    results.flatMap((result) =>
      (result?.citations || []).map((citation) => citation.url),
    ),
  );
}

function citationForHost(results, host) {
  for (const result of results) {
    for (const citation of result?.citations || []) {
      if (hostOf(citation.url) === host) return citation;
    }
  }
  return null;
}

function citationForPerson(results, name) {
  const tokens = personNameTokens(name);
  if (tokens.length === 0) return null;
  for (const result of results) {
    for (const citation of result?.citations || []) {
      const text = `${citation.title || ""} ${citation.text || ""}`.toLowerCase();
      if (tokens.some((token) => text.includes(token))) return citation;
    }
  }
  return null;
}

async function runPanel(lead, env) {
  const prompt = panelPrompt(lead);
  const profilePromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Cari profil resmi ${prompt}. Temukan website resmi, alamat lengkap, kota, dan koordinat lokasi. Prioritaskan website resmi, halaman kontak, Google Business, atau OpenStreetMap. Jangan memakai LinkedIn/Facebook/Instagram sebagai website resmi.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Scout: fokus pada identitas organisasi, website resmi, alamat, dan koordinat.`,
    outputSchema: PROFILE_SCHEMA,
  });
  const contactPromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Cari PIC yang dapat mengambil keputusan di ${prompt}. Prioritas: IT Manager, Kepala IT, Network Engineer, General Manager, Chief Engineer, Kepala Sekolah, Wakil Kepala Sekolah, atau pimpinan operasional. Temukan nama lengkap, jabatan, e-mail, dan nomor telepon/WhatsApp yang dipublikasikan di website resmi, halaman tim, LinkedIn profesional publik, atau direktori bisnis.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Contact Finder: fokus pada orang yang tepat, jabatan, e-mail, dan nomor telepon. Jangan memakai data pribadi non-bisnis.`,
    outputSchema: CONTACT_SCHEMA,
  });
  // Verifier berjalan bersamaan, bukan menunggu dua agen lain. Ia memeriksa
  // ulang sumber publik sendiri agar hasil tetap independen.
  const verifierPromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Lakukan verifikasi independen untuk ${prompt}. Temukan dan periksa langsung website resmi, nama PIC atau pimpinan yang mengambil keputusan, jabatan, e-mail, nomor telepon/WhatsApp, alamat, dan koordinat. Jangan mengandalkan ringkasan agen lain. Buang klaim tanpa sumber publik; tandai konflik dan isi kosong/0 bila tidak yakin.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Verifier independen. Bersikap skeptis, periksa sumber publik sendiri, dan hanya setujui data yang benar-benar didukung.`,
    outputSchema: VERIFIER_SCHEMA,
  });

  const [profileResult, contactResult, verifierResult] = await Promise.all([
    profilePromise,
    contactPromise,
    verifierPromise,
  ]);
  const profile = profileResult.answer || {};
  const contact = contactResult.answer || {};
  const verifier = verifierResult.answer || {};
  const combinedError =
    [profileResult.error, contactResult.error, verifierResult.error].find(Boolean) || "";

  return {
    profile,
    contact,
    verifier,
    results: [profileResult, contactResult, verifierResult],
    sources: sourceList(profileResult, contactResult, verifierResult),
    error: combinedError,
    complete: Boolean(
      profileResult.answer && contactResult.answer && verifierResult.answer,
    ),
  };
}

async function fallbackLead(db, lead, env) {
  try {
    const enriched = await enrichCorporateLead(db, lead.id, env);
    return enriched?.lead || lead;
  } catch {
    return lead;
  }
}

/**
 * Menjalankan panel AI lalu memvalidasi hasilnya secara deterministik.
 * Return shape kompatibel dengan endpoint pencarian kontak lama.
 */
export async function researchCorporateLead(db, leadId, env = {}) {
  await ensureCorporateSchema(db);
  const row = await db
    .prepare(
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence FROM corporate_leads WHERE id = ?",
    )
    .bind(leadId)
    .first();
  if (!row) return null;

  let lead = rowToLead(row);
  let panel = {
    profile: {},
    contact: {},
    verifier: {},
    results: [],
    sources: [],
    error: "",
    complete: false,
  };

  if (clean(env.EXA_API_KEY)) {
    try {
      panel = await runPanel(lead, env);
    } catch (error) {
      console.error(
        "corporate_research_panel_error",
        error instanceof Error ? error.message : "unknown error",
      );
      panel.error = "Panel AI tidak dapat dijalankan.";
    }
  }

  // Jangan ulangi penelusuran website secara mendalam hanya karena satu agen
  // tidak menjawab. Fallback dispesialkan untuk kasus tidak ada hasil kontak
  // sama sekali, supaya lead yang sudah punya data tidak menggandakan waktu.
  const panelHasContact = Boolean(
    panel.contact && Object.keys(panel.contact).length > 0,
  );
  if (!panel.complete && !panelHasContact) {
    lead = await fallbackLead(db, lead, env);
  }

  const profile = panel.profile || {};
  const contact = panel.contact || {};
  const verifier = panel.verifier || {};
  const results = panel.results || [];

  const website = firstUsableWebsite([
    verifier.website,
    profile.officialWebsite,
    contact.website,
    lead.website,
  ]) || (isSocialOrAggregator(lead.website) ? "" : normalizeUrl(lead.website));
  const siteHost = hostOf(website);
  // Agen Klarifikasi keempat: OpenOSINT berjalan paralel dengan pembacaan
  // website. Hanya domain yang dikirim, tidak pernah nama/email/nomor PIC.
  const openosintPromise = collectOpenOsintEvidence(
    db,
    { ...lead, website },
    env,
  ).catch((error) => ({
    configured: true,
    status: "error",
    domain: siteHost,
    evidence: [],
    error:
      error instanceof Error ? error.message : "OpenOSINT tidak dapat dijalankan.",
    tools: [],
  }));
  let site = { pages: [], text: "" };
  if (website) {
    try {
      site = await readPublicText(website, 3);
    } catch {
      /* website tidak bisa dibaca; validasi akan gagal */
    }
  }
  const openosint = await openosintPromise;

  const email = clean(verifier.email || contact.email || lead.email).toLowerCase();
  const phoneCandidate = clean(verifier.phone || contact.phone || lead.phone);
  const phone = formatPicPhones(phoneCandidate, 2) || phoneCandidate;
  const personName = sanitizePicName(
    verifier.personName || contact.personName || lead.contactName,
  );
  const role = clean(verifier.role || contact.role || lead.contactRole);
  const address = clean(
    verifier.address ||
      profile.address ||
      contact.address ||
      [lead.area, lead.city].filter(Boolean).join(", "),
  );
  const city = clean(verifier.city || profile.city || contact.city || lead.city);
  const siteText = site.text || "";
  const officialCitations = siteHost
    ? results.flatMap((result) =>
        (result?.citations || []).filter(
          (citation) => hostOf(citation.url) === siteHost,
        ),
      )
    : [];
  const officialCitationText = officialCitations
    .map((citation) => `${citation.title || ""} ${citation.text || ""}`)
    .join(" ");
  const evidenceText = `${siteText} ${officialCitationText}`.trim();

  const directSiteReadable = site.pages.length > 0 && siteText.length >= 120;
  const citedSiteReadable = officialCitations.length > 0 && officialCitationText.length >= 160;
  const websiteReadable = directSiteReadable || citedSiteReadable;
  const websiteNameMatch = websiteReadable
    ? nameMatchesSite(lead.name, evidenceText)
    : false;
  const websiteVerified = Boolean(
    website && siteHost && websiteReadable && websiteNameMatch,
  );

  const emailDomain = hasValidEmail(email) ? email.split("@")[1] : "";
  const emailDomainMatches = Boolean(emailDomain && hostOf(emailDomain) === siteHost);
  const mx = emailDomain ? await hasMxRecord(emailDomain) : null;
  const genericEmail = GENERIC_EMAIL_RE.test(email);
  const emailOnSite = Boolean(
    email && evidenceText.toLowerCase().includes(email.toLowerCase()),
  );
  const emailInOfficialSource = Boolean(
    email &&
      `${officialCitationText} ${officialCitations.map((item) => item.url).join(" ")}`
        .toLowerCase()
        .includes(email.toLowerCase()),
  );
  const emailVerified = Boolean(
    hasValidEmail(email) &&
      !genericEmail &&
      mx === true &&
      (emailOnSite || (emailDomainMatches && emailInOfficialSource)),
  );

  const tails = selectPicPhones(phone, 2)
    .map((candidate) => phoneTail(candidate))
    .filter(Boolean);
  const evidenceDigits = digitsOf(evidenceText);
  const officialDigits = digitsOf(officialCitationText);
  const phoneOnSite = tails.some((tail) => evidenceDigits.includes(tail));
  const phoneInOfficialSource = tails.some((tail) =>
    officialDigits.includes(tail),
  );
  const phoneVerified = Boolean(
    hasValidPhone(phone) && (phoneOnSite || phoneInOfficialSource),
  );

  const contactUrl =
    citationForPerson(results, personName)?.url ||
    officialCitations[0]?.url ||
    lead.contactUrl ||
    "";
  const contactSource = officialCitations.length > 0
    ? "Website resmi / panel AI"
    : panel.sources.length > 0
      ? `Panel AI · ${hostOf(panel.sources[0]) || "sumber publik"}`
      : lead.contactSource;
  const personOnSite = Boolean(
    personName && personNameOnSite(personName, evidenceText),
  );
  const personSourceUsable = Boolean(
    contactUrl &&
      (hostOf(contactUrl) === siteHost || /linkedin\./i.test(contactUrl) || /^https?:/i.test(contactUrl)),
  );
  const personVerified = Boolean(
    personName && role && (personOnSite || personSourceUsable),
  );

  let coordinate = null;
  if (
    validCoordinate(lead.latitude, lead.longitude) &&
    !isRegionCoordinateSource(lead.coordinateSource) &&
    coordinateInRegion(lead.city, lead.latitude, lead.longitude) !== false
  ) {
    coordinate = {
      lat: Number(lead.latitude),
      lon: Number(lead.longitude),
      displayName: lead.coordinateAddress || address,
      source: lead.coordinateSource || "OpenStreetMap",
    };
  }
  if (!coordinate) {
    coordinate = await geocodeAddress(
      db,
      address || `${lead.name}, ${lead.area ? `${lead.area}, ` : ""}${city}, Indonesia`,
    );
  }
  if (
    !coordinate &&
    validCoordinate(verifier.latitude, verifier.longitude) &&
    inIndonesia(verifier.latitude, verifier.longitude) &&
    coordinateInRegion(lead.city, verifier.latitude, verifier.longitude) !== false &&
    verifier.locationVerified === true
  ) {
    coordinate = {
      lat: Number(verifier.latitude),
      lon: Number(verifier.longitude),
      displayName: address,
      source: "Panel AI (disetujui Verifier)",
    };
  }
  if (
    coordinate &&
    coordinateInRegion(lead.city, coordinate.lat, coordinate.lon) === false
  ) {
    coordinate = null;
  }
  const locationVerified = Boolean(
    coordinate && validCoordinate(coordinate.lat, coordinate.lon),
  );

  const aiChecks = [
    verifier.websiteVerified,
    verifier.emailVerified,
    verifier.phoneVerified,
    verifier.personVerified,
    verifier.locationVerified,
  ].filter((value) => typeof value === "boolean");
  const aiRejected = aiChecks.some((value) => value === false);
  const aiApproved = aiChecks.filter(Boolean).length;
  const panelConfidence = Math.round(
    [profile.confidence, contact.confidence, verifier.confidence]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((total, value, _, values) => total + value / values.length, 0) || 0,
  );

  const fullyVerified = Boolean(
    websiteVerified &&
      emailVerified &&
      phoneVerified &&
      personVerified &&
      locationVerified &&
      !aiRejected,
  );
  const hasAnyEvidence = Boolean(
    website || email || phone || personName || coordinate,
  );
  const status = fullyVerified ? "verified" : hasAnyEvidence ? "partial" : "missing";
  const aiConfidence = panelConfidence || (fullyVerified ? 90 : 0);

  const evidence = [];
  if (websiteVerified) {
    evidence.push(`Website resmi ${website} dapat dibuka dan cocok dengan nama entitas.`);
  } else {
    evidence.push("Website belum lolos pemeriksaan identitas resmi.");
  }
  if (emailVerified) {
    evidence.push(
      `E-mail PIC ${email} tervalidasi: MX aktif dan ditemukan pada sumber resmi.`,
    );
  } else if (genericEmail) {
    evidence.push(
      "E-mail yang ditemukan masih generik (info/sales/admin), bukan e-mail PIC.",
    );
  } else {
    evidence.push("E-mail PIC belum tervalidasi sebagai milik entitas resmi.");
  }
  if (phoneVerified) {
    evidence.push(`Nomor PIC ${phone} ditemukan pada website/sumber resmi.`);
  } else {
    evidence.push("Nomor PIC belum ditemukan pada website/sumber resmi.");
  }
  if (personVerified) {
    evidence.push(
      `PIC ${personName}${role ? ` — ${role}` : ""} ditemukan pada sumber publik.`,
    );
  } else {
    evidence.push("Nama/jabatan PIC belum tervalidasi.");
  }
  if (locationVerified) {
    evidence.push(
      `Koordinat ${coordinate.lat.toFixed(6)}, ${coordinate.lon.toFixed(6)} dari ${coordinate.source}.`,
    );
  } else {
    evidence.push("Koordinat lokasi belum dapat diverifikasi.");
  }
  if (aiChecks.length > 0) {
    evidence.push(
      `Panel AI (Scout, Contact Finder, Verifier): ${aiApproved}/${aiChecks.length} pemeriksaan disetujui.`,
    );
  }
  if (Array.isArray(verifier.conflicts) && verifier.conflicts.length > 0) {
    evidence.push(`Catatan panel: ${verifier.conflicts.slice(0, 3).join("; ")}`);
  }
  if (panel.error) evidence.push(`Catatan riset: ${panel.error}`);
  if (openosint.evidence.length > 0) {
    evidence.push(...openosint.evidence);
  } else if (openosint.configured && openosint.error) {
    evidence.push(`OpenOSINT: ${openosint.error}`);
  }

  const now = new Date().toISOString();
  const region = regionCoordinate(lead.city, lead.area);
  const nextLead = {
    ...lead,
    website: website || lead.website,
    email: email || lead.email,
    phone: phone || lead.phone,
    contactName: sanitizePicName(personName || lead.contactName),
    contactRole: role || lead.contactRole,
    contactUrl,
    contactSource,
    latitude: coordinate?.lat || region?.latitude || 0,
    longitude: coordinate?.lon || region?.longitude || 0,
    coordinateAddress: clean(
      coordinate?.displayName || region?.coordinateAddress || address,
    ),
    coordinateSource: coordinate?.source || region?.coordinateSource || "",
    validationStatus: status,
    validationEvidence: evidence.slice(0, 12),
    validatedAt: now,
    aiConfidence,
  };

  await db
    .prepare(
      `UPDATE corporate_leads
       SET website = ?, email = ?, phone = ?, contact_name = ?, contact_role = ?,
           contact_url = ?, contact_source = ?, latitude = ?, longitude = ?,
           coordinate_address = ?, coordinate_source = ?, validation_status = ?,
           validation_evidence = ?, validated_at = ?, ai_confidence = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      nextLead.website,
      nextLead.email,
      nextLead.phone,
      nextLead.contactName,
      nextLead.contactRole,
      nextLead.contactUrl,
      nextLead.contactSource,
      nextLead.latitude,
      nextLead.longitude,
      nextLead.coordinateAddress,
      nextLead.coordinateSource,
      nextLead.validationStatus,
      JSON.stringify(nextLead.validationEvidence),
      nextLead.validatedAt,
      nextLead.aiConfidence,
      now,
      lead.id,
    )
    .run();

  return {
    lead: nextLead,
    email: nextLead.email,
    phone: nextLead.phone,
    contact: personName
      ? { name: personName, role, url: contactUrl, source: contactSource }
      : null,
    checked: site.pages.length,
    found: Boolean(nextLead.email || nextLead.phone || nextLead.contactName),
    webSearch: {
      enabled: Boolean(clean(env.EXA_API_KEY)),
      error: panel.error || "",
    },
    validation: {
      status,
      websiteVerified,
      emailVerified,
      phoneVerified,
      personVerified,
      locationVerified,
      aiApproved,
      aiChecks: aiChecks.length,
      aiRejected,
      evidence: nextLead.validationEvidence,
      sources: panel.sources,
      openosint: {
        configured: Boolean(openosint.configured),
        status: openosint.status || "disabled",
        domain: openosint.domain || "",
        evidence: openosint.evidence || [],
        error: openosint.error || "",
        tools: openosint.tools || [],
      },
    },
  };
}
