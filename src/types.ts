export interface Company {
  id: string;
  name: string;
  location: string;
  email: string;
  picPhone: string;
  website?: string;
  /** Nama dan jabatan PIC hasil riset publik. */
  contactName?: string;
  contactRole?: string;
  contactSource?: string;
  /** Asal data, mis. "Corporate Engine". */
  source?: string;
  /** ID lead Corporate Engine yang dipublikasikan robot. */
  sourceLeadId?: string;
  latitude?: number;
  longitude?: number;
  coordinateAddress?: string;
  coordinateSource?: string;
  validationStatus?: "verified" | "partial" | "missing" | string;
  validationEvidence?: string[];
  validatedAt?: string;
  aiConfidence?: number;
  visitDate: string; // yyyy-mm-dd, "" bila belum visit
  createdAt: string;
  /** Pembatalan di tingkat perusahaan, dipakai bila belum ada PDF penawaran. */
  lostReason?: string;
  lostAt?: string; // yyyy-mm-dd, "" bila belum
}

export interface QuoteItem {
  id: string;
  service: string;
  bandwidth: string;
  media: string;
  monthly: string;
  installation: string;
}

/** Draft lama berbasis editor. Tidak dipakai lagi oleh alur upload PDF. */
export interface Quote {
  id: string;
  companyId: string;
  seq: number;
  date: string; // yyyy-mm-dd
  contactPerson: string;
  city: string;
  hal: string;
  lampiran: string;
  intro: string;
  tableTitle: string;
  items: QuoteItem[];
  includes: string[];
  notes: string[];
  keterangan: string[];
  terms: string[];
  closing: string;
  thanks: string;
  signerName: string;
  signerPhone: string;
  numberOverride: string;
  createdAt: string;
  updatedAt: string;
}

export type QuoteStatus = "penawaran" | "tidak-jadi" | "po";

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
}

export interface BastDevice {
  id: string;
  name: string;
  quantity: number;
}

/** Data yang diisi pada Berita Acara Serah Terima (BAST). */
export interface BastRecord {
  /** Tanggal aktivasi/BAST, yyyy-mm-dd. */
  date: string;
  customerName: string;
  customerAddress: string;
  customerPic: string;
  customerPhone: string;
  customerEmail: string;
  siteName: string;
  siteAddress: string;
  serviceName: string;
  bandwidth: string;
  monthlyFee: number;
  registrationFee: number;
  installationStart: string;
  installationEnd: string;
  devices: BastDevice[];
  createdAt: string;
  updatedAt: string;
}

/** Satu penawaran per perusahaan, berupa PDF yang diunggah pengguna. */
export interface QuoteRecord {
  id: string;
  companyId: string;
  number: string;
  date: string; // yyyy-mm-dd
  quoteFile: StoredFile;
  /** PDF versi lama yang pernah dipakai; versi terbaru ada di quoteFile. */
  quoteHistory?: StoredFile[];
  status: QuoteStatus;
  lostReason: string;
  lostAt: string; // yyyy-mm-dd, "" bila belum
  poFile: StoredFile | null;
  poAt: string; // yyyy-mm-dd, "" bila belum
  /** Nilai PO sebelum PPN, dalam rupiah. 0 = belum diisi. */
  poAmount: number;
  /** PPN 11% dari poAmount. */
  poPpn: number;
  /** Lama kontrak dalam tahun. 0 = tidak diisi. */
  poYears: number;
  /** Komisi 10% dari poAmount (sebelum PPN). */
  poCommission: number;
  /** yyyy-mm-dd tanggal komisi pertama diterima. "" = belum diatur. */
  commissionStart?: string;
  /** Data BAST, hanya diisi setelah BAST dibuat. */
  bast?: BastRecord | null;
  /** PDF BAST yang diunggah ke penyimpanan akun. */
  bastFile?: StoredFile | null;
  /** PDF BAST yang sudah ditandatangani perusahaan. */
  bastSignedFile?: StoredFile | null;
  /** yyyy-mm-dd tanggal BAST bertanda tangan diterima. */
  bastSignedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** PIN 6 digit disimpan sebagai hash, bukan angka aslinya. */
export interface PoPinCredential {
  hash: string;
  salt: string;
  iterations: number;
  updatedAt: string;
}

export interface Profile {
  /** Nama yang tampil sebagai sapaan "Hallo …" dan di pojok kiri bawah. */
  username: string;
  /** No. WhatsApp atau Telegram. */
  phone: string;
  /** Alamat e-mail untuk korespondensi. */
  email: string;
  /** PIN untuk membuka nilai komisi PO. */
  poPin?: PoPinCredential;
}

export interface Database {
  companies: Company[];
  quotes: QuoteRecord[];
  locations: string[];
  /** Opsional agar data lama tanpa profil tetap bisa dibuka. */
  profile?: Profile;
}

export type SyncState = "idle" | "saving" | "saved" | "error" | "conflict";
