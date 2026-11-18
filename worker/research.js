/**
 * Panel riset dan validasi lead Corporate Engine.
 *
 * Lima agen Klarifikasi:
 * 1. Scout          — profil, website resmi, alamat, koordinat (Exa Answer).
 * 2. Contact Finder — PIC, jabatan, e-mail, nomor telepon (Exa Answer).
 * 3. Verifier       — memeriksa ulang temuan secara independen (Exa Answer).
 * 4. OpenOSINT      — DNS/RDAP pasif dari domain resmi (self-host opsional).
 * 5. OpenSanctions  — screening nama perusahaan/PIC terhadap sanksi/PEP.
 *
 * Hasil AI tidak langsung dipercaya. Worker memeriksa ulang website yang bisa
 * dibuka, kecocokan nama, domain/MX e-mail, nomor telepon, dan koordinat.
 * Hanya lead dengan semua bukti itu yang boleh masuk Prospek dan Telegram.
 */

import {
  boundPicPhoneEvidence,
  boundPicPhoneSource,
  coordinateCandidateMatchesName,
  coordinateInRegion,
  coordinateReadyForPublish,
  enrichCorporateLead,
  ensureCorporateSchema,
  exaAnswer,
  isRegionCoordinateSource,
  isRoadCoordinate,
  osmElementCenter,
  readPublicText,
  regionCoordinate,
  rowToLead,
  sanitizePicName,
  screeningFieldsForResearch,
} from "./corporate.js";
import { collectOpenOsintEvidence } from "./openosint.js";
import { screenLeadOpenSanctions } from "./opensanctions.js";
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

// Exa membatasi outputSchema objek ke 10 properti. Verifier harus tetap
// menghasilkan bukti inti; konflik dan catatan digabung ke role agar schema
// tidak ditolak sebelum agen sempat berjalan.
const VERIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "websiteVerified",
    "phoneVerified",
    "personVerified",
    "locationVerified",
    "website",
    "personName",
    "role",
    "phone",
    "latitude",
    "longitude",
  ],
  properties: {
    websiteVerified: { type: "boolean" },
    phoneVerified: { type: "boolean" },
    personVerified: { type: "boolean" },
    locationVerified: { type: "boolean" },
    website: { type: "string" },
    personName: { type: "string" },
    role: { type: "string" },
    phone: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
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

/**
 * Geocoder hanya boleh mengembalikan entitas, bukan jalan/kelurahan yang
 * kebetulan berada di sekitar alamat. Contoh kasus: "Jalan Garuda Ujung"
 * tidak boleh dipakai sebagai titik Lazuardi Global Islamic School.
 */
async function geocodeAddress(db, address, entityName) {
  const query = clean(address);
  const name = clean(entityName);
  if (!query || !name) return null;
  const cacheKey = `geocode:v2:${name.toLowerCase().slice(0, 80)}:${query.toLowerCase().slice(0, 180)}`;
  const cached = await readMeta(db, cacheKey).catch(() => "");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.lat && parsed?.lon) return parsed;
    } catch {
      /* cache rusak; ulangi pencarian */
    }
  }

  const accepted = (candidate) =>
    candidate &&
    validCoordinate(candidate.lat, candidate.lon) &&
    !isRoadCoordinate(candidate) &&
    coordinateCandidateMatchesName(name, `${candidate.name || ""} ${candidate.displayName || ""}`);

  const runNominatim = async (text) => {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
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
    for (const item of Array.isArray(body) ? body : []) {
      const candidate = {
        lat: Number(item.lat),
        lon: Number(item.lon),
        displayName: clean(item.display_name).slice(0, 300),
        name: clean(item.name || item.namedetails?.name).slice(0, 180),
        type: clean(item.type),
        class: clean(item.class),
        source: "Nominatim/OpenStreetMap (nama cocok)",
      };
      if (accepted(candidate)) return candidate;
    }
    return null;
  };

  const runPhoton = async (text) => {
    const url = new URL(PHOTON_URL);
    url.searchParams.set("q", /indonesia/i.test(text) ? text : `${text}, Indonesia`);
    url.searchParams.set("limit", "5");
    // Photon hanya menerima default/de/en/fr. `id` menghasilkan HTTP 400 dan
    // membuat semua kandidat manual jatuh ke pusat wilayah.
    url.searchParams.set("lang", "en");
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    for (const feature of body?.features || []) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const properties = feature?.properties || {};
      const candidate = {
        lat: Number(coordinates[1]),
        lon: Number(coordinates[0]),
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
        name: clean(properties.name).slice(0, 180),
        type: clean(properties.osm_value || properties.type),
        class: clean(properties.osm_key),
        source: "Nominatim/OpenStreetMap (nama cocok)",
      };
      if (accepted(candidate)) return candidate;
    }
    return null;
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

/**
 * Ambil titik entity OSM (node/way/relation). Untuk way dan relation, pusat
 * elemen dari Overpass/OSM dipakai sebagai sumber entity yang eksplisit agar
 * sekolah dan hotel berbentuk area tidak diblokir hanya karena bukan node.
 */
async function osmEntityCoordinate(db, lead, options = {}) {
  const match = /^osm:(node|way|relation)\/(\d+)$/i.exec(clean(lead.id));
  if (!match) return null;
  const type = match[1].toLowerCase();
  const osmId = match[2];
  const force = options.force === true;
  const cacheKey = `osm-coordinate:${type}:${osmId}`;
  const cached = await readMeta(db, cacheKey).catch(() => "");
  if (cached && !force) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.lat && parsed?.lon) return parsed;
    } catch {
      /* cache rusak; ulangi pencarian */
    }
  }

  // Way/relation yang sudah membawa center dari Overpass tidak perlu request
  // ulang; tandai sumbernya secara eksplisit agar lolos gate sebagai entity.
  if (!force && type !== "node") {
    const storedLat = Number(lead.latitude);
    const storedLon = Number(lead.longitude);
    const storedIsOsm =
      !clean(lead.coordinateSource) ||
      /^OpenStreetMap\b/i.test(clean(lead.coordinateSource));
    if (
      storedIsOsm &&
      validCoordinate(storedLat, storedLon) &&
      !isRegionCoordinateSource(lead.coordinateSource)
    ) {
      return {
        lat: storedLat,
        lon: storedLon,
        displayName: clean(lead.coordinateAddress || lead.name).slice(0, 300),
        source: `OpenStreetMap ${type} (pusat elemen)`,
      };
    }
  }

  try {
    const endpoint =
      type === "node"
        ? `https://api.openstreetmap.org/api/0.6/node/${osmId}.json`
        : `https://api.openstreetmap.org/api/0.6/${type}/${osmId}/full.json`;
    const response = await fetch(endpoint, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const center = osmElementCenter(body?.elements, type, osmId);
    const element = center?.element;
    const tags = element?.tags || {};
    if (
      !center ||
      !validCoordinate(center.lat, center.lon) ||
      !coordinateCandidateMatchesName(
        lead.name,
        tags.name || tags.operator || tags.brand,
      )
    ) {
      return null;
    }
    const result = {
      lat: center.lat,
      lon: center.lon,
      displayName: clean(
        tags["addr:full"] ||
          [
            tags["addr:street"],
            tags["addr:housenumber"],
            tags["addr:subdistrict"],
            tags["addr:city"],
          ]
            .filter(Boolean)
            .join(", "),
      ).slice(0, 300),
      source:
        type === "node"
          ? "OpenStreetMap node"
          : `OpenStreetMap ${type} (pusat elemen)`,
    };
    await writeMeta(db, cacheKey, JSON.stringify(result)).catch(() => undefined);
    return result;
  } catch {
    return null;
  }
}

/**
 * Perbaiki satu koordinat tanpa menjalankan panel AI. Untuk lead OSM, titik
 * diambil ulang langsung dari elemen OSM berdasarkan id dan nama entitas.
 * Fallback geocoder tetap memakai pencocokan nama yang ketat.
 */
export async function repairLeadCoordinate(db, leadId, options = {}) {
  await ensureCorporateSchema(db);
  const row = await db
    .prepare(
      "SELECT id, name, city, area, category, latitude, longitude, coordinate_address, coordinate_source FROM corporate_leads WHERE id = ?",
    )
    .bind(leadId)
    .first()
    .catch(() => null);
  if (!row) return { repaired: false, reason: "Lead tidak ditemukan." };
  const lead = rowToLead(row);
  if (/^Dikonfirmasi manual\b/i.test(clean(lead.coordinateSource))) {
    return { repaired: false, reason: "Koordinat sudah dikonfirmasi manual." };
  }

  let coordinate = await osmEntityCoordinate(db, lead, { force: true });
  if (!coordinate) {
    const address =
      clean(lead.coordinateAddress) ||
      [clean(lead.area), clean(lead.city)].filter(Boolean).join(", ");
    coordinate = await geocodeAddress(db, address, lead.name);
  }
  if (!coordinate) return { repaired: false, reason: "Titik entitas belum ditemukan." };

  const nextLat = Number(coordinate.lat);
  const nextLon = Number(coordinate.lon);
  if (!validCoordinate(nextLat, nextLon)) {
    return { repaired: false, reason: "Titik entitas tidak valid." };
  }
  const nextSource = clean(coordinate.source);
  const nextAddress = clean(coordinate.displayName) || clean(lead.coordinateAddress);
  const alreadySame =
    Number(lead.latitude) === nextLat &&
    Number(lead.longitude) === nextLon &&
    clean(lead.coordinateSource) === nextSource;
  if (alreadySame) {
    return { repaired: false, reason: "Koordinat sudah benar." };
  }

  await db
    .prepare(
      `UPDATE corporate_leads
       SET latitude = ?, longitude = ?, coordinate_address = ?, coordinate_source = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextLat, nextLon, nextAddress, nextSource, new Date().toISOString(), lead.id)
    .run();
  return {
    repaired: true,
    leadId: lead.id,
    latitude: nextLat,
    longitude: nextLon,
    coordinateSource: nextSource,
  };
}

/**
 * Perbaiki koordinat secara batch. Lead yang masih belum punya titik entitas
 * tetap ditahan dari Publish/Telegram/Prospek oleh gate yang sama.
 */
export async function repairCorporateCoordinates(db, limit = 20) {
  await ensureCorporateSchema(db);
  const rows = await db
    .prepare(
      "SELECT id, name, city, area, category, latitude, longitude, coordinate_address, coordinate_source FROM corporate_leads ORDER BY RANDOM()",
    )
    .all()
    .catch(() => ({ results: [] }));
  const leads = (rows.results ?? []).map(rowToLead);
  const candidates = leads.filter(
    (lead) =>
      !coordinateReadyForPublish(lead) &&
      !/^Dikonfirmasi manual\b/i.test(clean(lead.coordinateSource)),
  );
  const batch = candidates.slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));
  let repaired = 0;
  for (const lead of batch) {
    try {
      const result = await repairLeadCoordinate(db, lead.id);
      if (result.repaired) repaired += 1;
    } catch (error) {
      console.error(
        "corporate_coordinate_repair_error",
        lead.id,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return {
    processed: batch.length,
    repaired,
    failed: batch.length - repaired,
    remaining: Math.max(0, candidates.length - repaired),
  };
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
  const decisionRoles =
    lead.category === "hotel"
      ? "IT Manager, Network Engineer, Chief Engineer, General Manager, atau pemilik/pengelola hotel"
      : lead.category === "school"
        ? "Kepala Sekolah, Wakil Kepala Sekolah, Kepala IT, Operator/Teknisi Jaringan, atau Kepala Laboratorium Komputer"
        : "IT Manager, Kepala IT, Network Engineer, IT Support, General Manager, atau pemilik/pengelola perusahaan";
  const profilePromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Cari profil resmi ${prompt}. Temukan website resmi, alamat lengkap, kota, dan koordinat lokasi. Prioritaskan website resmi, halaman kontak, Google Business, atau OpenStreetMap. Jangan memakai LinkedIn/Facebook/Instagram sebagai website resmi.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Scout: fokus pada identitas organisasi, website resmi, alamat, dan koordinat.`,
    outputSchema: PROFILE_SCHEMA,
  });
  const contactPromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Cari PIC yang dapat mengambil keputusan di ${prompt}. Prioritas: ${decisionRoles}. Temukan nama lengkap, jabatan, e-mail, dan nomor telepon/WhatsApp yang dipublikasikan di website resmi, halaman tim, LinkedIn profesional publik, atau direktori bisnis. Nomor PIC harus nomor yang secara eksplisit dihubungkan dengan nama/jabatan PIC; jangan memakai nomor kantor pusat, resepsionis, atau customer service jika ada nomor PIC langsung. Sebutkan sumber yang mendukung nama, jabatan, dan nomor tersebut.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Contact Finder: fokus pada orang yang tepat, jabatan, e-mail, dan nomor telepon. Jangan memakai data pribadi non-bisnis. Jangan mengarang atau menggabungkan nama dari satu sumber dengan nomor dari sumber lain tanpa bukti yang menghubungkannya.`,
    outputSchema: CONTACT_SCHEMA,
  });
  // Verifier berjalan bersamaan, bukan menunggu dua agen lain. Ia memeriksa
  // ulang sumber publik sendiri agar hasil tetap independen.
  const verifierPromise = exaAnswer(env, {
    model: "exa-pro",
    query: `Lakukan verifikasi independen untuk ${prompt}. Temukan dan periksa langsung website resmi, nama PIC atau pimpinan yang mengambil keputusan, jabatan, e-mail, nomor telepon/WhatsApp, alamat, dan koordinat. Prioritaskan ${decisionRoles}. Pastikan nomor telepon benar-benar milik PIC, bukan hanya nomor umum perusahaan. Jangan mengandalkan ringkasan agen lain. Buang klaim tanpa sumber publik; tandai konflik dan isi kosong/0 bila tidak yakin.`,
    systemPrompt: `${COMMON_RULES} Anda adalah Verifier independen. Bersikap skeptis, periksa sumber publik sendiri, dan hanya setujui data yang benar-benar didukung. Tolak nama atau nomor yang hanya muncul di direktori tanpa bukti keterkaitan dengan entitas.`,
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
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence, screening_status, screening_evidence, screening_checked_at, screening_reviewed_at, screening_reviewed_by FROM corporate_leads WHERE id = ?",
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
      site = await readPublicText(website, 8);
    } catch {
      /* website tidak bisa dibaca; validasi akan gagal */
    }
  }
  // Halaman sumber PIC yang diberikan kandidat harus benar-benar dibaca,
  // bukan hanya homepage. Tanpa ini nomor PIC di halaman profil bisa gagal
  // berpasangan dengan namanya karena halaman tersebut tidak ikut dijelajahi.
  const contactHintUrl = clean(lead.contactUrl);
  if (
    contactHintUrl &&
    hostOf(contactHintUrl) === siteHost &&
    !site.pages.some((page) => normalizeUrl(page.url) === normalizeUrl(contactHintUrl))
  ) {
    try {
      const hintPage = await readPublicText(contactHintUrl, 1);
      const page = hintPage.pages?.[0];
      if (page) {
        site.pages.push(page);
        site.text = `${site.text} ${page.text || ""}`.trim();
      }
    } catch {
      /* halaman hint tidak bisa dibaca; panel tetap dipakai */
    }
  }
  const openosint = await openosintPromise;

  const email = clean(verifier.email || contact.email || lead.email).toLowerCase();
  // Petunjuk kandidat yang sudah dibaca dari sumber publik diprioritaskan,
  // lalu tetap diverifikasi terhadap halaman resmi. Panel tidak boleh
  // menimpa nomor PIC dengan nomor sekolah/kantor yang lebih generik.
  const phoneCandidate = clean(lead.phone || verifier.phone || contact.phone);
  const phone = formatPicPhones(phoneCandidate, 2) || phoneCandidate;
  const personName = sanitizePicName(
    lead.contactName || verifier.personName || contact.personName,
  );
  // Agen Klarifikasi kelima: screening sanksi/PEP untuk nama perusahaan dan
  // nama PIC. Ini bukan verifikasi kepemilikan nomor/e-mail; hasilnya menjadi
  // bukti tambahan yang harus dibaca bersama bukti kontak lain.
  const screening = await screenLeadOpenSanctions(
    db,
    { ...lead, name: lead.name, contactName: personName },
    env,
  );
  const role = clean(lead.contactRole || verifier.role || contact.role);
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
  // Sitasi panel dari website resmi atau profil bisnis (LinkedIn) boleh
  // dipakai untuk mengikat nama PIC ke nomor, tetapi direktori/agregator
  // generik tidak boleh menjadi bukti nomor PIC.
  const bindingCitations = results.flatMap((result) =>
    (result?.citations || []).filter((citation) => {
      const host = hostOf(citation.url);
      return (
        (siteHost && host === siteHost) ||
        /(^|\.)linkedin\.com$/i.test(host)
      );
    }),
  );

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
  // Nomor harus datang dari Contact Finder/Verifier (yang diminta mencari
  // nomor PIC), bukan hanya nomor kantor yang kebetulan ada di lead lama.
  const phoneFromPanel = Boolean(clean(verifier.phone || contact.phone));
  // Nomor harus muncul di halaman yang sama dengan nama PIC, bukan sekadar
  // nomor kantor/CS yang ada di website. LinkedIn boleh menjadi sumber nama,
  // tetapi nomor tetap harus terikat ke nama pada halaman resmi.
  // Satu sumber harus memuat nama dan nomor sekaligus. Menggabungkan teks
  // beberapa halaman membuat nama dari halaman "Tentang Kami" bisa tampak
  // berpasangan dengan nomor kantor dari halaman "Kontak".
  const boundPhonePage = boundPicPhoneSource(personName, phone, site.pages || []);
  const boundPhoneCitation =
    boundPhonePage ||
    boundPicPhoneSource(personName, phone, bindingCitations);
  const phoneBoundToPerson = Boolean(boundPhoneCitation);
  const phoneVerified = Boolean(
    hasValidPhone(phone) &&
      phoneFromPanel &&
      (phoneOnSite || phoneInOfficialSource) &&
      phoneBoundToPerson,
  );

  const contactUrl =
    boundPhoneCitation?.url ||
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
  const contactHost = hostOf(contactUrl);
  const personSourceUsable = Boolean(
    contactUrl &&
      (contactHost === siteHost || /(^|\.)linkedin\.com$/i.test(contactHost)),
  );
  const personVerified = Boolean(
    personName && role && (personOnSite || personSourceUsable),
  );

  // Koordinat manual yang sudah dikoreksi manusia tidak boleh ditimpa riset.
  let coordinate = null;
  if (
    coordinateReadyForPublish(lead) &&
    /^Dikonfirmasi manual\b/i.test(clean(lead.coordinateSource))
  ) {
    coordinate = {
      lat: Number(lead.latitude),
      lon: Number(lead.longitude),
      displayName: lead.coordinateAddress || address,
      source: lead.coordinateSource,
    };
  }
  // Node OSM milik entitas lebih kuat daripada hasil geocoding alamat.
  if (!coordinate) coordinate = await osmEntityCoordinate(db, lead);
  if (
    !coordinate &&
    coordinateReadyForPublish(lead) &&
    !isRegionCoordinateSource(lead.coordinateSource)
  ) {
    coordinate = {
      lat: Number(lead.latitude),
      lon: Number(lead.longitude),
      displayName: lead.coordinateAddress || address,
      source: lead.coordinateSource,
    };
  }
  if (!coordinate) {
    coordinate = await geocodeAddress(
      db,
      address || `${lead.name}, ${lead.area ? `${lead.area}, ` : ""}${city}, Indonesia`,
      lead.name,
    );
  }
  // Alamat bisa terlalu umum (mis. hanya nama kota). Coba lagi dengan nama
  // entitas + wilayah agar titik yang dipilih tetap milik entitas yang tepat.
  if (!coordinate) {
    coordinate = await geocodeAddress(
      db,
      `${lead.name}, ${lead.area ? `${lead.area}, ` : ""}${city}, Indonesia`,
      lead.name,
    );
  }
  if (
    !coordinate &&
    validCoordinate(verifier.latitude, verifier.longitude) &&
    inIndonesia(verifier.latitude, verifier.longitude) &&
    coordinateInRegion(lead.city, lead.area, verifier.latitude, verifier.longitude) !== false &&
    verifier.locationVerified === true &&
    coordinateCandidateMatchesName(lead.name, verifier.address)
  ) {
    // Koordinat dari panel verifier tetap berstatus review. Jangan memakai
    // label Nominatim/OpenStreetMap karena itu akan melewati gate tanpa
    // geocoding yang benar-benar mencocokkan entitas.
    coordinate = {
      lat: Number(verifier.latitude),
      lon: Number(verifier.longitude),
      displayName: address,
      source: "Panel AI (verifier, nama cocok)",
    };
  }
  if (
    coordinate &&
    !/^Dikonfirmasi manual\b/i.test(clean(coordinate.source)) &&
    coordinateInRegion(lead.city, lead.area, coordinate.lat, coordinate.lon) === false
  ) {
    coordinate = null;
  }
  const locationVerified = Boolean(
    coordinate &&
      validCoordinate(coordinate.lat, coordinate.lon) &&
      coordinateReadyForPublish({
        ...lead,
        latitude: coordinate.lat,
        longitude: coordinate.lon,
        coordinateSource: coordinate.source,
      }),
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
  // Status kontak sengaja dipisah dari kelengkapan e-mail/website. Untuk
  // Publish, yang wajib adalah PIC + nomor PIC + titik koordinat yang tervalidasi.
  const contactStatus =
    personVerified && phoneVerified && locationVerified
      ? "verified"
      : hasAnyEvidence
        ? "partial"
        : "missing";
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
    evidence.push(
      boundPicPhoneEvidence(personName, phone, contactUrl || website),
    );
  } else if (phoneBoundToPerson) {
    evidence.push(
      "Nomor PIC muncul dekat nama PIC tetapi belum lolos pemeriksaan sumber resmi.",
    );
  } else {
    evidence.push(
      "Nomor PIC tidak terbukti terikat ke nama PIC pada satu halaman resmi; nomor kantor/CS tidak dipakai.",
    );
  }
  evidence.push(
    `Status validasi kontak PIC/koordinat: ${contactStatus}.`,
  );
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
  if (screening.evidence.length > 0) {
    evidence.push(...screening.evidence.slice(0, 3));
  }

  const now = new Date().toISOString();
  const region = regionCoordinate(lead.city, lead.area);
  const screeningFields = screeningFieldsForResearch(lead, screening);
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
    ...screeningFields,
    screeningCheckedAt: screening.checkedAt || now,
  };

  await db
    .prepare(
      `UPDATE corporate_leads
       SET website = ?, email = ?, phone = ?, contact_name = ?, contact_role = ?,
           contact_url = ?, contact_source = ?, latitude = ?, longitude = ?,
           coordinate_address = ?, coordinate_source = ?, validation_status = ?,
           validation_evidence = ?, validated_at = ?, ai_confidence = ?,
           screening_status = ?, screening_evidence = ?, screening_checked_at = ?,
           screening_reviewed_at = ?, screening_reviewed_by = ?, updated_at = ?
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
      nextLead.screeningStatus,
      JSON.stringify(nextLead.screeningEvidence),
      nextLead.screeningCheckedAt,
      nextLead.screeningReviewedAt,
      nextLead.screeningReviewedBy,
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
      contactStatus,
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
      screening: {
        configured: Boolean(screening.configured),
        status: screening.status || "disabled",
        matches: screening.matches || [],
        evidence: screening.evidence || [],
        error: screening.error || "",
        checkedAt: screening.checkedAt || "",
      },
    },
  };
}
