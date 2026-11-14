/**
 * Corporate Engine: menarik data perusahaan, hotel, dan sekolah dari
 * OpenStreetMap (Overpass API) tanpa kunci API, lalu menyimpannya di D1
 * sebagai cache. Data awal dikirim bersama Worker (corporate-seed.json).
 */

import { selectPicPhone } from "./phone.js";

export const CORPORATE_CITIES = [
  { name: "Jakarta", bbox: [-6.37, 106.68, -6.08, 106.97] },
  { name: "Depok", bbox: [-6.49, 106.72, -6.33, 106.9] },
  { name: "Bekasi", bbox: [-6.38, 106.95, -6.18, 107.16] },
  { name: "Kota Bogor", bbox: [-6.66, 106.7, -6.52, 106.87] },
  { name: "Kab. Bogor", bbox: [-6.78, 106.4, -6.43, 107.06] },
  { name: "Tangerang", bbox: [-6.33, 106.53, -6.0, 106.79] },
  { name: "Serang", bbox: [-6.22, 106.02, -5.98, 106.3] },
  { name: "Subang", bbox: [-6.75, 107.3, -6.2, 107.85] },
  { name: "Sukabumi", bbox: [-7.3, 106.5, -6.72, 107.2] },
];

/**
 * Titik pusat wilayah dipakai hanya bila koordinat entitas belum ditemukan.
 * Nilai ini berasal dari bbox wilayah resmi yang dipakai Corporate Engine,
 * sehingga pesan dan peta tetap menunjuk ke wilayah yang benar.
 */
const REGION_COORDINATES = new Map(
  CORPORATE_CITIES.map((city) => [
    city.name,
    {
      latitude: (city.bbox[0] + city.bbox[2]) / 2,
      longitude: (city.bbox[1] + city.bbox[3]) / 2,
    },
  ]),
);

export function regionCoordinate(city, area = "") {
  const region = REGION_COORDINATES.get(clean(city));
  if (!region) return null;
  return {
    latitude: region.latitude,
    longitude: region.longitude,
    coordinateAddress:
      [clean(area), clean(city)].filter(Boolean).join(", ") || clean(city),
    coordinateSource: `Pusat wilayah ${clean(city)}`,
    approximate: true,
  };
}

export function isRegionCoordinateSource(source) {
  return /^Pusat wilayah\b/i.test(clean(source));
}

/**
 * True/false bila kota dikenal; null bila kota tidak ada di daftar wilayah.
 * Padding kecil memberi ruang untuk entitas di pinggir bbox.
 */
export function coordinateInRegion(city, latitude, longitude, padding = 0.08) {
  const region = CORPORATE_CITIES.find((item) => item.name === clean(city));
  if (!region) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const [south, west, north, east] = region.bbox;
  return (
    lat >= south - padding &&
    lat <= north + padding &&
    lng >= west - padding &&
    lng <= east + padding
  );
}

/** Koordinat entitas bila ada; jika belum, pusat wilayah lead. */
export function resolveLeadCoordinates(lead = {}) {
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  const exact =
    !isRegionCoordinateSource(lead.coordinateSource) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0) &&
    coordinateInRegion(lead.city, latitude, longitude) !== false;
  if (exact) {
    return {
      latitude,
      longitude,
      coordinateAddress: clean(lead.coordinateAddress),
      coordinateSource: clean(lead.coordinateSource) || "Koordinat tersimpan",
      approximate: false,
    };
  }
  return regionCoordinate(lead.city, lead.area);
}

export const CORPORATE_CATEGORIES = [
  {
    key: "hotel",
    selector: 'nwr["tourism"~"^(hotel|guest_house|hostel|motel)$"]',
    fetchLimit: 120,
    keep: 30,
  },
  {
    key: "school",
    selector: 'nwr["amenity"~"^(school|college|university)$"]',
    fetchLimit: 120,
    keep: 30,
  },
  {
    key: "company",
    selector: 'nwr["office"]',
    fetchLimit: 160,
    keep: 38,
  },
];

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const USER_AGENT =
  "HalloPane/1.0 (Corporate Engine; +https://site-112732548e6d4039b0803f571aea6817.freebuff.page)";
const REFRESH_MIN_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25000;

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS corporate_leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_role TEXT NOT NULL DEFAULT '',
    contact_url TEXT NOT NULL DEFAULT '',
    contact_source TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL DEFAULT 0,
    longitude REAL NOT NULL DEFAULT 0,
    coordinate_address TEXT NOT NULL DEFAULT '',
    coordinate_source TEXT NOT NULL DEFAULT '',
    validation_status TEXT NOT NULL DEFAULT '',
    validation_evidence TEXT NOT NULL DEFAULT '[]',
    validated_at TEXT NOT NULL DEFAULT '',
    ai_confidence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_city_refresh (
    city TEXT PRIMARY KEY,
    refreshed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_email_lookup (
    id TEXT PRIMARY KEY,
    attempted_at TEXT NOT NULL,
    found TEXT NOT NULL DEFAULT '',
    found_phone TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

let schemaPromise;

export async function ensureCorporateSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const sql of SCHEMA_SQL) {
        await db.prepare(sql).run();
      }
      // Database lama belum punya kolom nomor PIC; tambahkan tanpa menghapus data.
      try {
        await db
          .prepare("ALTER TABLE corporate_email_lookup ADD COLUMN found_phone TEXT NOT NULL DEFAULT ''")
          .run();
      } catch {
        /* kolom sudah ada */
      }
      // Kolom kontak person IT ditambahkan bertahap agar database lama tetap aman.
      for (const column of [
        "area TEXT NOT NULL DEFAULT ''",
        "contact_name TEXT NOT NULL DEFAULT ''",
        "contact_role TEXT NOT NULL DEFAULT ''",
        "contact_url TEXT NOT NULL DEFAULT ''",
        "contact_source TEXT NOT NULL DEFAULT ''",
        "latitude REAL NOT NULL DEFAULT 0",
        "longitude REAL NOT NULL DEFAULT 0",
        "coordinate_address TEXT NOT NULL DEFAULT ''",
        "coordinate_source TEXT NOT NULL DEFAULT ''",
        "validation_status TEXT NOT NULL DEFAULT ''",
        "validation_evidence TEXT NOT NULL DEFAULT '[]'",
        "validated_at TEXT NOT NULL DEFAULT ''",
        "ai_confidence INTEGER NOT NULL DEFAULT 0",
      ]) {
        try {
          await db.prepare(`ALTER TABLE corporate_leads ADD COLUMN ${column}`).run();
        } catch {
          /* kolom sudah ada */
        }
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function normalizeWebsite(value) {
  const raw = clean(value);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".")) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function score(lead) {
  return (
    (lead.email ? 4 : 0) +
    (lead.website ? 2 : 0) +
    (lead.phone ? 1 : 0) +
    (lead.contactName ? 2 : 0)
  );
}

export function normalizeElements(elements, city, category, keep) {
  const leads = [];
  for (const element of elements || []) {
    const tags = element.tags || {};
    const name = clean(tags.name || tags["name:en"] || tags.operator || tags.brand);
    if (!name || name.length > 160) continue;
    const email = clean(tags.email || tags["contact:email"]).toLowerCase();
    const phone = clean(
      tags.phone || tags["contact:phone"] || tags["contact:mobile"] || tags.mobile,
    )
      .split(";")[0]
      .trim()
      .slice(0, 60);
    const website = normalizeWebsite(tags.website || tags["contact:website"] || tags.url);
    const center = element.center || {};
    const latitude = Number(center.lat);
    const longitude = Number(center.lon);
    const coordinateAddress = clean(
      tags["addr:full"] ||
        [
          tags["addr:street"],
          tags["addr:subdistrict"],
          tags["addr:district"],
          tags["addr:city"],
          tags["addr:province"],
        ]
          .filter(Boolean)
          .join(", "),
    ).slice(0, 300);
    const area = clean(
      tags["addr:subdistrict"] ||
        tags["addr:district"] ||
        tags["addr:city"] ||
        tags["addr:village"] ||
        tags["addr:hamlet"] ||
        tags["addr:place"],
    ).slice(0, 80);
    leads.push({
      id: `osm:${element.type}/${element.id}`,
      name,
      city,
      area,
      category,
      email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? email : "",
      phone,
      website,
      contactName: "",
      contactRole: "",
      contactUrl: "",
      contactSource: "",
      latitude: Number.isFinite(latitude) ? latitude : 0,
      longitude: Number.isFinite(longitude) ? longitude : 0,
      coordinateAddress,
      coordinateSource: Number.isFinite(latitude) && Number.isFinite(longitude) ? "OpenStreetMap" : "",
    });
  }
  leads.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "id"));
  return leads.slice(0, keep);
}

function cityByName(name) {
  return CORPORATE_CITIES.find((city) => city.name === name) ?? null;
}

async function overpass(selector, bbox, limit) {
  const query = `[out:json][timeout:45];\n${selector}(${bbox});\nout center ${limit};`;
  let lastError = new Error("Sumber data publik tidak merespons");

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastError = new Error(`Overpass menolak permintaan (${response.status})`);
        continue;
      }
      const body = await response.json();
      return Array.isArray(body?.elements) ? body.elements : [];
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  throw lastError;
}

/**
 * Ambil lead segar satu kota. Bila salah satu kategori gagal, kategori itu
 * dilaporkan agar data lama tidak ikut terhapus.
 */
export async function fetchCityLeads(cityName) {
  const city = cityByName(cityName);
  if (!city) throw new Error("Kota tidak dikenal");

  const results = await Promise.allSettled(
    CORPORATE_CATEGORIES.map(async (category) => {
      const elements = await overpass(category.selector, city.bbox.join(","), category.fetchLimit);
      return {
        category: category.key,
        leads: normalizeElements(elements, city.name, category.key, category.keep),
      };
    }),
  );

  const leads = [];
  const succeeded = [];
  const failed = [];
  results.forEach((result, index) => {
    const key = CORPORATE_CATEGORIES[index].key;
    if (result.status === "fulfilled") {
      succeeded.push(key);
      leads.push(...result.value.leads);
    } else {
      failed.push(key);
      console.error(
        "corporate_overpass_error",
        key,
        result.reason instanceof Error ? result.reason.message : "unknown",
      );
    }
  });

  if (succeeded.length === 0) {
    throw new Error("Sumber data publik tidak merespons");
  }

  const seen = new Set();
  return {
    city: city.name,
    leads: leads.filter((lead) => {
      if (seen.has(lead.id)) return false;
      seen.add(lead.id);
      return true;
    }),
    failed,
  };
}

export function rowToLead(row) {
  const coordinate = resolveLeadCoordinates({
    latitude: row.latitude,
    longitude: row.longitude,
    coordinateAddress: row.coordinate_address,
    coordinateSource: row.coordinate_source,
    city: row.city,
    area: row.area,
  });
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    area: row.area || "",
    category: row.category,
    email: row.email || "",
    phone: row.phone || "",
    website: row.website || "",
    contactName: sanitizePicName(row.contact_name),
    contactRole: row.contact_role || "",
    contactUrl: row.contact_url || "",
    contactSource: row.contact_source || "",
    latitude: coordinate?.latitude || 0,
    longitude: coordinate?.longitude || 0,
    coordinateAddress:
      row.coordinate_address || coordinate?.coordinateAddress || "",
    coordinateSource: row.coordinate_source || coordinate?.coordinateSource || "",
    validationStatus: row.validation_status || "",
    validationEvidence: parseJsonList(row.validation_evidence),
    validatedAt: row.validated_at || "",
    aiConfidence: Number(row.ai_confidence) || 0,
  };
}

/**
 * Data awal dimasukkan sekali ke D1 agar robot email bisa memeriksa seluruh
 * lead, bukan hanya wilayah yang sudah pernah disegarkan.
 */
async function ensureSeedRows(db, seed) {
  const marker = await db
    .prepare("SELECT value FROM corporate_meta WHERE key = 'seed_version'")
    .first();
  if (marker?.value === seed.generatedAt) return;

  for (let offset = 0; offset < seed.leads.length; offset += 40) {
    const statements = seed.leads.slice(offset, offset + 40).map((lead) =>
      db
        .prepare(
          `INSERT INTO corporate_leads (id, name, city, area, category, email, phone, website, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             area = CASE WHEN corporate_leads.area = '' THEN excluded.area ELSE corporate_leads.area END,
             email = CASE WHEN corporate_leads.email = '' THEN excluded.email ELSE corporate_leads.email END,
             phone = CASE WHEN corporate_leads.phone = '' THEN excluded.phone ELSE corporate_leads.phone END,
             website = CASE WHEN corporate_leads.website = '' THEN excluded.website ELSE corporate_leads.website END`,
        )
        .bind(
          lead.id,
          lead.name,
          lead.city,
          lead.area || "",
          lead.category,
          lead.email || "",
          lead.phone || "",
          lead.website || "",
          seed.generatedAt,
        ),
    );
    await db.batch(statements);
  }

  await db
    .prepare(
      "INSERT INTO corporate_meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(seed.generatedAt)
    .run();
}

export async function readCorporateLeads(db, seed) {
  await ensureCorporateSchema(db);

  try {
    await ensureSeedRows(db, seed);
  } catch (error) {
    console.error(
      "corporate_seed_write_error",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const refreshRows = await db
    .prepare("SELECT city, refreshed_at FROM corporate_city_refresh")
    .all();
  const refreshed = new Map(
    (refreshRows.results ?? []).map((row) => [row.city, row.refreshed_at]),
  );

  const result = await db
    .prepare(
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence FROM corporate_leads",
    )
    .all();
  const cacheByCity = new Map();
  for (const row of result.results ?? []) {
    const list = cacheByCity.get(row.city) ?? [];
    list.push(rowToLead(row));
    cacheByCity.set(row.city, list);
  }

  const leads = [];
  const cities = CORPORATE_CITIES.map((city) => {
    const updatedAt = refreshed.get(city.name) ?? seed.generatedAt;
    const cached = cacheByCity.get(city.name);
    if (cached?.length) {
      leads.push(...cached);
    } else {
      for (const lead of seed.leads) {
        if (lead.city === city.name) leads.push(lead);
      }
    }
    return { name: city.name, updatedAt };
  });

  return {
    leads,
    cities,
    source: "OpenStreetMap",
    seedAt: seed.generatedAt,
  };
}

const CORPORATE_LEAD_FIELDS =
  "id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence";

function companyHost(value) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function normalizeLeadName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pt|cv|tbk|persero|ud|pd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function corporateLeadMissing(lead) {
  const missing = [];
  if (lead.validationStatus !== "verified") missing.push("validasi panel AI");
  if (!lead.website) missing.push("website");
  if (!sanitizePicName(lead.contactName)) missing.push("nama PIC");
  if (!lead.email) missing.push("e-mail PIC");
  if (!lead.phone) missing.push("nomor PIC");
  const coordinate = resolveLeadCoordinates(lead);
  if (
    !coordinate ||
    coordinate.approximate ||
    isRegionCoordinateSource(lead.coordinateSource)
  ) {
    missing.push("koordinat");
  }
  return missing;
}

export function isCorporateLeadComplete(lead) {
  return corporateLeadMissing(lead).length === 0;
}

/** Cari lead Corporate Engine yang paling cocok dengan record Prospek. */
export async function findCorporateLeadForCompany(db, input = {}) {
  await ensureCorporateSchema(db);
  const sourceLeadId = clean(input.sourceLeadId);
  const name = clean(input.name);
  const website = clean(input.website);
  const email = clean(input.email);
  const location = clean(input.location);

  const byId = async (id) => {
    if (!id) return null;
    const row = await db
      .prepare(`SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads WHERE id = ?`)
      .bind(id)
      .first();
    return row ? rowToLead(row) : null;
  };

  const direct = await byId(sourceLeadId);
  if (direct) return direct;

  const nameKey = normalizeLeadName(name);
  const targetHost = companyHost(website) || companyHost(email.split("@")[1] || "");
  let rows = [];
  if (name) {
    const result = await db
      .prepare(
        `SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads
         WHERE lower(name) = lower(?) ORDER BY updated_at DESC LIMIT 20`,
      )
      .bind(name)
      .all();
    rows = result.results ?? [];
  }
  if (rows.length === 0 && targetHost) {
    const result = await db
      .prepare(
        `SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads
         WHERE website <> '' ORDER BY updated_at DESC LIMIT 300`,
      )
      .all();
    rows = (result.results ?? []).filter((row) => {
      const host = companyHost(row.website);
      return host && host === targetHost;
    });
  }
  let candidates = rows.map(rowToLead);
  if (candidates.length === 0 && nameKey) {
    const result = await db
      .prepare(
        `SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads ORDER BY updated_at DESC LIMIT 1000`,
      )
      .all();
    candidates = (result.results ?? [])
      .map(rowToLead)
      .filter((lead) => normalizeLeadName(lead.name) === nameKey);
  }
  if (candidates.length === 0) return null;

  const score = (lead) => {
    let value = 0;
    if (nameKey && normalizeLeadName(lead.name) === nameKey) value += 8;
    if (targetHost && companyHost(lead.website) === targetHost) value += 6;
    if (email && lead.email && lead.email.toLowerCase() === email.toLowerCase()) value += 4;
    if (
      location &&
      (lead.city.toLowerCase() === location.toLowerCase() ||
        lead.area.toLowerCase().includes(location.toLowerCase()))
    ) {
      value += 2;
    }
    if (lead.validationStatus === "verified") value += 3;
    if (Number(lead.latitude) && Number(lead.longitude)) value += 1;
    return value;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_NOISE =
  /(sentry|wixpress|example\.|yourdomain|domain\.com|email\.com|@2x|\.png$|\.jpe?g$|\.gif$|\.webp$|\.svg$|\.css$|\.js$|godaddy|cloudflare|schema\.org|no-?reply|donotreply)/i;
const CONTACT_HINT =
  /(kontak|contact|hubungi|tentang|about|reach|connect|team|tim|management|manajemen|profil|profile|support|bantuan|perusahaan|company)/i;
const IT_PATH_HINT = /\/it(\/|$|[-_])/i;
const ENRICH_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;
const ENRICH_PAGE_TIMEOUT_MS = 5000;
const ENRICH_MAX_BYTES = 500_000;
const DEEP_MAX_PAGES = 10;
const NORMAL_MAX_PAGES = 3;
const PHONE_CANDIDATE_RE = /(?:\+?62|0)[\s().-]{0,3}\d(?:[\s().-]{0,2}\d){6,12}/g;
const IT_RE =
  /\b(it|i\.t|ict|edp|information technology|teknologi informasi|sysadmin|system administrator|network|jaringan|help ?desk|technical support|support teknis|teknis)\b/i;
const GUESSED_PATHS = [
  "/kontak",
  "/kontak-kami",
  "/contact",
  "/contact-us",
  "/hubungi-kami",
  "/tentang-kami",
  "/about",
  "/about-us",
  "/profil",
  "/profile",
  "/team",
  "/tim",
  "/manajemen",
  "/perusahaan",
  "/it",
  "/divisi-it",
  "/departemen-it",
  "/teknologi-informasi",
  "/support",
];

export function emailsFromHtml(html) {
  const found = new Set();
  for (const match of html.matchAll(EMAIL_RE)) {
    const email = match[0].toLowerCase().replace(/^[._-]+|[._-]+$/g, "");
    if (email.length > 80 || EMAIL_NOISE.test(email)) continue;
    found.add(email);
  }
  return [...found];
}

/** Email kadang ditulis "nama [at] domain [dot] com" agar tidak di-scrape. */
function decodeObfuscated(html) {
  return html
    .replace(/&#(?:64|x40);/gi, "@")
    .replace(/&#(?:46|x2e);/gi, ".")
    .replace(/&commat;/gi, "@")
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
}

function rankEmail(email, host) {
  const domain = email.split("@")[1] ?? "";
  let value = 0;
  if (host && domain.includes(host)) value += 6;
  if (/^(info|sales|marketing|reservation|contact|admin|hrd|corporate|event|reservasi|cs)/.test(email)) {
    value += 3;
  }
  if (/^(it|ict|support|helpdesk|sysadmin)@/.test(email)) value += 2;
  if (/@(gmail|yahoo|hotmail|outlook)\./.test(email)) value += 1;
  return value;
}

function contactLinks(html, baseUrl, limit = 2) {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./i, "");
  const links = new Set();
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = match[1];
    if (!CONTACT_HINT.test(href) && !IT_PATH_HINT.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (url.hostname.replace(/^www\./i, "") !== host) continue;
      links.add(url.toString());
    } catch {
      /* tautan tidak valid */
    }
  }
  return [...links].slice(0, limit);
}

function beforeLabel(html, index) {
  const start = Math.max(0, (index ?? 0) - 90);
  return html
    .slice(start, index ?? 0)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nomor Indonesia dinormalkan ke format lokal 08…/021… agar konsisten. */
function normalizePhone(raw) {
  const selected = selectPicPhone(raw);
  if (!selected) return "";
  let digits = selected
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "")
    .replace(/\D/g, "");
  if (digits.startsWith("620")) digits = `62${digits.slice(3)}`;
  if (digits.startsWith("62")) digits = `0${digits.slice(2)}`;
  if (!digits.startsWith("0")) return "";
  if (digits.length < 9 || digits.length > 14) return "";
  if (!/^0(8[1-9]\d{6,11}|2[1-9]\d{6,9}|[3-9][1-9]\d{5,9})$/.test(digits)) return "";
  return digits;
}

function phoneScore(number, label) {
  let value = 0;
  if (IT_RE.test(label)) value += 9;
  if (/(pic|contact person|kontak person|narahubung|penanggung jawab)/i.test(label)) value += 6;
  if (/(whatsapp|\bwa\b|handphone|\bhp\b|mobile|seluler)/i.test(label)) value += 4;
  if (/(telp|telepon|phone|hubungi|call|kantor|office)/i.test(label)) value += 2;
  if (/(direktur|manager|manajer|hrd|purchasing|procurement|pengadaan)/i.test(label)) value += 2;
  if (/(fax|faks|faksimili)/i.test(label)) value -= 12;
  if (/^08[1-9]/.test(number)) value += 2;
  return value;
}

const IT_ROLE_RE =
  /\b(?:chief technology officer|cto|head of (?:it|ict|technology)|kepala (?:divisi )?(?:it|ict|teknologi informasi)|(?:it|ict|edp|information technology|teknologi informasi)\s+(?:manager|manajer|head|lead|supervisor|support|staff|specialist|officer|administrator|admin|engineer|security|infrastructure)|(?:manager|manajer)\s+(?:it|ict)|network\s+(?:engineer|administrator|admin)|system administrator|sysadmin|help ?desk|technical support|support teknis|teknisi)\b/i;
const ROLE_QUALIFIER_RE =
  /((?:senior|junior|lead|head|chief|assistant|deputy|vice|general|manager|manajer|kepala|koordinator|coordinator|supervisor|officer|staff|specialist|engineer|administrator|admin|support|teknisi)\s+)$/i;
const GENERIC_NAME_WORDS = new Set([
  "it",
  "ict",
  "edp",
  "tim",
  "team",
  "divisi",
  "division",
  "department",
  "departemen",
  "bagian",
  "unit",
  "support",
  "helpdesk",
  "help",
  "desk",
  "network",
  "jaringan",
  "system",
  "sistem",
  "admin",
  "administrator",
  "manager",
  "manajer",
  "kepala",
  "head",
  "chief",
  "officer",
  "director",
  "direktur",
  "contact",
  "kontak",
  "person",
  "info",
  "informasi",
  "security",
  "keamanan",
  "hrd",
  "finance",
  "keuangan",
  "sales",
  "marketing",
  "pemasaran",
  "service",
  "front",
  "office",
  "kantor",
  "reservation",
  "reservasi",
  "event",
  "acara",
  "teknisi",
  "staff",
  "staf",
  "specialist",
  "spesialis",
  "engineer",
  "insinyur",
  "coordinator",
  "koordinator",
  "supervisor",
  "lead",
  "senior",
  "junior",
  "assistant",
  "asisten",
  "deputy",
  "wakil",
  "vice",
  "president",
  "general",
  "operational",
  "operation",
  "technical",
  "digital",
  "data",
  "product",
  "project",
  "guru",
  "dosen",
  "principal",
  "yayasan",
  "sekolah",
  "school",
  "hotel",
  "perusahaan",
  "company",
  "group",
  "grup",
  "indonesia",
  "jakarta",
  "bogor",
  "depok",
  "bekasi",
  "tangerang",
  "serang",
  "subang",
  "sukabumi",
  "kota",
  "kab",
  "jl",
  "jalan",
  "nomor",
  "no",
  "telp",
  "telepon",
  "phone",
  "email",
  "mail",
  "website",
  "www",
  "pt",
  "cv",
  "tbk",
  "persero",
  "ud",
  "pd",
  "bank",
  "koperasi",
  "foundation",
  "university",
  "hospital",
  "clinic",
  "restaurant",
  "cafe",
  "store",
  "toko",
  "travel",
  "tours",
  "agency",
  "consultant",
  "consulting",
  "solution",
  "solutions",
  "technology",
  "technologies",
  "media",
  "studio",
  "property",
  "realestate",
  "estate",
  "insurance",
  "asuransi",
  "notaris",
  "legal",
  "law",
]);

function createBook() {
  return { emails: new Set(), phones: new Map(), people: new Map() };
}

function addPhone(book, raw, label) {
  const number = normalizePhone(raw);
  if (!number) return;
  const score = phoneScore(number, label);
  if (score < 0) return;
  const previous = book.phones.get(number);
  if (previous === undefined || score > previous) book.phones.set(number, score);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToLines(html) {
  const text = String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|address|main|nav)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text)
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

/**
 * Membersihkan nama PIC dari sisa JSON/HTML/sumber riset sebelum ditampilkan
 * atau dikirim. Nama yang benar-benar kosong setelah dibersihkan akan
 * dikembalikan sebagai string kosong agar gate Telegram/Prospek menolaknya.
 */
export function sanitizePicName(value) {
  let text = clean(value)
    .split(/["{}[\]]|personVerified|citations\s*:|confidence\s*:/i)[0]
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/^(?:nama(?:\s+pic)?|name|pic|kontak person|contact person|contact)\s*[:\-–—]\s*/i, "")
    .replace(/[|•·].*$/, " ")
    .replace(/[^\p{L}\p{M}'’.,\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
  if (!/\p{L}/u.test(text)) return "";
  text = text.slice(0, 80).trim();
  return text;
}

function cleanPersonName(value) {
  value = sanitizePicName(value);
  let text = clean(value)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/^(?:nama(?:\s+pic)?|name|pic|kontak person|contact person|contact)\s*[:\-–—]\s*/i, "")
    .replace(/^(?:bapak|ibu|pak|bu|mr|mrs|ms)\.?\s+/i, "")
    .replace(/\s*[|•·].*$/, "")
    .replace(
      /,\s*(?:s\.?kom|s\.?t|m\.?kom|m\.?t|m\.?sc|ir|dr|drs|dra|mm|mba|ph\.?d)\.?(?:\s*,\s*.*)?$/i,
      "",
    )
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
  if (!text) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4 || text.length > 60) return "";
  if (/\d|@|https?:|www\./i.test(text)) return "";
  if (
    words.some((word) =>
      GENERIC_NAME_WORDS.has(word.replace(/[^\p{L}]/gu, "").toLowerCase()),
    )
  ) {
    return "";
  }
  if (!words.every((word) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(word))) return "";
  return words
    .map((word) =>
      word.length > 2 && word === word.toUpperCase()
        ? `${word.charAt(0)}${word.slice(1).toLowerCase()}`
        : word,
    )
    .join(" ");
}

function looksLikePersonName(value) {
  return Boolean(cleanPersonName(value));
}

function extractRole(value) {
  const text = clean(value);
  const match = IT_ROLE_RE.exec(text);
  if (!match) return "";
  const prefix = text.slice(Math.max(0, match.index - 20), match.index);
  const qualifier = prefix.match(ROLE_QUALIFIER_RE);
  return clean(`${qualifier?.[1] ?? ""}${match[0]}`)
    .replace(/^[\s,;|:–—-]+|[\s,;|:–—-]+$/g, "")
    .slice(0, 70);
}

function rolePriority(role) {
  if (/kepala|head|chief|cto|manager|manajer|lead|koordinator|coordinator|supervisor/i.test(role)) {
    return 10;
  }
  if (/network|jaringan|sysadmin|system administrator/i.test(role)) return 8;
  if (/support|help ?desk|teknisi|technical/i.test(role)) return 6;
  return 4;
}

function rankPeople(people) {
  return [...people]
    .sort((a, b) => {
      const official = Number(b.source === "Website resmi") - Number(a.source === "Website resmi");
      return official || rolePriority(b.role) - rolePriority(a.role);
    })
    .slice(0, 6);
}

function addPerson(book, person) {
  const name = cleanPersonName(person?.name);
  const role = extractRole(person?.role) || clean(person?.role).slice(0, 70);
  if (!name || !role) return;
  const key = `${name.toLowerCase()}|${role.toLowerCase()}`;
  if (book.people.has(key)) return;
  book.people.set(key, {
    name,
    role,
    url: clean(person?.url),
    source: clean(person?.source) || "Website resmi",
  });
}

function peopleFromLines(book, html, pageUrl) {
  const lines = htmlToLines(html);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const role = extractRole(line);
    if (!role) continue;

    const parts = line
      .split(/\s*[|•·–—]\s*|\s+-\s+|,\s+/)
      .map(clean)
      .filter(Boolean);
    let name = "";
    for (const part of parts) {
      const candidate = cleanPersonName(part);
      if (candidate) {
        name = candidate;
        break;
      }
    }
    if (!name) {
      for (const neighbor of [lines[index - 1], lines[index + 1]]) {
        const candidate = cleanPersonName(neighbor);
        if (candidate) {
          name = candidate;
          break;
        }
      }
    }
    if (name) addPerson(book, { name, role, url: pageUrl, source: "Website resmi" });
  }
}

function firstPersonUrl(node) {
  const candidates = Array.isArray(node?.sameAs) ? [...node.sameAs, node?.url] : [node?.url, node?.sameAs];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:/i.test(candidate.trim())) return candidate.trim();
  }
  return "";
}

function jsonLdContacts(html) {
  const emails = [];
  const phones = [];
  const people = [];

  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 10) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const jobTitle = clean(node.jobTitle || node.roleName);
    const name = cleanPersonName(node.name);
    if (jobTitle && name && IT_ROLE_RE.test(jobTitle)) {
      people.push({
        name,
        role: extractRole(jobTitle) || jobTitle.slice(0, 70),
        url: firstPersonUrl(node),
        source: "Website resmi",
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        if (/^email$/i.test(key) && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value.trim())) {
          emails.push(value.trim().toLowerCase());
        }
        if (/^(telephone|phone)$/i.test(key)) phones.push(value);
      } else {
        walk(value, depth + 1);
      }
    }
  };

  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1].trim()), 0);
    } catch {
      /* data terstruktur tidak valid */
    }
  }
  return { emails, phones, people };
}

function addContacts(book, html, pageUrl) {
  const decoded = decodeObfuscated(html);
  for (const email of emailsFromHtml(decoded)) book.emails.add(email);

  const structured = jsonLdContacts(html);
  for (const email of structured.emails) book.emails.add(email);
  for (const phone of structured.phones) addPhone(book, phone, "telephone contactPoint");
  for (const person of structured.people) addPerson(book, person);
  peopleFromLines(book, html, pageUrl);

  for (const match of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    addPhone(book, match[1], beforeLabel(html, match.index));
  }
  for (const match of html.matchAll(
    /(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?([0-9+\-.\s]{8,20})/gi,
  )) {
    addPhone(book, match[1], `whatsapp ${beforeLabel(html, match.index)}`);
  }
  for (const match of html.matchAll(PHONE_CANDIDATE_RE)) {
    addPhone(book, match[0], beforeLabel(html, match.index));
  }
}

async function readPage(url, allowXml = false) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: allowXml
          ? "application/xml,text/xml,text/html,application/xhtml+xml"
          : "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(ENRICH_PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("html") && !(allowXml && (type.includes("xml") || type.includes("text/")))) {
      return "";
    }
    const buffer = await response.arrayBuffer();
    return new TextDecoder("utf-8").decode(buffer.slice(0, ENRICH_MAX_BYTES));
  } catch {
    return "";
  }
}

async function mapLimit(items, limit, task) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    const settled = await Promise.allSettled(chunk.map(task));
    for (const result of settled) {
      if (result.status === "fulfilled") results.push(result.value);
    }
  }
  return results;
}

function looksLikeContactPath(pathname) {
  return CONTACT_HINT.test(pathname) || IT_PATH_HINT.test(pathname);
}

async function sitemapPages(base, host) {
  const urls = new Set();
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await readPage(`${base}${path}`, true);
    if (!xml) continue;
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = match[1].replace(/&amp;/gi, "&");
      if (!/^https?:/i.test(loc)) continue;
      try {
        const url = new URL(loc);
        if (url.hostname.replace(/^www\./i, "") !== host) continue;
        if (/\.xml$/i.test(url.pathname)) continue;
        if (!looksLikeContactPath(url.pathname)) continue;
        urls.add(url.toString());
      } catch {
        /* URL sitemap tidak valid */
      }
      if (urls.size >= 40) break;
    }
  }
  return [...urls];
}

/**
 * Cari kontak PIC dari situs resmi: beranda, halaman kontak/tentang/tim,
 * tautan di sitemap, data terstruktur (JSON-LD), tautan tel/WhatsApp, lalu
 * pilih nomor yang paling dekat dengan konteks PIC/IT.
 */
export async function findLeadContacts(website, options = {}) {
  const deep = Boolean(options?.deep);
  const empty = { emails: [], phones: [], people: [], pages: 0 };
  const raw = (website || "").trim();
  if (!raw) return empty;

  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");
  let host = "";
  try {
    host = new URL(base).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return empty;
  }

  let homepage = await readPage(base);
  if (!homepage) homepage = await readPage(base.replace(/^https:/i, "http:"));
  if (!homepage) return empty;

  const book = createBook();
  addContacts(book, homepage, base);

  const candidates = new Set(contactLinks(homepage, base, deep ? 6 : 2));
  for (const path of deep ? GUESSED_PATHS : GUESSED_PATHS.slice(0, NORMAL_MAX_PAGES - 1)) {
    candidates.add(`${base}${path}`);
  }
  if (deep) {
    for (const url of await sitemapPages(base, host)) candidates.add(url);
  }

  const pages = [...candidates]
    .filter((url) => url.replace(/\/+$/, "") !== base)
    .slice(0, deep ? DEEP_MAX_PAGES : NORMAL_MAX_PAGES);
  const loaded = await mapLimit(pages, 4, async (url) => ({ url, html: await readPage(url) }));

  let checked = 1;
  for (const item of loaded) {
    if (!item.html) continue;
    addContacts(book, item.html, item.url);
    checked += 1;
  }

  const emails = [...book.emails]
    .filter((email) => !EMAIL_NOISE.test(email))
    .sort((a, b) => rankEmail(b, host) - rankEmail(a, host));
  const phones = [...book.phones.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([number]) => number);

  return {
    emails: emails.slice(0, 3),
    phones: phones.slice(0, 3),
    people: rankPeople([...book.people.values()]),
    pages: checked,
  };
}

/**
 * Ambil teks publik dari beranda dan beberapa halaman profil/tentang. Dipakai
 * agen Finding untuk menilai sinyal kebutuhan jaringan dari sumber resmi.
 */
export async function readPublicText(website, maxPages = 4) {
  const raw = (website || "").trim();
  if (!raw) return { pages: [], text: "" };
  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");
  const candidates = [
    base,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/tentang-kami`,
    `${base}/profil`,
    `${base}/kontak`,
    `${base}/contact`,
  ].slice(0, Math.max(1, Math.min(6, maxPages)));
  const loaded = await mapLimit(candidates, 3, async (url) => ({
    url,
    html: await readPage(url),
  }));
  const pages = [];
  const chunks = [];
  for (const item of loaded) {
    if (!item.html) continue;
    pages.push(item.url);
    chunks.push(htmlToLines(item.html).join("\n"));
  }
  return { pages, text: chunks.join("\n").slice(0, 20_000) };
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_TIMEOUT_MS = 12_000;
const EXA_ANSWER_TIMEOUT_MS = 15_000;

function exaKey(env) {
  return typeof env?.EXA_API_KEY === "string" ? env.EXA_API_KEY.trim() : "";
}

export async function exaSearch(env, query, options = {}) {
  const key = exaKey(env);
  if (!key) return { enabled: false, results: [], error: "" };
  try {
    const response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: options.numResults ?? 6,
        contents: { highlights: true },
        ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("corporate_exa_error", response.status);
      return { enabled: true, results: [], error: "Pencarian publik sedang tidak tersedia." };
    }
    const body = await response.json();
    return {
      enabled: true,
      results: Array.isArray(body?.results) ? body.results : [],
      error: "",
    };
  } catch (error) {
    console.error(
      "corporate_exa_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return { enabled: true, results: [], error: "Pencarian publik sedang tidak tersedia." };
  }
}

function parseExaAnswer(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Panggilan Exa Answer untuk agen panel riset. Berbeda dari exaSearch yang
 * hanya mengembalikan hasil pencarian, endpoint ini meminta model menyusun
 * jawaban terstruktur dengan sitasi.
 */
export async function exaAnswer(env, options = {}) {
  const key = exaKey(env);
  if (!key) return { enabled: false, answer: null, citations: [], error: "" };
  const query = clean(options.query);
  if (!query) return { enabled: true, answer: null, citations: [], error: "Query kosong." };
  try {
    const response = await fetch(EXA_ANSWER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        model: options.model || "exa-pro",
        text: false,
        userLocation: "ID",
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      }),
      signal: AbortSignal.timeout(Number(options.timeoutMs) || EXA_ANSWER_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error) {
      console.error(
        "corporate_exa_answer_error",
        response.status,
        typeof body?.error === "string" ? body.error.slice(0, 180) : "",
      );
      return {
        enabled: true,
        answer: null,
        citations: [],
        error: "Panel riset publik sedang tidak tersedia.",
      };
    }
    const answer = parseExaAnswer(body?.answer);
    const citations = Array.isArray(body?.citations)
      ? body.citations
          .filter((item) => item && typeof item.url === "string")
          .map((item) => ({
            url: item.url,
            title: clean(item.title),
            text: clean(item.text).slice(0, 1200),
          }))
          .slice(0, 12)
      : [];
    return {
      enabled: true,
      answer,
      citations,
      error: answer ? "" : "Panel tidak mengembalikan jawaban terstruktur.",
    };
  } catch (error) {
    console.error(
      "corporate_exa_answer_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      enabled: true,
      answer: null,
      citations: [],
      error: "Panel riset publik sedang tidak tersedia.",
    };
  }
}

function companyTokens(name) {
  return clean(name)
    .toLowerCase()
    .replace(/\b(?:pt|cv|tbk|persero|ud|pd|hotel|resort|sekolah|school|sma|smk|smp|sd|universitas|university|institut|kampus)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function searchResultMatches(lead, result) {
  const highlights = Array.isArray(result?.highlights) ? result.highlights : [];
  const haystack = `${result?.title ?? ""} ${highlights.join(" ")} ${result?.url ?? ""}`.toLowerCase();
  const tokens = companyTokens(lead.name);
  const city = clean(lead.city).toLowerCase().replace(/^kota\s+/, "");
  const companyMatch = tokens.length === 0 || tokens.some((token) => haystack.includes(token));
  const cityMatch = Boolean(city && haystack.includes(city));
  return companyMatch || cityMatch;
}

function peopleFromSearchResults(lead, results) {
  const people = [];
  const emails = new Set();
  const phones = new Set();
  for (const result of results) {
    if (!result?.url || !searchResultMatches(lead, result)) continue;
    const highlights = Array.isArray(result.highlights) ? result.highlights : [];
    const title = clean(result.title).replace(/\s*[|–—-]\s*LinkedIn.*$/i, "").trim();
    const fullText = clean(`${title} ${highlights.join(" ")}`);
    const role = extractRole(fullText);
    if (!role) continue;

    let name = "";
    for (const part of title.split(/\s+[-–—|]\s+/).map(clean).filter(Boolean)) {
      const candidate = cleanPersonName(part);
      if (candidate) {
        name = candidate;
        break;
      }
    }
    if (!name) {
      const beforeRole = fullText.slice(0, fullText.search(IT_ROLE_RE));
      const candidate = cleanPersonName(beforeRole.split(/[|•·–—]/).pop());
      if (candidate) name = candidate;
    }
    if (!name) continue;

    const isLinkedIn = /linkedin\.com/i.test(result.url);
    people.push({
      name,
      role,
      url: result.url,
      source: isLinkedIn ? "LinkedIn · pencarian publik" : "Pencarian publik",
    });
    for (const email of emailsFromHtml(highlights.join("\n"))) emails.add(email);
    for (const match of highlights.join("\n").matchAll(PHONE_CANDIDATE_RE)) {
      const phone = normalizePhone(match[0]);
      if (phone) phones.add(phone);
    }
  }
  return {
    people: rankPeople(people),
    emails: [...emails].slice(0, 3),
    phones: [...phones].slice(0, 3),
  };
}

async function findWebContacts(env, lead) {
  if (!exaKey(env)) {
    return { enabled: false, people: [], emails: [], phones: [], error: "" };
  }
  const location = clean(lead.city) ? ` ${clean(lead.city)}` : "";
  const [linkedin, web] = await Promise.all([
    exaSearch(
      env,
      `Profil LinkedIn orang yang bekerja di ${lead.name}${location} sebagai IT Manager, Kepala IT, IT Support, Network Engineer, atau System Administrator.`,
      { numResults: 6, includeDomains: ["linkedin.com"] },
    ),
    exaSearch(
      env,
      `Kontak tim IT ${lead.name}${location}: nama, jabatan, email, atau nomor telepon di halaman resmi maupun direktori publik.`,
      { numResults: 6 },
    ),
  ]);
  const combined = peopleFromSearchResults(lead, [...linkedin.results, ...web.results]);
  return {
    enabled: true,
    ...combined,
    error: linkedin.error || web.error || "",
  };
}

/**
 * Robot kontak: setiap kunjungan memeriksa beberapa lead yang belum punya
 * email, nomor PIC, atau nama kontak IT, membaca situsnya, lalu menyimpan
 * hasilnya supaya tidak diulang pada kunjungan berikutnya.
 */
export async function enrichCorporateEmails(db, limit = 6) {
  await ensureCorporateSchema(db);

  const cutoff = new Date(Date.now() - ENRICH_LOOKBACK_MS).toISOString();
  const pending = await db
    .prepare(
      `SELECT l.id, l.name, l.city, l.website, l.email, l.phone, l.contact_name FROM corporate_leads l
       LEFT JOIN corporate_email_lookup e ON e.id = l.id
       WHERE (l.email = '' OR l.phone = '' OR l.contact_name = '') AND l.website <> ''
         AND (e.attempted_at IS NULL OR e.attempted_at < ?)
       ORDER BY (l.email = '' AND l.phone = '' AND l.contact_name = '') DESC, e.attempted_at IS NOT NULL, l.updated_at DESC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();

  const leads = pending.results ?? [];
  const updated = [];
  if (leads.length > 0) {
    const found = await Promise.all(
      leads.map(async (lead) => {
        try {
          return [lead.id, await findLeadContacts(lead.website)];
        } catch {
          return [lead.id, { emails: [], phones: [], people: [] }];
        }
      }),
    );
    const now = new Date().toISOString();
    const statements = [];
    for (const [id, result] of found) {
      const email = result.emails?.[0] ?? "";
      const phone = result.phones?.[0] ?? "";
      const person = result.people?.[0] ?? null;
      statements.push(
        db
          .prepare(
            "INSERT INTO corporate_email_lookup (id, attempted_at, found, found_phone) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET attempted_at = excluded.attempted_at, found = excluded.found, found_phone = excluded.found_phone",
          )
          .bind(id, now, email, phone),
      );
      if (email) {
        statements.push(
          db
            .prepare("UPDATE corporate_leads SET email = ? WHERE id = ? AND email = ''")
            .bind(email, id),
        );
      }
      if (phone) {
        statements.push(
          db
            .prepare("UPDATE corporate_leads SET phone = ? WHERE id = ? AND phone = ''")
            .bind(phone, id),
        );
      }
      if (person) {
        statements.push(
          db
            .prepare(
              `UPDATE corporate_leads SET
                 contact_name = COALESCE(NULLIF(contact_name, ''), ?),
                 contact_role = COALESCE(NULLIF(contact_role, ''), ?),
                 contact_url = COALESCE(NULLIF(contact_url, ''), ?),
                 contact_source = COALESCE(NULLIF(contact_source, ''), ?)
               WHERE id = ?`,
            )
            .bind(person.name, person.role, person.url, person.source, id),
        );
      }
      if (email || phone || person) {
        updated.push({
          id,
          email,
          phone,
          contactName: person?.name ?? "",
          contactRole: person?.role ?? "",
          contactUrl: person?.url ?? "",
          contactSource: person?.source ?? "",
        });
      }
    }
    await db.batch(statements);
  }

  const remainingRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM corporate_leads l
       LEFT JOIN corporate_email_lookup e ON e.id = l.id
       WHERE (l.email = '' OR l.phone = '' OR l.contact_name = '') AND l.website <> ''
         AND (e.attempted_at IS NULL OR e.attempted_at < ?)`,
    )
    .bind(cutoff)
    .first();

  return {
    checked: leads.length,
    found: updated.length,
    remaining: Number(remainingRow?.total ?? 0),
    updated,
  };
}

/**
 * Pencarian mendalam untuk satu perusahaan saat namanya dibuka. Menelusuri
 * beranda, halaman kontak/tentang/tim, sitemap, JSON-LD, dan tautan
 * tel/WhatsApp untuk mendapat email serta nomor PIC (diutamakan IT).
 */
export async function enrichCorporateLead(db, id, env = {}) {
  await ensureCorporateSchema(db);
  const row = await db
    .prepare(
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence FROM corporate_leads WHERE id = ?",
    )
    .bind(id)
    .first();
  if (!row) return null;

  const lead = rowToLead(row);
  let site = { emails: [], phones: [], people: [], pages: 0 };
  if (lead.website) {
    try {
      site = await findLeadContacts(lead.website, { deep: true });
    } catch {
      /* situs tidak bisa dibaca; pencarian publik masih dicoba */
    }
  }

  const web = site.people?.length
    ? { enabled: Boolean(exaKey(env)), people: [], emails: [], phones: [], error: "" }
    : await findWebContacts(env, lead);
  const people = rankPeople([...(site.people ?? []), ...(web.people ?? [])]);
  const person = people[0] ?? null;
  const email = site.emails?.[0] || web.emails?.[0] || "";
  const phone = site.phones?.[0] || web.phones?.[0] || "";
  const now = new Date().toISOString();

  const statements = [
    db
      .prepare(
        "INSERT INTO corporate_email_lookup (id, attempted_at, found, found_phone) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET attempted_at = excluded.attempted_at, found = excluded.found, found_phone = excluded.found_phone",
      )
      .bind(lead.id, now, email, phone),
  ];
  if (email) {
    statements.push(
      db.prepare("UPDATE corporate_leads SET email = ? WHERE id = ?").bind(email, lead.id),
    );
  }
  if (phone) {
    statements.push(
      db.prepare("UPDATE corporate_leads SET phone = ? WHERE id = ?").bind(phone, lead.id),
    );
  }
  if (person) {
    statements.push(
      db
        .prepare(
          "UPDATE corporate_leads SET contact_name = ?, contact_role = ?, contact_url = ?, contact_source = ? WHERE id = ?",
        )
        .bind(person.name, person.role, person.url, person.source, lead.id),
    );
  }
  await db.batch(statements);

  const nextLead = {
    ...lead,
    email: email || lead.email,
    phone: phone || lead.phone,
    contactName: person?.name || lead.contactName,
    contactRole: person?.role || lead.contactRole,
    contactUrl: person?.url || lead.contactUrl,
    contactSource: person?.source || lead.contactSource,
  };

  return {
    lead: nextLead,
    email,
    phone,
    contact: person,
    checked: site.pages,
    found: Boolean(email || phone || person),
    webSearch: { enabled: web.enabled, error: web.error || "" },
  };
}

export async function refreshCorporateCity(db, cityName, seed) {
  const city = cityByName(cityName);
  if (!city) {
    const error = new Error("Kota tidak dikenal");
    error.status = 400;
    throw error;
  }

  await ensureCorporateSchema(db);

  const refreshRow = await db
    .prepare("SELECT refreshed_at FROM corporate_city_refresh WHERE city = ?")
    .bind(city.name)
    .first();
  if (refreshRow?.refreshed_at) {
    const age = Date.now() - Date.parse(refreshRow.refreshed_at);
    if (Number.isFinite(age) && age < REFRESH_MIN_MS) {
      const rows = await db
        .prepare(
          "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source FROM corporate_leads WHERE city = ?",
        )
        .bind(city.name)
        .all();
      return {
        city: city.name,
        leads: (rows.results ?? []).map(rowToLead),
        updatedAt: refreshRow.refreshed_at,
        throttled: true,
      };
    }
  }

  const fresh = await fetchCityLeads(city.name);

  const existingRows = await db
    .prepare(
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source FROM corporate_leads WHERE city = ?",
    )
    .bind(city.name)
    .all();
  const existing = new Map(
    (existingRows.results ?? []).map((row) => [row.id, rowToLead(row)]),
  );
  const seedById = new Map(
    seed.leads.filter((lead) => lead.city === city.name).map((lead) => [lead.id, lead]),
  );

  const merged = new Map();
  for (const lead of fresh.leads) {
    if (!lead.email || !lead.phone || !lead.contactName) {
      const previous = existing.get(lead.id) ?? seedById.get(lead.id);
      if (!lead.area && previous?.area) lead.area = previous.area;
      if (!lead.email && previous?.email) lead.email = previous.email;
      if (!lead.phone && previous?.phone) lead.phone = previous.phone;
      if (!lead.contactName && previous?.contactName) lead.contactName = previous.contactName;
      if (!lead.contactRole && previous?.contactRole) lead.contactRole = previous.contactRole;
      if (!lead.contactUrl && previous?.contactUrl) lead.contactUrl = previous.contactUrl;
      if (!lead.contactSource && previous?.contactSource) lead.contactSource = previous.contactSource;
    }
    merged.set(lead.id, lead);
  }

  const preservedCategories = new Set(fresh.failed);
  for (const lead of [...existing.values(), ...seedById.values()]) {
    if (preservedCategories.has(lead.category) && !merged.has(lead.id)) {
      merged.set(lead.id, lead);
    }
  }

  const leads = [...merged.values()];
  const now = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM corporate_leads WHERE city = ?").bind(city.name),
    db
      .prepare(
        "INSERT INTO corporate_city_refresh (city, refreshed_at) VALUES (?, ?) ON CONFLICT(city) DO UPDATE SET refreshed_at = excluded.refreshed_at",
      )
      .bind(city.name, now),
  ];
  for (const lead of leads) {
    statements.push(
      db
        .prepare(
          `INSERT INTO corporate_leads (id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             city = excluded.city,
             area = CASE WHEN excluded.area = '' THEN corporate_leads.area ELSE excluded.area END,
             category = excluded.category,
             email = CASE WHEN excluded.email = '' THEN corporate_leads.email ELSE excluded.email END,
             phone = CASE WHEN excluded.phone = '' THEN corporate_leads.phone ELSE excluded.phone END,
             website = CASE WHEN excluded.website = '' THEN corporate_leads.website ELSE excluded.website END,
             contact_name = CASE WHEN excluded.contact_name = '' THEN corporate_leads.contact_name ELSE excluded.contact_name END,
             contact_role = CASE WHEN excluded.contact_role = '' THEN corporate_leads.contact_role ELSE excluded.contact_role END,
             contact_url = CASE WHEN excluded.contact_url = '' THEN corporate_leads.contact_url ELSE excluded.contact_url END,
             contact_source = CASE WHEN excluded.contact_source = '' THEN corporate_leads.contact_source ELSE excluded.contact_source END,
             latitude = CASE WHEN excluded.latitude <> 0 THEN excluded.latitude ELSE corporate_leads.latitude END,
             longitude = CASE WHEN excluded.longitude <> 0 THEN excluded.longitude ELSE corporate_leads.longitude END,
             coordinate_address = CASE WHEN excluded.coordinate_address = '' THEN corporate_leads.coordinate_address ELSE excluded.coordinate_address END,
             coordinate_source = CASE WHEN excluded.coordinate_source = '' THEN corporate_leads.coordinate_source ELSE excluded.coordinate_source END,
             updated_at = excluded.updated_at`,
        )
        .bind(
          lead.id,
          lead.name,
          lead.city,
          lead.area || "",
          lead.category,
          lead.email || "",
          lead.phone || "",
          lead.website || "",
          lead.contactName || "",
          lead.contactRole || "",
          lead.contactUrl || "",
          lead.contactSource || "",
          lead.latitude || 0,
          lead.longitude || 0,
          lead.coordinateAddress || "",
          lead.coordinateSource || "",
          now,
        ),
    );
  }
  await db.batch(statements);

  return {
    city: city.name,
    leads,
    updatedAt: now,
    throttled: false,
    failedCategories: fresh.failed,
  };
}
