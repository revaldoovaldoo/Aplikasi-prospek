/**
 * Corporate Engine: menarik data perusahaan, hotel, dan sekolah dari
 * OpenStreetMap (Overpass API) tanpa kunci API, lalu menyimpannya di D1
 * sebagai cache. Data awal dikirim bersama Worker (corporate-seed.json).
 */

import { selectPicPhone } from "./phone.js";

/**
 * Bbox mencakup seluruh batas administratif wilayah, bukan hanya pusat kota.
 * Bila dua bbox beririsan (Gunung Sindur di dalam Kab. Bogor, Cipanas di dalam
 * Kab. Cianjur), lead disimpan pada wilayah dengan bbox terkecil agar label
 * wilayah fokus tidak hilang.
 */
export const CORPORATE_CITIES = [
  { name: "Jakarta", bbox: [-6.37, 106.68, -6.08, 106.97] },
  // Administratif bagian DKI Jakarta; bbox terpisah agar tidak menarik
  // entitas Tangerang/Bekasi lewat laut.
  { name: "Kepulauan Seribu", bbox: [-5.99, 106.33, -5.1, 106.66] },
  { name: "Depok", bbox: [-6.49, 106.72, -6.33, 106.9] },
  { name: "Bekasi", bbox: [-6.38, 106.95, -6.18, 107.16] },
  { name: "Kota Bogor", bbox: [-6.66, 106.7, -6.52, 106.87] },
  // Utara Kab. Bogor (Parung, Gunung Sindur, Ciseeng) sebelumnya di luar bbox.
  { name: "Kab. Bogor", bbox: [-6.81, 106.36, -6.33, 107.08] },
  { name: "Gunung Sindur", bbox: [-6.44, 106.67, -6.34, 106.79] },
  // Seluruh area Tangerang: Kota, Kabupaten, dan Tangerang Selatan.
  { name: "Tangerang", bbox: [-6.42, 106.34, -5.92, 106.8] },
  // Seluruh area Serang: Kota, Kabupaten (termasuk Anyer/Cinangka), Cilegon.
  { name: "Serang", bbox: [-6.32, 105.83, -5.86, 106.36] },
  { name: "Subang", bbox: [-6.77, 107.22, -6.12, 107.92] },
  { name: "Kota Sukabumi", bbox: [-6.96, 106.89, -6.88, 106.96] },
  { name: "Kab. Sukabumi", bbox: [-7.36, 106.38, -6.7, 106.98] },
  { name: "Cipanas", bbox: [-6.76, 106.97, -6.64, 107.1] },
  { name: "Kab. Cianjur", bbox: [-7.52, 106.7, -6.64, 107.56] },
  { name: "Kab. Lebak", bbox: [-7.1, 105.9, -6.32, 106.62] },
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
const DEFAULT_REGION =
  CORPORATE_CITIES.find((city) => city.name === "Jakarta") ?? CORPORATE_CITIES[0];

/** Cocokkan nama kota/wilayah, termasuk “Kota Bogor” dengan “Bogor”. */
function regionNameKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/^(?:kota|kabupaten|kab\.?|kecamatan|kec\.?)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nama populer yang tidak mengandung nama wilayah resmi, mis. "Tangsel".
 * Tanpa alias ini lead sah dari Tangerang Selatan tidak dikenali wilayahnya.
 */
const REGION_ALIASES = {
  tangsel: "tangerang",
  "tangerang selatan": "tangerang",
  "south tangerang": "tangerang",
  cilegon: "serang",
};

function regionAliasKey(value) {
  const key = regionNameKey(value);
  return REGION_ALIASES[key] || key;
}

/**
 * Prefiks "Kota"/"Kabupaten" harus dihormati: "Kabupaten Bogor" bukan
 * "Kota Bogor", meski kunci namanya sama. Tanpa ini area Kab. Bogor bisa
 * dianggap milik Kota Bogor dan label wilayah menjadi salah.
 */
function regionByPrefix(value) {
  const text = clean(value);
  const prefix = /^(kota|kabupaten|kab\.?)\s+/i.exec(text);
  if (!prefix) return null;
  const kind = /^kota/i.test(prefix[1]) ? "Kota" : "Kab.";
  const key = regionNameKey(text);
  return (
    CORPORATE_CITIES.find(
      (city) => city.name.startsWith(kind) && regionNameKey(city.name) === key,
    ) || null
  );
}

function regionByName(value) {
  const target = clean(value).toLowerCase();
  const targetKey = regionAliasKey(value);
  if (!target) return null;
  // Data lama menyimpan "Sukabumi" tanpa membedakan kota dan kabupaten.
  // Hanya nama generik "Sukabumi" yang diarahkan ke kabupaten; "Kota
  // Sukabumi" dan "Kab. Sukabumi" tetap memakai wilayahnya masing-masing.
  if (targetKey === "sukabumi" && !/^(?:kota|kabupaten|kab\.?)\s+/i.test(clean(value))) {
    return CORPORATE_CITIES.find((city) => city.name === "Kab. Sukabumi");
  }
  const prefixed = regionByPrefix(value);
  if (prefixed) return prefixed;
  return (
    CORPORATE_CITIES.find((city) => city.name.toLowerCase() === target) ||
    CORPORATE_CITIES.find((city) => regionAliasKey(city.name) === targetKey) ||
    CORPORATE_CITIES.find((city) => target.includes(city.name.toLowerCase())) ||
    null
  );
}

/**
 * Titik pusat wilayah tidak pernah kosong: kota kosong atau di luar daftar
 * memakai pusat wilayah default, tetap ditandai approximate agar tidak lolos
 * gate koordinat Prospek.
 */
export function regionCoordinate(city, area = "") {
  const cityName = clean(city);
  const areaName = clean(area);
  // Data OSM sering menyimpan kota pencarian (mis. Jakarta) sementara
  // alamat entitas sebenarnya ada di kota lain (mis. Tangerang). Bila area
  // menunjuk wilayah yang berbeda, area lebih dekat ke entitas.
  const cityRegion = regionByName(cityName);
  const areaRegion = regionByName(areaName);
  const matched =
    areaRegion && cityRegion && areaRegion.name !== cityRegion.name
      ? areaRegion
      : cityRegion || areaRegion;
  const region = matched || DEFAULT_REGION;
  const coordinate = REGION_COORDINATES.get(region.name);
  const location = [areaName, cityName].filter(Boolean).join(", ");
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    coordinateAddress: matched
      ? location || region.name
      : location
        ? `${location} (pusat wilayah ${region.name})`
        : region.name,
    coordinateSource: matched
      ? `Pusat wilayah ${region.name}`
      : `Pusat wilayah default ${region.name}`,
    approximate: true,
  };
}

export function isRegionCoordinateSource(source) {
  return /^Pusat wilayah\b/i.test(clean(source));
}

/** Titik pusat bbox wilayah bukan koordinat entitas, apa pun label sumbernya. */
export function isRegionCenterCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  for (const coordinate of REGION_COORDINATES.values()) {
    if (
      Math.abs(lat - coordinate.latitude) < 0.00001 &&
      Math.abs(lon - coordinate.longitude) < 0.00001
    ) {
      return true;
    }
  }
  return false;
}

const NON_ENTITY_COORDINATE_TYPES = new Set([
  "road",
  "street",
  "residential",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
  "motorway",
  "service",
  "unclassified",
  "living_street",
  "pedestrian",
  "footway",
  "cycleway",
  "path",
  "track",
  "bus_stop",
  "parking",
  "parking_space",
  "locality",
  "administrative",
  "city",
  "town",
  "village",
  "suburb",
  "neighbourhood",
  "postcode",
]);

function coordinateNameKey(name) {
  return clean(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(?:pt|cv|tbk|persero|ud|pd)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nama pada hasil geocoder harus memuat nama entitas secara utuh, bukan hanya
 * beberapa kata yang kebetulan sama. Contoh: “Lazuardi Global Islamic Center”
 * tidak boleh dipakai untuk “Lazuardi Global Islamic School”.
 */
export function coordinateCandidateMatchesName(entityName, candidateName) {
  const candidate = coordinateNameKey(candidateName);
  if (!candidate) return false;
  const variants = clean(entityName)
    .split(";")
    .map(coordinateNameKey)
    .filter(Boolean);
  return variants.some(
    (variant) => candidate === variant || candidate.includes(variant),
  );
}

export function isRoadCoordinate(candidate = {}) {
  const type = clean(candidate.type).toLowerCase();
  const category = clean(candidate.class || candidate.category).toLowerCase();
  return (
    NON_ENTITY_COORDINATE_TYPES.has(type) ||
    category === "highway" ||
    category === "boundary" ||
    category === "place"
  );
}

function isManualCoordinateSource(source) {
  return /^Dikonfirmasi manual\b/i.test(clean(source));
}

function isVerifiedCoordinateSource(source) {
  const value = clean(source);
  return (
    isManualCoordinateSource(value) ||
    /^OpenStreetMap (?:node|way|relation)\b/i.test(value) ||
    /^Nominatim\/OpenStreetMap \(nama cocok\)/i.test(value)
  );
}

/** Pusat elemen OSM: node memakai titiknya, way/relation memakai pusat bbox. */
export function osmElementCenter(elements, type, id) {
  const list = Array.isArray(elements) ? elements : [];
  const targetType = clean(type).toLowerCase();
  const targetId = clean(id);
  const element =
    list.find(
      (item) =>
        clean(item?.type).toLowerCase() === targetType &&
        String(item?.id ?? "") === targetId,
    ) || list[0];
  if (!element) return null;
  if (targetType === "node") {
    const lat = Number(element.lat);
    const lon = Number(element.lon);
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, element }
      : null;
  }
  const points = list.filter(
    (item) =>
      Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lon)),
  );
  if (points.length === 0) return null;
  const lats = points.map((item) => Number(item.lat));
  const lons = points.map((item) => Number(item.lon));
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    element,
  };
}

/**
 * Data lama menyimpan sumber “OpenStreetMap” tanpa jenis elemen. Jika id-nya
 * jelas node/way/relation, ubah menjadi sumber entity yang eksplisit.
 */
export function normalizeOsmCoordinateSource(source, id = "") {
  const value = clean(source);
  if (!/^OpenStreetMap$/i.test(value)) return value;
  const match = /^osm:(node|way|relation)\//i.exec(clean(id));
  if (!match) return value;
  const type = match[1].toLowerCase();
  return type === "node"
    ? "OpenStreetMap node"
    : `OpenStreetMap ${type} (pusat elemen)`;
}

/** Status koordinat untuk gerbang Telegram, Prospek, dan tampilan dashboard. */
export function coordinateReviewStatus(lead = {}) {
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  const source = normalizeOsmCoordinateSource(
    lead.coordinateSource,
    lead.sourceLeadId || lead.id,
  );
  const manual = isManualCoordinateSource(source);
  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0) &&
    (manual || coordinateInRegion(lead.city, lead.area, latitude, longitude) !== false);
  if (!valid) return "missing";
  if (!manual && isRegionCoordinateSource(source)) return "missing";
  // Beberapa data lama memberi label OpenStreetMap pada titik pusat wilayah.
  // Label sumber saja tidak cukup; titik pusat tidak boleh lolos Publish.
  if (!manual && isRegionCenterCoordinate(latitude, longitude)) return "missing";
  return isVerifiedCoordinateSource(source) ? "verified" : "review";
}

/** Hanya koordinat entitas yang sudah jelas sumbernya yang boleh dipublikasikan. */
export function coordinateReadyForPublish(lead = {}) {
  return coordinateReviewStatus(lead) === "verified";
}

/**
 * True/false bila kota/wilayah dikenal; null bila keduanya tidak dikenali.
 * City dicoba lebih dulu, lalu area. Padding kecil memberi ruang untuk
 * entitas di pinggir bbox.
 */
export function coordinateInRegion(city, area, latitude, longitude, padding = 0.08) {
  const regions = [regionByName(city), regionByName(area)].filter(
    (region, index, list) => region && list.findIndex((item) => item?.name === region.name) === index,
  );
  if (regions.length === 0) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return regions.some((region) => {
    const [south, west, north, east] = region.bbox;
    return (
      lat >= south - padding &&
      lat <= north + padding &&
      lng >= west - padding &&
      lng <= east + padding
    );
  });
}

/** Koordinat entitas bila ada; jika belum, pusat wilayah lead/default. */
export function resolveLeadCoordinates(lead = {}) {
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  const source = normalizeOsmCoordinateSource(
    lead.coordinateSource,
    lead.sourceLeadId || lead.id,
  );
  const manual = isManualCoordinateSource(source);
  const exact =
    !isRegionCoordinateSource(source) &&
    (manual || !isRegionCenterCoordinate(latitude, longitude)) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0) &&
    (manual || coordinateInRegion(lead.city, lead.area, latitude, longitude) !== false);
  if (exact) {
    return {
      latitude,
      longitude,
      coordinateAddress: clean(lead.coordinateAddress),
      coordinateSource: source || "Koordinat tersimpan",
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
// Naikkan versi ini bila cara membaca data OSM berubah (mis. perbaikan
// koordinat), agar cache lama otomatis ditarik ulang, bukan dianggap segar.
const REFRESH_DATA_VERSION = 3;
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
    screening_status TEXT NOT NULL DEFAULT '',
    screening_evidence TEXT NOT NULL DEFAULT '[]',
    screening_checked_at TEXT NOT NULL DEFAULT '',
    screening_reviewed_at TEXT NOT NULL DEFAULT '',
    screening_reviewed_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_city_refresh (
    city TEXT PRIMARY KEY,
    refreshed_at TEXT NOT NULL,
    bbox TEXT NOT NULL DEFAULT ''
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

// Naikkan bila SCHEMA_SQL/kolom berubah. Penanda ini mencegah ~25 pernyataan
// DDL dijalankan ulang setiap isolate dingin, karena setiap pernyataan DDL
// ikut dihitung sebagai penulisan database harian.
const SCHEMA_VERSION = "4";

export async function ensureCorporateSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        const marker = await db
          .prepare("SELECT value FROM corporate_meta WHERE key = 'schema_version'")
          .first();
        if (marker?.value === SCHEMA_VERSION) return;
      } catch {
        /* tabel corporate_meta belum ada */
      }
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
        "screening_status TEXT NOT NULL DEFAULT ''",
        "screening_evidence TEXT NOT NULL DEFAULT '[]'",
        "screening_checked_at TEXT NOT NULL DEFAULT ''",
        "screening_reviewed_at TEXT NOT NULL DEFAULT ''",
        "screening_reviewed_by TEXT NOT NULL DEFAULT ''",
      ]) {
        try {
          await db.prepare(`ALTER TABLE corporate_leads ADD COLUMN ${column}`).run();
        } catch {
          /* kolom sudah ada */
        }
      }
      // Simpan bbox yang dipakai saat refresh. Bila cakupan wilayah diperluas,
      // cache lama tidak boleh dipakai karena akan menyembunyikan wilayah baru.
      try {
        await db
          .prepare("ALTER TABLE corporate_city_refresh ADD COLUMN bbox TEXT NOT NULL DEFAULT ''")
          .run();
      } catch {
        /* kolom sudah ada */
      }
      try {
        await db
          .prepare(
            "INSERT INTO corporate_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .bind(SCHEMA_VERSION)
          .run();
      } catch {
        /* penanda opsional: skema sudah siap walau penanda gagal ditulis */
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
    // `out center` menaruh koordinat way/relation di center, sedangkan node
    // memakai lat/lon di level elemen. Tanpa fallback ini semua node OSM
    // (banyak sekolah, hotel, dan kantor) kehilangan titik entitas dan hanya
    // mendapat pusat wilayah.
    const center = element.center || {};
    const latitude = Number(center.lat ?? element.lat);
    const longitude = Number(center.lon ?? element.lon);
    const elementType = clean(element.type).toLowerCase();
    const coordinateSource =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? elementType === "node"
          ? "OpenStreetMap node"
          : `OpenStreetMap ${elementType || "elemen"} (pusat elemen)`
        : "";
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
      coordinateSource,
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
    id: row.id,
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
    // Sumber harus mengikuti koordinat yang benar-benar dipakai. Jika titik
    // entitas ditolak karena di luar wilayah, jangan pertahankan label
    // "OpenStreetMap" pada titik fallback.
    coordinateSource: coordinate?.coordinateSource || row.coordinate_source || "",
    validationStatus: row.validation_status || "",
    validationEvidence: parseJsonList(row.validation_evidence),
    validatedAt: row.validated_at || "",
    aiConfidence: Number(row.ai_confidence) || 0,
    screeningStatus: row.screening_status || "",
    screeningEvidence: parseJsonList(row.screening_evidence),
    screeningCheckedAt: row.screening_checked_at || "",
    screeningReviewedAt: row.screening_reviewed_at || "",
    screeningReviewedBy: row.screening_reviewed_by || "",
  };
}

const PIC_PHONE_GENERIC_LABEL_RE =
  /\b(customer\s*service|call\s*center|resepsionis|reception(?:ist)?|sales(?:\s*marketing)?|marketing|admin(?:istrasi)?|sekretariat|humas|hotline|kantor\s*pusat|head\s*office|office\s*phone)\b/i;

function nameTokensForPhoneBinding(name) {
  return clean(String(name || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !["bin", "binti", "the", "dan", "and", "pt", "cv", "dr", "h"].includes(token),
    );
}

/**
 * Nomor PIC hanya boleh dianggap milik PIC bila muncul dekat nama PIC pada
 * teks halaman yang sama, dan tidak berada di blok kontak generik seperti
 * customer service, resepsionis, sales, atau kantor pusat. Ini mencegah nomor
 * sekolah/perusahaan yang kebetulan ada di website lolos sebagai nomor PIC.
 */
export function phoneBoundToPic(personName, phone, text) {
  const nameTokens = nameTokensForPhoneBinding(personName);
  const digits = String(phone || "").replace(/\D/g, "");
  if (nameTokens.length === 0 || digits.length < 8 || !text) return false;
  const tail = digits.slice(-8);
  const source = String(text).replace(/\s+/g, " ");
  const phonePattern = new RegExp(tail.split("").join("\\D{0,3}"), "g");
  let match = phonePattern.exec(source);
  while (match) {
    const index = match.index;
    const matchLength = match[0].length;
    const windowStart = Math.max(0, index - 320);
    const windowEnd = Math.min(source.length, index + matchLength + 320);
    const window = source.slice(windowStart, windowEnd).toLowerCase();
    const prefix = window
      .slice(0, Math.max(0, index - windowStart))
      .slice(-60);
    if (
      PIC_PHONE_GENERIC_LABEL_RE.test(prefix) &&
      !nameTokens.some((token) => prefix.includes(token))
    ) {
      match = phonePattern.exec(source);
      continue;
    }
    let nearest = Infinity;
    let nearestToken = "";
    for (const token of nameTokens) {
      const tokenIndex = window.indexOf(token);
      if (tokenIndex < 0) continue;
      const distance = Math.abs(tokenIndex - (index - windowStart));
      if (distance < nearest) {
        nearest = distance;
        nearestToken = token;
      }
    }
    // Satu blok identitas (mis. "Kepala Sekolah … Nomor Telp./HP …") bisa
    // memuat beberapa baris. Batas 300 karakter tetap mensyaratkan nama dan
    // nomor berada di halaman yang sama, bukan digabung dari dua halaman.
    if (nearestToken && nearest <= 300) {
      // Label generik boleh ada di halaman, tetapi tidak boleh berada di
      // antara nama PIC dan nomornya. Contoh yang ditolak:
      // "Customer Service 0812..." tanpa nama PIC di dekat nomor.
      const betweenStart = Math.min(
        window.indexOf(nearestToken),
        index - windowStart,
      );
      const betweenEnd = Math.max(
        window.indexOf(nearestToken),
        index - windowStart,
      );
      const between = window.slice(betweenStart, betweenEnd + matchLength);
      if (!PIC_PHONE_GENERIC_LABEL_RE.test(between)) return true;
    }
    match = phonePattern.exec(source);
  }
  return false;
}

/**
 * Cari satu sumber (halaman/sitasi) yang memuat nama PIC dan nomor PIC
 * berdekatan. Sumber tidak boleh digabung: nama dari halaman A dan nomor
 * kantor dari halaman B bukan bukti bahwa nomor itu milik PIC.
 */
export function boundPicPhoneSource(personName, phone, sources = []) {
  for (const source of Array.isArray(sources) ? sources : []) {
    const entry =
      typeof source === "string"
        ? { url: "", text: source }
        : source && typeof source === "object"
          ? source
          : null;
    if (!entry) continue;
    const text = `${entry.title || ""} ${entry.text || ""}`.trim();
    if (phoneBoundToPic(personName, phone, text)) return entry;
  }
  return null;
}

/** Bukti terstruktur bahwa nomor PIC terikat ke nama PIC di halaman resmi. */
export function boundPicPhoneEvidence(personName, phone, url) {
  if (!clean(personName) || !clean(phone) || !clean(url)) return "";
  return `Nomor PIC ${clean(phone)} tercantum bersama PIC ${clean(personName)} pada ${clean(url)}.`;
}

/** Gate publikasi: bukti nomor PIC harus terikat ke nama PIC, bukan nomor umum. */
export function hasBoundPicPhoneEvidence(lead = {}) {
  return (Array.isArray(lead.validationEvidence) ? lead.validationEvidence : []).some(
    (item) =>
      /^Nomor PIC .+ tercantum bersama PIC .+ pada https?:\/\//i.test(clean(item)),
  );
}

const GENERIC_PIC_EMAIL_RE =
  /^(?:info|sales|marketing|reservation|reservasi|contact|kontak|admin|administrasi|office|hello|support|cs|frontdesk|front\.office|hrd|career|karir|recruitment|purchasing|procurement|sekretariat|humas|reception|resepsionis|billing|finance|keuangan|pendaftaran|ppdb|operator)@/i;

/**
 * E-mail yang boleh dipublikasikan harus alamat PIC, bukan kotak generik
 * (info/sales/admin) dan bukan alamat kosong. Gate ini dipakai Kurir Telegram
 * dan Penulis Prospek agar "verified" tanpa e-mail PIC tidak lolos.
 */
export function picEmailReady(lead = {}) {
  const email = clean(lead.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return false;
  return !GENERIC_PIC_EMAIL_RE.test(email);
}

function personNameKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Bukti satu halaman harus menyebut orang yang sama: nama pada bukti sama
 * dengan nama PIC dan nomor pada bukti adalah nomor PIC itu. Pola teks saja
 * tidak cukup karena bukti bisa menyebut orang lain di halaman yang sama.
 */
export function picEvidenceMatchesLead(lead = {}) {
  const name = personNameKey(sanitizePicName(lead.contactName));
  const digits = String(lead.phone || "").replace(/\D/g, "");
  if (!name || digits.length < 8) return false;
  const tail = digits.slice(-8);
  return (Array.isArray(lead.validationEvidence) ? lead.validationEvidence : []).some(
    (item) => {
      const match =
        /^Nomor PIC (.+?) tercantum bersama PIC (.+?) pada https?:\/\/\S+\.?$/i.exec(
          clean(item),
        );
      if (!match) return false;
      const evidenceDigits = String(match[1] || "").replace(/\D/g, "");
      if (evidenceDigits.length < 8 || evidenceDigits.slice(-8) !== tail) return false;
      return personNameKey(match[2]) === name;
    },
  );
}

/** True bila error berasal dari kuota/billing OpenSanctions (HTTP 402). */
export function screeningQuotaFailure(lead = {}) {
  if (clean(lead.screeningStatus).toLowerCase() !== "error") return false;
  const evidence = (Array.isArray(lead.screeningEvidence) ? lead.screeningEvidence : [])
    .join(" ")
    .toLowerCase();
  return /402|kuota|billing/.test(evidence);
}

/**
 * Semua status selain clear harus ditinjau manusia sebelum publish, kecuali
 * error kuota/billing (HTTP 402). Kuota habis bukan temuan risiko dan tidak
 * boleh menghentikan seluruh antrean; lead tetap ditandai error untuk review
 * manusia dan statusnya tidak dipalsukan menjadi clear. Konfirmasi manusia
 * dicatat terpisah di screeningReviewedAt.
 */
export function screeningReviewRequired(lead = {}) {
  const status = clean(lead.screeningStatus).toLowerCase();
  if (screeningQuotaFailure(lead)) return false;
  return status !== "clear" && !clean(lead.screeningReviewedAt);
}

/** Alasan penahanan yang sesuai status, bukan selalu "kandidat berisiko". */
export function screeningHoldReason(lead = {}) {
  const status = clean(lead.screeningStatus).toLowerCase();
  const evidence = (Array.isArray(lead.screeningEvidence) ? lead.screeningEvidence : [])
    .join(" ")
    .toLowerCase();
  if (status === "review") {
    return "OpenSanctions menemukan kandidat berisiko. Konfirmasi manual di Robot AI diperlukan sebelum Publish.";
  }
  if (status === "error") {
    return /402|kuota|billing/.test(evidence)
      ? "Pemeriksaan OpenSanctions gagal karena kuota/billing API (HTTP 402). Lead tetap diproses tetapi ditandai untuk ditinjau manusia; periksa kuota atau billing."
      : "Pemeriksaan OpenSanctions gagal. Lead ditahan sampai pemeriksaan berhasil atau ditinjau manual di Robot AI.";
  }
  if (status === "disabled") {
    return "OpenSanctions belum aktif, jadi belum ada hasil screening. Lead ditahan sampai layanan aktif atau ditinjau manual di Robot AI.";
  }
  return "Screening OpenSanctions belum dijalankan. Lead ditahan sampai diperiksa atau ditinjau manual di Robot AI.";
}

/**
 * Hitung field screening yang aman setelah riset ulang. Konfirmasi manusia
 * dipertahankan bila hasilnya sama, atau bila API sedang error/nonaktif.
 * Bukti baru yang berbeda membuka review lagi.
 */
export function screeningFieldsForResearch(lead = {}, screening = {}) {
  const status = clean(screening.status) || "disabled";
  const evidence = [...(screening.evidence || [])]
    .map((item) => clean(item))
    .filter(Boolean)
    .sort()
    .slice(0, 12);
  const unchanged =
    clean(lead.screeningStatus).toLowerCase() === status.toLowerCase() &&
    JSON.stringify([...(lead.screeningEvidence || [])].sort()) ===
      JSON.stringify(evidence);
  // Konfirmasi manusia hanya dipertahankan bila hasil baru sama, atau bila
  // pemeriksaan tidak mungkin memberi hasil baru (API nonaktif/error). Hasil
  // review/clear yang berbeda membuka penahanan lagi.
  const keepConfirmedReview =
    Boolean(clean(lead.screeningReviewedAt)) &&
    (unchanged || status === "disabled" || status === "error");
  return {
    screeningStatus: status,
    screeningEvidence: evidence,
    screeningReviewedAt: keepConfirmedReview
      ? lead.screeningReviewedAt || ""
      : "",
    screeningReviewedBy: keepConfirmedReview
      ? lead.screeningReviewedBy || ""
      : "",
  };
}

/** Field screening yang dipertahankan saat refresh kota mengganti baris lead. */
export function screeningFieldsForRefresh(prior = {}, lead = {}) {
  const sameEntity =
    clean(prior.name).toLowerCase() === clean(lead.name).toLowerCase();
  return {
    screeningStatus: sameEntity ? prior.screeningStatus || "" : "",
    screeningEvidence: sameEntity ? prior.screeningEvidence || [] : [],
    screeningCheckedAt: sameEntity ? prior.screeningCheckedAt || "" : "",
    screeningReviewedAt: sameEntity ? prior.screeningReviewedAt || "" : "",
    screeningReviewedBy: sameEntity ? prior.screeningReviewedBy || "" : "",
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
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence, screening_status, screening_evidence, screening_checked_at, screening_reviewed_at, screening_reviewed_by FROM corporate_leads",
    )
    .all();
  const cacheByCity = new Map();
  for (const row of result.results ?? []) {
    const list = cacheByCity.get(row.city) ?? [];
    list.push(rowToLead(row));
    cacheByCity.set(row.city, list);
  }

  const leads = [];
  // Bbox wilayah fokus saling beririsan (mis. Cipanas di dalam Kab. Cianjur,
  // Gunung Sindur di utara Kab. Bogor). Satu elemen OSM tidak boleh muncul dua
  // kali di daftar lead; urutan CORPORATE_CITIES menentukan label wilayahnya.
  // Satu elemen OSM tidak boleh muncul dua kali karena bbox beririsan.
  // Wilayah dengan bbox terkecil dianggap paling spesifik, sehingga lead di
  // Gunung Sindur tetap berlabel Gunung Sindur (bukan Kab. Bogor) dan lead di
  // Cipanas tetap berlabel Cipanas (bukan Kab. Cianjur).
  const leadById = new Map();
  const cityByNameForRank = new Map(CORPORATE_CITIES.map((city) => [city.name, city]));
  const better = regionRankBetter;
  const pushUniqueLead = (lead) => {
    const city = cityByNameForRank.get(lead.city);
    if (!city) return;
    const rank = regionCandidateRank(lead, city);
    const existing = leadById.get(lead.id);
    if (!existing) {
      leadById.set(lead.id, { lead, rank });
      return;
    }
    if (better(rank, existing.rank)) {
      existing.lead = lead;
      existing.rank = rank;
    }
  };
  const cities = CORPORATE_CITIES.map((city) => {
    const updatedAt = refreshed.get(city.name) ?? seed.generatedAt;
    const cached = cacheByCity.get(city.name);
    if (cached?.length) {
      for (const lead of cached) pushUniqueLead(lead);
    } else {
      for (const lead of seed.leads) {
        if (lead.city !== city.name) continue;
        const coordinate = resolveLeadCoordinates(lead);
        pushUniqueLead({
          ...lead,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          coordinateAddress:
            lead.coordinateAddress || coordinate.coordinateAddress,
          coordinateSource: coordinate.coordinateSource,
        });
      }
    }
    return { name: city.name, updatedAt };
  });
  for (const entry of leadById.values()) leads.push(entry.lead);

  return {
    leads,
    cities,
    source: "OpenStreetMap",
    seedAt: seed.generatedAt,
  };
}

const CORPORATE_LEAD_FIELDS =
  "id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence, screening_status, screening_evidence, screening_checked_at, screening_reviewed_at, screening_reviewed_by";

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
  if (!sanitizePicName(lead.contactName) || !isPicRole(lead.contactRole)) {
    missing.push("nama PIC");
  }
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

const PIC_PLACEHOLDER_RE =
  /\b(?:tidak\s+(?:tersedia|disebutkan|diketahui|ada|bernama)|belum\s+(?:diketahui|ada)|unknown|n\/?a|data(?:\s+tahun)?|pada\s+data|historis|disebut\s+sebagai|tanpa\s+nama|operator\s+tercatat|data\s+publik)\b/i;
const PIC_LABEL_RE =
  /\b(?:resepsionis|receptionist|front\s*desk|front\s*office|customer\s*service|layanan\s+pelanggan|call\s*center|operator|admin(?:istrasi)?|sekretariat|security|satpam|office\s*boy|pic|kontak\s*person|contact\s*person)\b/i;
const PIC_ROLE_IN_NAME_RE =
  /\b(?:general\s+manager|manager|manajer|direktur|director|kepala|rektor|rector|camat|duta\s+besar|ambassador|ceo|cto|founder|pendiri|owner|pemilik|hr|human\s+resources|sales|marketing|finance|operational|operation|assistant|supervisor|koordinator|coordinator|staff|staf|specialist|engineer|teknisi|support)\b/i;
const PIC_ORG_RE =
  /\b(?:pt|cv|tbk|persero|yayasan|sekolah|school|sma|smk|smp|sd|mi|mts|ma|universitas|university|institut|kampus|hotel|resort|apartemen|apartment|kantor|kecamatan|kedutaan|embassy|office)\b/i;
const PIC_HONORIFIC_RE =
  /^(?:ustadz|ustad|kiai|kh|hj|h|prof|dr|drs|dra|ir|bapak|ibu|pak|bu|mr|mrs|ms)\.?\s+/i;
const PIC_DEGREE_RE =
  /(?:,\s*)?\b(?:s\.?kom|s\.?t|m\.?kom|m\.?t|m\.?sc|m\.?pd|m\.?m|mba|ph\.?d|l\.?c|gr|s\.?th\.?i|s\.?e|s\.?pd|s\.?si|s\.?h|s\.?ab|a\.?md|drs|dra|ir)\.?\b/gi;
const NON_PIC_ROLE_RE =
  /\b(?:resepsionis|receptionist|front\s*desk|front\s*office|customer\s*service|layanan\s+pelanggan|call\s*center|operator|admin(?:istrasi)?|sekretariat|security|satpam|office\s*boy|human\s+resources|hr)\b/i;

function personLikePart(value) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (words.length < 1) return false;
  if (!words.every((word) => /^[A-Z][\p{L}'’.-]*$/u.test(word))) return false;
  return !words.some((word) =>
    GENERIC_NAME_WORDS.has(word.replace(/[^\p{L}]/gu, "").toLowerCase()),
  );
}

function hasMultipleNames(value) {
  const parts = clean(value)
    .split(/\s*(?:,|&|\/|\bdan\b|\bserta\b)\s*/i)
    .map(clean)
    .filter(Boolean);
  return parts.filter(personLikePart).length > 1;
}

/** Peran yang jelas bukan PIC, seperti resepsionis atau customer service. */
export function isPicRole(value) {
  const role = clean(value);
  return !role || !NON_PIC_ROLE_RE.test(role);
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
    .replace(PIC_HONORIFIC_RE, "")
    .replace(PIC_DEGREE_RE, " ")
    .replace(/[\s,;:.–—-]+$/g, "")
    .replace(/[^\p{L}\p{M}'’.,\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
  if (!/\p{L}/u.test(text)) return "";
  text = text.slice(0, 80).trim();
  if (
    PIC_PLACEHOLDER_RE.test(text) ||
    PIC_LABEL_RE.test(text) ||
    PIC_ROLE_IN_NAME_RE.test(text) ||
    PIC_ORG_RE.test(text) ||
    hasMultipleNames(text)
  ) {
    return "";
  }
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
    `${base}/kontak`,
    `${base}/contact`,
    `${base}/team`,
    `${base}/careers`,
    `${base}/karir`,
    `${base}/lowongan`,
    `${base}/profil`,
    `${base}/manajemen`,
    `${base}/contact-us`,
    `${base}/hubungi-kami`,
    `${base}/our-team`,
  ].slice(0, Math.max(1, Math.min(10, maxPages)));
  const loaded = await mapLimit(candidates, 3, async (url) => ({
    url,
    html: await readPage(url),
  }));
  const pages = [];
  const documents = [];
  const chunks = [];
  for (const item of loaded) {
    if (!item.html) continue;
    const text = htmlToLines(item.html).join("\n");
    pages.push(item.url);
    documents.push({ url: item.url, text });
    chunks.push(text);
  }
  return {
    pages,
    documents,
    text: chunks.join("\n").slice(0, 28_000),
  };
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_TIMEOUT_MS = 12_000;
const EXA_ANSWER_TIMEOUT_MS = 25_000;

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
      const detail =
        typeof body?.error === "string"
          ? body.error.replace(/\s+/g, " ").slice(0, 180)
          : typeof body?.message === "string"
            ? body.message.replace(/\s+/g, " ").slice(0, 180)
            : "";
      console.error(
        "corporate_exa_answer_error",
        response.status,
        detail,
      );
      return {
        enabled: true,
        answer: null,
        citations: [],
        error: `Panel riset publik sedang tidak tersedia (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`,
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
  // Nama kota saja bukan bukti hasil pencarian membahas entitas yang sama.
  // Untuk nama yang sangat pendek (mis. "BSI") tetap izinkan fallback kota.
  return tokens.length === 0 ? cityMatch : companyMatch;
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
      "SELECT id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, validation_status, validation_evidence, validated_at, ai_confidence, screening_status, screening_evidence, screening_checked_at, screening_reviewed_at, screening_reviewed_by FROM corporate_leads WHERE id = ?",
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

/**
 * Peringkat kandidat wilayah untuk satu lead duplikat. Area yang disebut pada
 * alamat (mis. "South Tangerang") menang atas tebakan bbox, lalu bbox terkecil
 * agar wilayah fokus (Gunung Sindur, Cipanas) tidak tertelan wilayah besar.
 */
export function regionCandidateRank(lead, city) {
  const latitude = Number(lead?.latitude);
  const longitude = Number(lead?.longitude);
  const hasCoordinate =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0;
  // Bukti terkuat: titik entitas benar-benar berada di bbox wilayah itu.
  // Sengaja hanya bbox kota ini, bukan ikut area, agar alamat tidak bisa
  // "membuktikan" wilayah yang titiknya justru di luar bbox tersebut.
  const contains = hasCoordinate
    ? latitude >= city.bbox[0] - 0.02 &&
      latitude <= city.bbox[2] + 0.02 &&
      longitude >= city.bbox[1] - 0.02 &&
      longitude <= city.bbox[3] + 0.02
      ? 0
      : 1
    : 1;
  const areaRegion = regionByName(lead?.area);
  const areaMatch = areaRegion && areaRegion.name === city.name ? 0 : 1;
  const size = Math.abs(
    (city.bbox[2] - city.bbox[0]) * (city.bbox[3] - city.bbox[1]),
  );
  return [contains, areaMatch, size];
}

function regionRankBetter(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return (left[index] ?? 0) < (right[index] ?? 0);
    }
  }
  return false;
}

/**
 * Pilih satu label wilayah untuk sebuah lead dari kandidat yang tersedia,
 * memakai bukti yang sama seperti dedupe: koordinat, lalu area alamat, lalu
 * bbox paling spesifik. Dipakai saat menulis hasil refresh agar label tidak
 * bergantung pada wilayah mana yang kebetulan di-refresh terakhir.
 */
/**
 * Rencana relabel dari baris yang sudah tersimpan, tanpa menarik ulang OSM.
 * Label dihitung dengan aturan yang sama seperti penulisan hasil refresh:
 * koordinat, lalu area alamat, lalu bbox paling spesifik. Baris yang sudah
 * benar tidak dimasukkan, dan baris yang titiknya di luar semua bbox dicatat
 * sebagai pelanggaran, bukan dipindah diam-diam.
 */
export function planCorporateRelabel(rows = []) {
  const cityNames = CORPORATE_CITIES.map((city) => city.name);
  const moves = [];
  const violations = [];
  let unchanged = 0;
  for (const row of rows) {
    if (!row || !row.id) continue;
    const lead = {
      id: row.id,
      name: clean(row.name),
      area: clean(row.area),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      city: clean(row.city),
    };
    const to = chooseLeadCity(lead, [lead.city, ...cityNames]);
    const hasCoordinate =
      Number.isFinite(lead.latitude) &&
      Number.isFinite(lead.longitude) &&
      lead.latitude !== 0 &&
      lead.longitude !== 0;
    const contains = hasCoordinate
      ? coordinateInRegion(to, lead.area, lead.latitude, lead.longitude, 0.02) === true
      : null;
    if (contains === false) {
      violations.push({
        id: lead.id,
        name: lead.name,
        city: lead.city,
        area: lead.area,
        latitude: lead.latitude,
        longitude: lead.longitude,
        reason: "Koordinat tidak berada di bbox wilayah mana pun",
      });
      continue;
    }
    if (!to || to === lead.city) {
      unchanged += 1;
      continue;
    }
    const fromRegion = CORPORATE_CITIES.find((city) => city.name === lead.city);
    const toRegion = CORPORATE_CITIES.find((city) => city.name === to);
    const fromRank = fromRegion ? regionCandidateRank(lead, fromRegion) : null;
    const toRank = toRegion ? regionCandidateRank(lead, toRegion) : null;
    let reason = `bbox ${to} lebih spesifik untuk titik ini`;
    if (toRank && fromRank && toRank[0] === 0 && fromRank[0] === 1) {
      reason = `titik entitas (${lead.latitude}, ${lead.longitude}) berada di dalam bbox ${to}`;
    } else if (toRank && fromRank && toRank[1] === 0 && fromRank[1] === 1) {
      reason = `alamat "${lead.area}" termasuk wilayah ${to}`;
    }
    moves.push({
      id: lead.id,
      name: lead.name,
      from: lead.city,
      to,
      area: lead.area,
      latitude: lead.latitude,
      longitude: lead.longitude,
      containsCoordinate: contains === true,
      reason,
    });
  }
  return {
    total: rows.length,
    changed: moves.length,
    unchanged,
    violations,
    moves,
  };
}

/** Terapkan (atau audit saja) relabel dari data D1 yang sudah tersimpan. */
export async function relabelCorporateLeads(db, options = {}) {
  await ensureCorporateSchema(db);
  const apply = options.apply === true;
  const rows = await db
    .prepare(
      "SELECT id, name, city, area, latitude, longitude FROM corporate_leads",
    )
    .all();
  const plan = planCorporateRelabel(rows.results ?? []);
  if (!apply) return { ...plan, applied: 0, apply: false };

  const now = new Date().toISOString();
  let applied = 0;
  for (const move of plan.moves) {
    const result = await db
      .prepare("UPDATE corporate_leads SET city = ?, updated_at = ? WHERE id = ?")
      .bind(move.to, now, move.id)
      .run();
    applied += Number(result.meta?.changes || 0);
  }
  return { ...plan, applied, apply: true };
}

export function chooseLeadCity(lead, cityNames = []) {
  let best = null;
  for (const name of cityNames) {
    if (!name) continue;
    const city = CORPORATE_CITIES.find((item) => item.name === name);
    if (!city) continue;
    const rank = regionCandidateRank(lead, city);
    if (!best || regionRankBetter(rank, best.rank)) best = { name, rank };
  }
  return best?.name || "";
}

/**
 * Cache refresh hanya boleh dipakai ulang bila umurnya masih muda DAN bbox
 * wilayahnya tidak berubah. Perluasan cakupan harus langsung menarik data.
 */
export function refreshCacheKey(bbox, version = REFRESH_DATA_VERSION) {
  const area = Array.isArray(bbox) ? bbox.join(",") : "";
  return area ? `${area}|v${version}` : "";
}

export function refreshCacheReusable(
  storedKey,
  bbox,
  ageMs,
  minMs = REFRESH_MIN_MS,
  version = REFRESH_DATA_VERSION,
) {
  const current = refreshCacheKey(bbox, version);
  if (!current || !storedKey || storedKey !== current) return false;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < minMs;
}

/**
 * Putuskan baris mana yang benar-benar perlu ditulis saat refresh.
 *
 * Refresh dulu menghapus seluruh baris kota lalu menulis ulang semuanya, jadi
 * satu putaran 15 wilayah membakar >2.000 penulisan harian meski data OSM
 * tidak berubah. Sekarang hanya baris baru/berubah yang ditulis, dan hanya
 * entitas yang benar-benar hilang yang dihapus.
 */
export function refreshWritePlan(rawRows = [], leads = []) {
  const stored = new Map(rawRows.map((row) => [row.id, row]));
  const writes = [];
  const deletes = [];
  const desired = new Set();
  for (const lead of leads) {
    desired.add(lead.id);
    const raw = stored.get(lead.id);
    if (raw && storedLeadMatches(raw, lead)) continue;
    writes.push(lead);
  }
  for (const row of rawRows) {
    if (!desired.has(row.id)) deletes.push(row.id);
  }
  return { writes, deletes };
}

/** Kolom yang di-upsert harus sama persis; CASE "excluded kosong" dihitung. */
function storedLeadMatches(raw, lead) {
  const same = (storedValue, nextValue) =>
    !nextValue || String(nextValue) === String(storedValue ?? "");
  const lat = Number(lead.latitude) || 0;
  const lng = Number(lead.longitude) || 0;
  return (
    String(raw.name ?? "") === String(lead.name ?? "") &&
    String(raw.city ?? "") === String(lead.city ?? "") &&
    same(raw.area, lead.area) &&
    String(raw.category ?? "") === String(lead.category ?? "") &&
    same(raw.email, lead.email) &&
    same(raw.phone, lead.phone) &&
    same(raw.website, lead.website) &&
    same(raw.contact_name, lead.contactName) &&
    same(raw.contact_role, lead.contactRole) &&
    same(raw.contact_url, lead.contactUrl) &&
    same(raw.contact_source, lead.contactSource) &&
    (lat === 0 || lat === Number(raw.latitude ?? 0)) &&
    (lng === 0 || lng === Number(raw.longitude ?? 0)) &&
    same(raw.coordinate_address, lead.coordinateAddress) &&
    same(raw.coordinate_source, lead.coordinateSource)
  );
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
    .prepare("SELECT refreshed_at, bbox FROM corporate_city_refresh WHERE city = ?")
    .bind(city.name)
    .first();
  if (refreshRow?.refreshed_at) {
    const age = Date.now() - Date.parse(refreshRow.refreshed_at);
    if (refreshCacheReusable(refreshRow.bbox, city.bbox, age)) {
      const rows = await db
        .prepare(
          `SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads WHERE city = ?`,
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
      `SELECT ${CORPORATE_LEAD_FIELDS} FROM corporate_leads WHERE city = ?`,
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
  // Label wilayah tidak boleh ditentukan urutan refresh. Satu elemen bisa
  // tertangkap bbox beberapa wilayah, jadi bandingkan label tersimpan dengan
  // kandidat dan pilih yang benar-benar memuat titik/alamat entitas.
  const existingCity = new Map();
  for (let index = 0; index < leads.length; index += 40) {
    const chunk = leads.slice(index, index + 40).map((lead) => lead.id);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT id, city FROM corporate_leads WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of rows.results ?? []) existingCity.set(row.id, row.city);
  }
  for (const lead of leads) {
    const chosen = chooseLeadCity(lead, [existingCity.get(lead.id), lead.city]);
    if (chosen) lead.city = chosen;
  }
  const now = new Date().toISOString();
  const { writes, deletes } = refreshWritePlan(existingRows.results ?? [], leads);
  const statements = [
    db
      .prepare(
        "INSERT INTO corporate_city_refresh (city, refreshed_at, bbox) VALUES (?, ?, ?) ON CONFLICT(city) DO UPDATE SET refreshed_at = excluded.refreshed_at, bbox = excluded.bbox",
      )
      .bind(city.name, now, refreshCacheKey(city.bbox)),
  ];
  for (const id of deletes) {
    statements.push(db.prepare("DELETE FROM corporate_leads WHERE id = ?").bind(id));
  }
  for (const lead of writes) {
    const prior = existing.get(lead.id) || seedById.get(lead.id) || {};
    const screening = screeningFieldsForRefresh(prior, lead);
    statements.push(
      db
        .prepare(
          `INSERT INTO corporate_leads (id, name, city, area, category, email, phone, website, contact_name, contact_role, contact_url, contact_source, latitude, longitude, coordinate_address, coordinate_source, screening_status, screening_evidence, screening_checked_at, screening_reviewed_at, screening_reviewed_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          screening.screeningStatus,
          JSON.stringify(screening.screeningEvidence),
          screening.screeningCheckedAt,
          screening.screeningReviewedAt,
          screening.screeningReviewedBy,
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
