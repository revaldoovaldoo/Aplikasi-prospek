import type {
  Company,
  Database,
  Quote,
  QuoteItem,
  QuoteRecord,
  QuoteStatus,
  StoredFile,
} from "../types";

export const DEFAULT_LOCATIONS = ["Kota Bogor", "Kab. Bogor", "Jakarta"];

export function emptyDatabase(): Database {
  return {
    companies: [],
    quotes: [],
    locations: [...DEFAULT_LOCATIONS],
    profile: { username: "", phone: "", email: "" },
  };
}

/** Username profil, dengan "Pane" sebagai sapaan bawaan. */
export function profileName(profile: Database["profile"]): string {
  return profile?.username.trim() || "Pane";
}

export const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export const MONTHS_SHORT_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function isStoredFile(value: unknown): value is StoredFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<StoredFile>;
  return (
    typeof file.id === "string" &&
    file.id.length > 0 &&
    typeof file.name === "string" &&
    typeof file.size === "number" &&
    typeof file.uploadedAt === "string"
  );
}

/** Abaikan draft lama yang tidak memiliki PDF unggahan. */
export function uploadedQuotes(quotes: QuoteRecord[]): QuoteRecord[] {
  return quotes.filter((quote) => isStoredFile(quote.quoteFile));
}

export function latestQuoteForCompany(
  quotes: QuoteRecord[],
  companyId: string,
): QuoteRecord | null {
  const list = uploadedQuotes(quotes).filter((quote) => quote.companyId === companyId);
  if (list.length === 0) return null;
  return list.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

export type CompanyStatus =
  | "prospek"
  | QuoteStatus
  | "bast-terkirim"
  | "bast-selesai";

export function companyStatus(quote: QuoteRecord | null): CompanyStatus {
  if (!quote) return "prospek";
  if (quote.bastSignedFile) return "bast-selesai";
  if (quote.bastFile) return "bast-terkirim";
  return quote.status;
}

/** Status perusahaan: penawaran/PO/BAST, atau pembatalan tanpa PDF penawaran. */
export function companyStatusOf(
  company: Company,
  quote: QuoteRecord | null,
): CompanyStatus {
  if (quote) return companyStatus(quote);
  return company.lostAt ? "tidak-jadi" : "prospek";
}

export interface LostEntry {
  key: string;
  company: Company;
  quote: QuoteRecord | null;
  reason: string;
  lostAt: string;
}

/**
 * Daftar perusahaan cancel, baik dari penawaran yang ditolak maupun
 * pembatalan langsung saat perusahaan belum punya PDF penawaran.
 */
export function lostEntries(companies: Company[], quotes: QuoteRecord[]): LostEntry[] {
  const lostQuoteByCompany = new Map<string, QuoteRecord>();
  for (const quote of uploadedQuotes(quotes)) {
    if (quote.status !== "tidak-jadi") continue;
    const current = lostQuoteByCompany.get(quote.companyId);
    if (!current || current.updatedAt < quote.updatedAt) {
      lostQuoteByCompany.set(quote.companyId, quote);
    }
  }

  const entries: LostEntry[] = [];
  for (const company of companies) {
    const quote = lostQuoteByCompany.get(company.id) ?? null;
    if (quote) {
      entries.push({
        key: quote.id,
        company,
        quote,
        reason: quote.lostReason,
        lostAt: quote.lostAt || quote.updatedAt.slice(0, 10),
      });
    } else if (company.lostAt) {
      entries.push({
        key: company.id,
        company,
        quote: null,
        reason: company.lostReason ?? "",
        lostAt: company.lostAt,
      });
    }
  }

  return entries.sort((a, b) => (a.lostAt < b.lostAt ? 1 : -1));
}

export type BastStatus = "bast-terkirim" | "bast-selesai";

export interface BastEntry {
  key: string;
  company: Company;
  quote: QuoteRecord;
  status: BastStatus;
  date: string;
}

/** Daftar BAST dari penawaran yang sudah memiliki dokumen BAST. */
export function bastEntries(companies: Company[], quotes: QuoteRecord[]): BastEntry[] {
  const quoteByCompany = new Map<string, QuoteRecord>();
  for (const quote of uploadedQuotes(quotes)) {
    if (!quote.bastFile && !quote.bastSignedFile) continue;
    const current = quoteByCompany.get(quote.companyId);
    if (!current || current.updatedAt < quote.updatedAt) {
      quoteByCompany.set(quote.companyId, quote);
    }
  }

  const entries: BastEntry[] = [];
  for (const company of companies) {
    const quote = quoteByCompany.get(company.id);
    if (!quote) continue;
    entries.push({
      key: quote.id,
      company,
      quote,
      status: quote.bastSignedFile ? "bast-selesai" : "bast-terkirim",
      date:
        quote.bast?.date ||
        quote.bastSignedAt ||
        quote.bastFile?.uploadedAt.slice(0, 10) ||
        quote.updatedAt.slice(0, 10),
    });
  }

  return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function quoteStatusLabel(status: CompanyStatus): string {
  switch (status) {
    case "penawaran":
      return "Penawaran";
    case "tidak-jadi":
      return "Cancel";
    case "po":
      return "PO";
    case "bast-terkirim":
      return "BAST sudah terkirim";
    case "bast-selesai":
      return "BAST Selesai";
    default:
      return "Prospek";
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("id-ID")} KB`;
}

export function makeQuoteRecord(input: {
  companyId: string;
  number: string;
  date: string;
  quoteFile: StoredFile;
}): QuoteRecord {
  const now = new Date().toISOString();
  return {
    id: uid("quote"),
    companyId: input.companyId,
    number: input.number,
    date: input.date,
    quoteFile: input.quoteFile,
    status: "penawaran",
    lostReason: "",
    lostAt: "",
    poFile: null,
    poAt: "",
    poAmount: 0,
    poPpn: 0,
    poYears: 0,
    poCommission: 0,
    commissionStart: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** Parse yyyy-mm-dd without timezone drift. */
export function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatLongDate(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "-";
  return `${parts.d} ${MONTHS_ID[parts.m - 1]} ${parts.y}`;
}

export function formatShortDate(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "Belum visit";
  return `${parts.d} ${MONTHS_SHORT_ID[parts.m - 1]} ${parts.y}`;
}

export function romanMonth(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "I";
  return ROMAN[parts.m - 1];
}

export function yearOf(iso: string): number {
  return parseISO(iso)?.y ?? new Date().getFullYear();
}

export function padSeq(seq: number): string {
  return String(Math.max(1, Math.floor(seq))).padStart(3, "0");
}

/** 001/UAS/QUOT-PANE/VII/2026 */
export function autoQuoteNumber(seq: number, date: string): string {
  return `${padSeq(seq)}/UAS/QUOT-PANE/${romanMonth(date)}/${yearOf(date)}`;
}

export function displayQuoteNumber(quote: Quote): string {
  return quote.numberOverride.trim() || autoQuoteNumber(quote.seq, quote.date);
}

export function nextSequence(quotes: Quote[], date: string): number {
  const year = yearOf(date);
  const used = quotes.filter((q) => yearOf(q.date) === year).map((q) => q.seq);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export function parseAmount(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function quoteMonthlyTotal(quote: Quote): number {
  return quote.items.reduce((sum, item) => sum + parseAmount(item.monthly), 0);
}

export function quoteFileName(
  company: { name: string; location: string },
  quote: Quote,
): string {
  const client = company.name.replace(/^(pt\.?|cv\.?)\s+/i, "").trim();
  const signer = quote.signerName.trim() || "Pane";
  const raw = `Quote ${client} ${company.location}_${padSeq(quote.seq)}_${signer}`;
  return raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const PPN_RATE = 0.11;
export const COMMISSION_RATE = 0.1;

/** PPN 11% dari nilai PO sebelum PPN. */
export function ppnOf(amount: number): number {
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * PPN_RATE) : 0;
}

/** Komisi 10% dari nilai PO sebelum PPN. */
export function commissionOf(amount: number): number {
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * COMMISSION_RATE) : 0;
}

/** Angka polos dengan pemisah ribuan, untuk kolom input rupiah. */
export function formatNumberID(value: number | string): string {
  const amount = typeof value === "number" ? value : parseAmount(value);
  if (!amount) return "";
  return amount.toLocaleString("id-ID");
}

/** Lama kontrak: "2 tahun" atau "-" bila tidak diisi. */
export function formatYears(years: number): string {
  if (!Number.isFinite(years) || years <= 0) return "-";
  return `${years.toLocaleString("id-ID")} tahun`;
}

export function hasPoValue(quote: QuoteRecord | null): boolean {
  return Boolean(quote && quote.poAmount > 0);
}

export type CommissionStatus = "unset" | "upcoming" | "running" | "done";

export interface CommissionPlan {
  quote: QuoteRecord;
  company: Company | null;
  /** Komisi 10% dari nilai PO; satu angka, tanpa nominal per bulan. */
  total: number;
  /** Lama penerimaan dalam bulan: 1 bila tanpa lama kontrak. */
  months: number;
  onceOnly: boolean;
  start: string;
  endDate: string;
  status: CommissionStatus;
  /** Bulan ke-berapa dari total bulan (0 bila belum mulai/selesai). */
  monthIndex: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Geser tanggal ISO sebanyak n bulan; hari menyesuaikan akhir bulan. */
export function addMonthsISO(iso: string, months: number): string {
  const parts = parseISO(iso);
  if (!parts) return "";
  const total = parts.y * 12 + (parts.m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  const day = Math.min(parts.d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Okt 2028" */
export function formatMonthYear(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "-";
  return `${MONTHS_SHORT_ID[parts.m - 1]} ${parts.y}`;
}

/**
 * Rencana komisi satu PO. Nilainya tetap komisi 10%; lama kontrak hanya
 * menentukan berapa lama komisi itu diterima (1 kali bila tidak diisi).
 */
export function commissionPlan(
  quote: QuoteRecord,
  company: Company | null,
  today = todayISO(),
): CommissionPlan {
  const total = Math.max(0, quote.poCommission || 0);
  const onceOnly = !(quote.poYears > 0);
  const months = onceOnly ? 1 : Math.round(quote.poYears * 12);
  const start = quote.commissionStart ?? "";

  let status: CommissionStatus = "unset";
  let monthIndex = 0;
  let endDate = "";

  const startParts = parseISO(start);
  const todayParts = parseISO(today);

  if (startParts && todayParts && total > 0) {
    endDate = addMonthsISO(start, months - 1);
    if (today < start) {
      status = "upcoming";
    } else if (endDate < today) {
      status = "done";
      monthIndex = months;
    } else {
      status = "running";
      monthIndex = Math.min(
        months,
        Math.max(1, (todayParts.y - startParts.y) * 12 + (todayParts.m - startParts.m) + 1),
      );
    }
  }

  return {
    quote,
    company,
    total,
    months,
    onceOnly,
    start,
    endDate,
    status,
    monthIndex,
  };
}

export function formatIDR(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

export function formatCompactIDR(value: number): string {
  if (value >= 1_000_000_000) {
    return `Rp ${(value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  }
  if (value >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  }
  return formatIDR(value);
}

export function todayLong(): string {
  return formatLongDate(todayISO());
}

const DEFAULT_INTRO =
  "Bersama dengan ini, kami bermaksud mengajukan penawaran harga Internet Service Provider yang kami kelola. Layanan kami memberikan anda fleksibilitas dan waktu yang anda butuhkan untuk fokus kepada fasilitas atau content dari bisnis anda. POP kami pun berada dipusat kota satu gedung dengan NOC sehingga terkontrol 24 jam.";

const DEFAULT_CLOSING =
  "Besar harapan kami dapat mempertimbangkan penawaran yang kami ajukan ini. Apabila bapak/ ibu membutuhkan informasi atau penjelasan yang lebih terperinci, dapat menghubungi kami, dengan senang hati akan membantu untuk mendapatkan pelayanan terbaik sesuai kebutuhan anda.";

const DEFAULT_THANKS =
  "Demikian hal ini kami sampaikan, atas perhatian dan kerjasamanya kami ucapkan terima kasih.";

export const DOC_DEFAULTS = {
  hal: "Penawaran Koneksi Internet Dedicated",
  lampiran: "2 (dua)",
  tableTitle: "DEDICATED INTERNET ACCESS PACKAGE — FIBER OPTIC",
  intro: DEFAULT_INTRO,
  closing: DEFAULT_CLOSING,
  thanks: DEFAULT_THANKS,
  includes: [
    "Access Point Huawei 361 + Adaptor 62 Unit (As Request)",
    "Switch Huawei eKit Engine S220S-48P4S 1 Unit",
    "Switch Huawei eKit Engine S220S-24P4J 1 Unit",
    "Switch Huawei eKit Engine S220S-8P4J 2 Unit",
    "Switch Huawei eKit Engine S530-24ST4XE 1 Unit",
    "Router CCR 2116-12G-4S+ 1 Unit",
    "Kabel LAN AMP UTP Cat 6e 5 Roll (will be update depends condition)",
    "Jasa Instalasi AP",
  ],
  notes: [
    "* Harga Belum Termasuk PPN 11%",
    "** One Time Charge",
    "*** Harga berlaku 14 hari dari tanggal penawaran",
  ],
  keterangan: [
    "Mendapatkan IP Public Static / 29",
    "Mendapatkan Traffic Management Report / MRTG",
    "SLA (Service Level Agreement) 99,5%",
    "Technical Support 24/7",
    "Customer Service 24/7",
  ],
  terms: [
    "Waktu instalasi minimal 1-2 minggu atau menurut hasil survey dilapangan",
    "Harga mengikat setelah dilakukan survey",
    "Jika membutuhan perizinan khusus kawasan atau gedung akan dibantu oleh pihak customer",
    "Masa kontrak minimal 2 (dua) tahun",
    "Pemutusan kontrak sebelum 1 (satu) tahun kontrak selesai secara sepihak oleh pelanggan akan dikenakan denda sebesar 50% x Biaya Bulanan x Sisa Masa Sewa",
    "Penawaran ini untuk end to end service dengan Interface Ethernet/Rj45",
    "Setting perangkat dan support fasilitas tambahan menjadi tanggung jawab pelanggan",
  ],
};

export function makeQuoteItem(partial: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: uid("item"),
    service: "Dedicated",
    bandwidth: "500 Mbps",
    media: "Fiber Optic",
    monthly: "IDR 21.621.622",
    installation: "FREE",
    ...partial,
  };
}

export function makeQuote(input: {
  companyId: string;
  seq: number;
  date: string;
  contactPerson?: string;
}): Quote {
  const now = new Date().toISOString();
  return {
    id: uid("quote"),
    companyId: input.companyId,
    seq: input.seq,
    date: input.date,
    contactPerson: input.contactPerson ?? "",
    city: "Bogor",
    hal: DOC_DEFAULTS.hal,
    lampiran: DOC_DEFAULTS.lampiran,
    intro: DOC_DEFAULTS.intro,
    tableTitle: DOC_DEFAULTS.tableTitle,
    items: [makeQuoteItem()],
    includes: [...DOC_DEFAULTS.includes],
    notes: [...DOC_DEFAULTS.notes],
    keterangan: [...DOC_DEFAULTS.keterangan],
    terms: [...DOC_DEFAULTS.terms],
    closing: DOC_DEFAULTS.closing,
    thanks: DOC_DEFAULTS.thanks,
    signerName: "Pane",
    signerPhone: "0851 565 902 61",
    numberOverride: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function makeCompany(input: Partial<Company> & { name: string; location: string }): Company {
  return {
    id: uid("co"),
    email: "",
    picPhone: "",
    website: "",
    visitDate: "",
    lostReason: "",
    lostAt: "",
    createdAt: new Date().toISOString(),
    ...input,
  };
}
