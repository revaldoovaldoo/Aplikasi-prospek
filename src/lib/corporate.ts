import type { Company, Database } from "../types";

export const CORPORATE_CITIES = [
  "Jakarta",
  "Depok",
  "Bekasi",
  "Kota Bogor",
  "Kab. Bogor",
  "Tangerang",
  "Serang",
  "Subang",
  "Sukabumi",
];

/** Bbox yang sama dengan worker agar status koordinat konsisten di kedua sisi. */
const CORPORATE_CITY_BOUNDS: Record<string, [number, number, number, number]> = {
  Jakarta: [-6.37, 106.68, -6.08, 106.97],
  Depok: [-6.49, 106.72, -6.33, 106.9],
  Bekasi: [-6.38, 106.95, -6.18, 107.16],
  "Kota Bogor": [-6.66, 106.7, -6.52, 106.87],
  "Kab. Bogor": [-6.78, 106.4, -6.43, 107.06],
  Tangerang: [-6.33, 106.53, -6.0, 106.79],
  Serang: [-6.22, 106.02, -5.98, 106.3],
  Subang: [-6.75, 107.3, -6.2, 107.85],
  Sukabumi: [-7.3, 106.5, -6.72, 107.2],
};

function regionNameKey(value?: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/^(?:kota|kabupaten|kab\.?)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function regionForLocation(city?: string, area?: string): string | null {
  const target = String(city || "").trim().toLowerCase();
  const areaText = String(area || "").trim().toLowerCase();
  const targetKey = regionNameKey(city);
  const areaKey = regionNameKey(area);
  return (
    CORPORATE_CITIES.find((name) => name.toLowerCase() === target) ||
    CORPORATE_CITIES.find((name) => regionNameKey(name) === targetKey) ||
    CORPORATE_CITIES.find((name) => regionNameKey(name) === areaKey) ||
    CORPORATE_CITIES.find((name) => target.includes(name.toLowerCase())) ||
    CORPORATE_CITIES.find((name) => areaText.includes(name.toLowerCase())) ||
    null
  );
}

/** Validasi bbox kota/area; null bila wilayah tidak dikenali. */
export function coordinateInRegion(
  city: string | undefined,
  area: string | undefined,
  latitude: number,
  longitude: number,
  padding = 0.08,
): boolean | null {
  const region = regionForLocation(city, area);
  if (!region) return null;
  const bounds = CORPORATE_CITY_BOUNDS[region];
  if (!bounds || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const [south, west, north, east] = bounds;
  return (
    latitude >= south - padding &&
    latitude <= north + padding &&
    longitude >= west - padding &&
    longitude <= east + padding
  );
}

function normalizeCoordinateSource(source?: string, sourceLeadId?: string): string {
  const value = String(source || "").trim();
  if (!/^OpenStreetMap$/i.test(value)) return value;
  const match = /^osm:(node|way|relation)\//i.exec(String(sourceLeadId || "").trim());
  if (!match) return value;
  const type = match[1].toLowerCase();
  return type === "node"
    ? "OpenStreetMap node"
    : `OpenStreetMap ${type} (pusat elemen)`;
}

export const CORPORATE_CITY_LABELS: Record<string, string> = {
  Sukabumi: "Kab. Sukabumi",
};

/** Seluruh wilayah awal yang bisa dipilih dari Corporate Engine. */
export const CORPORATE_FOCUS_AREAS = CORPORATE_CITIES.map((city) => ({
  label: CORPORATE_CITY_LABELS[city] ?? city,
  city,
  query: "",
}));

export type CorporateCategory = "company" | "hotel" | "school";

export const CORPORATE_CATEGORY_LABELS: Record<CorporateCategory, string> = {
  company: "Perusahaan",
  hotel: "Hotel",
  school: "Sekolah",
};

export interface CorporatePerson {
  name: string;
  role: string;
  url: string;
  source: string;
}

export interface CorporateLead {
  id: string;
  name: string;
  city: string;
  /** Kecamatan/desa dari data alamat OSM, bila tersedia. */
  area?: string;
  category: CorporateCategory;
  email: string;
  phone: string;
  website: string;
  contactName?: string;
  contactRole?: string;
  contactUrl?: string;
  contactSource?: string;
  latitude?: number;
  longitude?: number;
  coordinateAddress?: string;
  coordinateSource?: string;
  validationStatus?: "verified" | "partial" | "missing" | string;
  validationEvidence?: string[];
  validatedAt?: string;
  aiConfidence?: number;
}

export interface CorporateCityMeta {
  name: string;
  updatedAt: string;
}

export interface CorporateData {
  leads: CorporateLead[];
  cities: CorporateCityMeta[];
  source: string;
  seedAt: string;
}

export interface CorporateRefreshResult {
  city: string;
  leads: CorporateLead[];
  updatedAt: string;
  throttled?: boolean;
  failedCategories?: string[];
}

export type CorporateRobotStage =
  | "finding"
  | "clarification"
  | "publish"
  | "publish_telegram"
  | "publish_prospect"
  | "done"
  | "paused";

export interface CorporateRobotJob {
  lead: CorporateLead;
  stage: CorporateRobotStage;
  status: string;
  needScore: number;
  needLabel: string;
  needEvidence: string[];
  contactStatus: "pending" | "verified" | "partial" | "missing" | string;
  contactConfidence: number;
  contactEvidence: string[];
  attempts: number;
  lastError: string;
  publishedAt: string;
  telegramSentAt: string;
  updatedAt: string;
}

export interface CorporateRobotStats {
  total: number;
  /** Jumlah lead yang tersedia di Corporate Engine, dipakai sebagai progres Finding. */
  searches: number;
  finding: number;
  clarification: number;
  publish: number;
  publishTelegram: number;
  publishProspect: number;
  done: number;
  paused: number;
  active: number;
  published: number;
  notified: number;
  whatsappSent: number;
}

export interface CorporateRobotOutbox {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  uncertain: number;
  needsReview: number;
  retryable: number;
  total: number;
  attention: number;
}

export interface CorporateWhatsAppOutbox {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  uncertain: number;
  needsReview: number;
  total: number;
  attention: number;
}

export interface CorporateRobotAgent {
  id: string;
  name: string;
  role: string;
  provider: string;
  active: boolean;
  draft?: boolean;
}

export interface CorporateRobotAgents {
  finding: CorporateRobotAgent[];
  clarification: CorporateRobotAgent[];
  publish: CorporateRobotAgent[];
}

export interface CorporateRobotStatus {
  enabled: boolean;
  autoPublish: boolean;
  telegramConfigured: boolean;
  telegramTokenSet: boolean;
  telegramChatIdSet: boolean;
  telegramTarget: string;
  whatsappConfigured: boolean;
  whatsappOutbox?: CorporateWhatsAppOutbox | null;
  exaConfigured: boolean;
  openosintConfigured: boolean;
  agents: CorporateRobotAgents;
  cronConfigured: boolean;
  lastRunAt: string;
  nextRunAt: string;
  lastRun: {
    checked: number;
    found: number;
    published: number;
    notified: number;
    error: string;
  } | null;
  stats: CorporateRobotStats;
  outbox?: CorporateRobotOutbox;
  jobs: CorporateRobotJob[];
  notes: string[];
}

export interface CorporateRobotRunResult {
  skipped?: boolean;
  reason?: string;
  runId?: string;
  checked: number;
  found: number;
  published: number;
  prospectAdded: number;
  notified: number;
  whatsappSent: number;
  remaining: number;
  error?: string;
  updated: CorporateRobotJob[];
  status: CorporateRobotStatus;
}

export function categoryLabel(category: string): string {
  return CORPORATE_CATEGORY_LABELS[category as CorporateCategory] ?? "Perusahaan";
}

export function websiteHost(url: string | undefined): string {
  const value = (url ?? "").trim();
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pt|cv|tbk|persero|ud|pd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Data minimum yang juga dipakai Kurir Telegram sebelum menulis Prospek. */
export function isRobotCompanyPublishable(company: Company): boolean {
  return Boolean(
    company.name?.trim() && company.contactName?.trim() && company.picPhone?.trim(),
  );
}

/** Buang Prospek robot hanya bila data minimum Telegram benar-benar kosong. */
export function pruneIncompleteRobotCompanies(data: Database): Database {
  const quotedCompanyIds = new Set(
    data.quotes.filter((quote) => quote.quoteFile).map((quote) => quote.companyId),
  );
  const companies = data.companies.filter((company) => {
    const fromRobot =
      Boolean(company.sourceLeadId) || /robot ai/i.test(company.source ?? "");
    if (!fromRobot) return true;
    return isRobotCompanyPublishable(company) || quotedCompanyIds.has(company.id);
  });
  return companies.length === data.companies.length ? data : { ...data, companies };
}

export function isApproximateCoordinate(lead: {
  coordinateSource?: string;
}): boolean {
  return /^Pusat wilayah\b/i.test(lead.coordinateSource?.trim() || "");
}

/**
 * Sumber yang boleh dianggap titik entitas. Hasil geocoding jalan, pusat
 * wilayah, dan panel AI tanpa konfirmasi tetap berstatus "review".
 */
export function coordinateReviewStatus(lead: {
  id?: string;
  city?: string;
  area?: string;
  sourceLeadId?: string;
  latitude?: number;
  longitude?: number;
  coordinateSource?: string;
}): "verified" | "review" | "missing" {
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  const source = normalizeCoordinateSource(
    lead.coordinateSource,
    lead.sourceLeadId || lead.id,
  );
  const manual = /^Dikonfirmasi manual\b/i.test(source);
  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0 &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    (manual || coordinateInRegion(lead.city, lead.area, latitude, longitude) !== false);
  if (!valid || isApproximateCoordinate({ coordinateSource: source })) return "missing";
  return manual ||
    /^(?:OpenStreetMap (?:node|way|relation)\b|Nominatim\/OpenStreetMap \(nama cocok\))/i.test(
      source,
    )
    ? "verified"
    : "review";
}

export function isCoordinateReviewRequired(lead: {
  latitude?: number;
  longitude?: number;
  coordinateSource?: string;
}): boolean {
  return coordinateReviewStatus(lead) !== "verified";
}

export function isLeadComplete(lead: CorporateLead): boolean {
  return Boolean(
    lead.validationStatus === "verified" &&
      lead.website?.trim() &&
      lead.email?.trim() &&
      lead.phone?.trim() &&
      lead.contactName?.trim() &&
      coordinateReviewStatus(lead) === "verified",
  );
}

/** Lead yang sudah memenuhi syarat Telegram boleh disinkronkan ke Prospek. */
export function isLeadPublishable(lead: CorporateLead): boolean {
  return Boolean(
    lead.name?.trim() && lead.contactName?.trim() && lead.phone?.trim(),
  );
}

/** Field Prospek yang bisa diisi dari hasil riset Corporate Engine. */
export function companyFieldsFromLead(
  lead: CorporateLead,
  existing?: Company,
  options: { verifiedCoordinateOnly?: boolean } = {},
): Partial<Company> {
  const location = [lead.area?.trim(), lead.city?.trim()].filter(Boolean).join(", ");
  const latitude = Number(lead.latitude);
  const longitude = Number(lead.longitude);
  const hasCoordinate =
    Number.isFinite(latitude) && latitude !== 0 && Number.isFinite(longitude) && longitude !== 0;
  const preserveCoordinate = Boolean(
    existing && coordinateReviewStatus(existing) === "verified",
  );
  const coordinateVerified =
    coordinateReviewStatus({
      id: lead.id,
      city: lead.city,
      area: lead.area,
      latitude,
      longitude,
      coordinateSource: lead.coordinateSource,
    }) === "verified";
  const includeCoordinate =
    hasCoordinate &&
    !preserveCoordinate &&
    (!options.verifiedCoordinateOnly || coordinateVerified);
  return {
    name: lead.name,
    ...(lead.website?.trim() ? { website: lead.website.trim() } : {}),
    ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
    ...(lead.phone?.trim() ? { picPhone: lead.phone.trim() } : {}),
    ...(location ? { location } : {}),
    ...(lead.contactName?.trim() ? { contactName: lead.contactName.trim() } : {}),
    ...(lead.contactRole?.trim() ? { contactRole: lead.contactRole.trim() } : {}),
    ...(lead.contactSource?.trim() ? { contactSource: lead.contactSource.trim() } : {}),
    ...(includeCoordinate
      ? {
          latitude,
          longitude,
          coordinateAddress: lead.coordinateAddress,
          coordinateSource: lead.coordinateSource,
        }
      : {}),
    ...(lead.validationStatus ? { validationStatus: lead.validationStatus } : {}),
    ...(Array.isArray(lead.validationEvidence)
      ? { validationEvidence: lead.validationEvidence }
      : {}),
    ...(lead.validatedAt ? { validatedAt: lead.validatedAt } : {}),
    ...(lead.aiConfidence ? { aiConfidence: lead.aiConfidence } : {}),
    source: "Corporate Engine",
    sourceLeadId: lead.id,
  };
}

function isRobotCompany(company: Company): boolean {
  return Boolean(company.sourceLeadId) || /robot ai|corporate engine/i.test(company.source ?? "");
}

function robotFieldsEqual(left: Company, right: Company): boolean {
  const keys: (keyof Company)[] = [
    "name",
    "location",
    "website",
    "email",
    "picPhone",
    "contactName",
    "contactRole",
    "contactSource",
    "latitude",
    "longitude",
    "coordinateAddress",
    "coordinateSource",
    "validationStatus",
    "validationEvidence",
    "validatedAt",
    "aiConfidence",
    "source",
    "sourceLeadId",
  ];
  return keys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

/** Samakan kembali Prospek robot dengan data lead terbaru dari Corporate Engine. */
export function syncRobotCompanies(
  data: Database,
  leads: CorporateLead[],
): Database {
  const complete = leads.filter(isLeadPublishable);
  if (complete.length === 0) return data;

  const matched = new Map<string, CorporateLead>();
  for (const lead of complete) {
    const company =
      data.companies.find((item) => item.sourceLeadId === lead.id) ??
      findCompanyForLead(lead, data.companies);
    if (company && isRobotCompany(company)) matched.set(company.id, lead);
  }
  if (matched.size === 0) return data;

  let changed = false;
  const companies = data.companies.map((company) => {
    const lead = matched.get(company.id);
    if (!lead) return company;
    const fields = companyFieldsFromLead(lead, company, {
      verifiedCoordinateOnly: true,
    });
    const next: Company = {
      ...company,
      ...fields,
      id: company.id,
      createdAt: company.createdAt,
      visitDate: company.visitDate,
      lostReason: company.lostReason,
      lostAt: company.lostAt,
    };
    if (robotFieldsEqual(company, next)) return company;
    changed = true;
    return next;
  });

  if (!changed) return data;
  const locations = [...data.locations];
  for (const lead of matched.values()) {
    const location = [lead.area?.trim(), lead.city?.trim()].filter(Boolean).join(", ");
    if (location && !locations.includes(location)) locations.push(location);
  }
  return { ...data, companies, locations };
}

export function findCompanyForLead(
  lead: CorporateLead,
  companies: Company[],
): Company | null {
  const targetName = normalizeCompanyName(lead.name);
  const targetHost = websiteHost(lead.website).toLowerCase();
  for (const company of companies) {
    if (targetName && normalizeCompanyName(company.name) === targetName) return company;
    const host = websiteHost(company.website).toLowerCase();
    if (targetHost && host && targetHost === host) return company;
  }
  return null;
}

/** Kota dengan data paling lama, untuk penyegaran otomatis satu kota. */
export function oldestCity(cities: CorporateCityMeta[]): CorporateCityMeta | null {
  if (cities.length === 0) return null;
  return [...cities].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0] ?? null;
}

export const CORPORATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
