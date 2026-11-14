import { jsPDF } from "jspdf";
import asnetLogo from "../assets/asnet-logo.png?inline";
import tandaTangan from "../assets/tanda-tangan.png?inline";
import type { BastRecord, Company, QuoteRecord } from "../types";
import { formatIDR, parseISO, todayISO, uid } from "./data";

const PAPER_W = 210;
const LEFT = 0.5;
const RIGHT = 209.5;
const INNER_W = RIGHT - LEFT;

/** Warna pada kop BAST: krem-oranye, garis abu-abu, dan teks hitam. */
const ORANGE: [number, number, number] = [244, 192, 141];
const GRID: [number, number, number] = [168, 168, 168];
const DARK_GRID: [number, number, number] = [70, 70, 70];
const TEXT: [number, number, number] = [15, 15, 15];

const MONTHS = [
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

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const SATUAN = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
];

/** Angka menjadi huruf, mis. 2026 -> "dua ribu dua puluh enam". */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 12) return SATUAN[value];
  if (value < 20) return `${SATUAN[value - 10]} belas`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const rest = value % 10;
    return `${SATUAN[tens]} puluh${rest ? ` ${SATUAN[rest]}` : ""}`;
  }
  if (value < 200) {
    return `seratus${value > 100 ? ` ${numberToWords(value - 100)}` : ""}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return `${SATUAN[hundreds]} ratus${rest ? ` ${numberToWords(rest)}` : ""}`;
  }
  if (value < 2000) {
    return `seribu${value > 1000 ? ` ${numberToWords(value - 1000)}` : ""}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return `${numberToWords(thousands)} ribu${rest ? ` ${numberToWords(rest)}` : ""}`;
  }
  if (value < 1_000_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    return `${numberToWords(millions)} juta${rest ? ` ${numberToWords(rest)}` : ""}`;
  }
  const billions = Math.floor(value / 1_000_000_000);
  const rest = value % 1_000_000_000;
  return `${numberToWords(billions)} miliar${rest ? ` ${numberToWords(rest)}` : ""}`;
}

export function weekdayID(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "-";
  return WEEKDAYS[new Date(parts.y, parts.m - 1, parts.d).getDay()] ?? "-";
}

export function bastDateParts(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "-";
  return `${WEEKDAYS[new Date(parts.y, parts.m - 1, parts.d).getDay()]}, Tanggal ${parts.d} (${numberToWords(parts.d)}), Bulan ${MONTHS[parts.m - 1]}, Tahun ${parts.y} (${numberToWords(parts.y)})`;
}

export function shortNumericDate(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return "-";
  return `${String(parts.d).padStart(2, "0")}/${String(parts.m).padStart(2, "0")}/${parts.y}`;
}

export function dateRange(start: string, end: string): string {
  if (!start && !end) return "-";
  return `${start ? shortNumericDate(start) : "-"} - ${end ? shortNumericDate(end) : "-"}`;
}

export function emptyBast(company: Company, quote: QuoteRecord): BastRecord {
  const now = new Date().toISOString();
  const date = todayISO();
  return {
    date,
    customerName: company.name,
    customerAddress: company.location,
    customerPic: "",
    customerPhone: company.picPhone,
    customerEmail: company.email,
    siteName: company.name,
    siteAddress: company.location,
    serviceName: "Internet Broadband",
    bandwidth: "",
    monthlyFee: 0,
    registrationFee: 0,
    installationStart: date,
    installationEnd: date,
    devices: Array.from({ length: 3 }, () => ({
      id: uid("device"),
      name: "",
      quantity: 1,
    })),
    createdAt: quote.bast?.createdAt || now,
    updatedAt: now,
  };
}

export function cleanBast(input: BastRecord): BastRecord {
  return {
    ...input,
    customerName: input.customerName.trim(),
    customerAddress: input.customerAddress.trim(),
    customerPic: input.customerPic.trim(),
    customerPhone: input.customerPhone.trim(),
    customerEmail: input.customerEmail.trim(),
    siteName: input.siteName.trim(),
    siteAddress: input.siteAddress.trim(),
    serviceName: input.serviceName.trim(),
    bandwidth: input.bandwidth.trim(),
    devices: input.devices
      .map((device) => ({
        ...device,
        name: device.name.trim(),
        quantity: Math.max(0, Math.floor(device.quantity) || 0),
      }))
      .filter((device) => device.name.length > 0),
    updatedAt: new Date().toISOString(),
  };
}

export function bastFileName(company: Company, quote: QuoteRecord): string {
  const base = `BAST ${company.name} ${quote.number}`
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "BAST"}.pdf`;
}

/** Bingkai tabel luar tanpa garis kolom dekoratif. */
function frame(doc: jsPDF, y: number, height: number): void {
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.18);
  doc.rect(LEFT, y, INNER_W, height);
}

/** Tinggi baris alamat mengikuti jumlah baris teks yang akan dicetak. */
function fieldHeight(doc: jsPDF, value: string, minimum = 9): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  const lines = doc.splitTextToSize(value || "-", 164) as string[];
  return Math.max(minimum, 4.2 + lines.length * 4.2);
}

function section(doc: jsPDF, y: number, height: number, title: string, english: string): number {
  doc.setFillColor(...ORANGE);
  doc.rect(LEFT, y, INNER_W, height, "F");
  doc.setDrawColor(...DARK_GRID);
  doc.setLineWidth(0.32);
  doc.rect(LEFT, y, INNER_W, height);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.3);
  doc.text(title, 105, y + height * 0.38, { align: "center" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.text(english, 105, y + height * 0.8, { align: "center" });
  return y + height;
}

/** Satu baris isian: label Indonesia, sublabel Inggris, dan nilainya. */
function field(
  doc: jsPDF,
  y: number,
  height: number,
  label: string,
  english: string,
  value: string,
): number {
  frame(doc, y, height);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.text(label, 3.2, y + 3.6);
  doc.text(":", 39.7, y + 3.6);

  const lines = doc.splitTextToSize(value || "-", 164) as string[];
  doc.text(lines, 42.5, y + 3.6);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.8);
  doc.text(english, 3.2, y + height - 1.05);
  return y + height;
}

function monthlyField(doc: jsPDF, y: number, value: string): number {
  const height = 10;
  frame(doc, y, height);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.text("Biaya Bulanan", 3.2, y + 3.6);
  doc.text(":", 39.7, y + 3.6);
  doc.text(value, 42.5, y + 3.6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text("Exclude PPN 11%", 72.5, y + 3.6);
  doc.text("SLA : 99,5%", 112, y + 3.6);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.8);
  doc.text("Montly fee", 3.2, y + height - 1.05);
  return y + height;
}

function deviceRow(doc: jsPDF, y: number, devices: BastRecord["devices"]): number {
  const rows = devices.filter((device) => device.name.trim());
  const value =
    rows.length === 0
      ? "-"
      : rows
          .map((device, index) => `${index + 1}. ${device.name} (${device.quantity} unit)`)
          .join("  ·  ");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  const lines = doc.splitTextToSize(value, 164) as string[];
  const height = 9.2;
  frame(doc, y, height);

  doc.setTextColor(...TEXT);
  doc.setFontSize(8.5);
  doc.text("Perangkat Milik ASNET", 3.2, y + 3.6);
  doc.setFontSize(9.2);
  doc.text(":", 39.7, y + 3.6);
  doc.text(lines.slice(0, 2), 42.5, y + 3.6);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.8);
  doc.text("The Device owned by ASNET", 3.2, y + height - 1.05);
  return y + height;
}

/** Footer master hanya berisi alamat kantor dan nomor telepon, di tengah. */
function drawFooter(doc: jsPDF, top: number): number {
  const height = 11;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.18);
  doc.rect(LEFT, top, INNER_W, height);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.6);
  doc.text(
    "Office 24 Hours: Jln. Dr. Semeru No.23E Bogor Tengah Kota Bogor Jawa Barat",
    PAPER_W / 2,
    top + 4.7,
    { align: "center" },
  );
  doc.text(
    "Tlp 24 Hours +62-251-8350-574 or +62-251-833-99-29",
    PAPER_W / 2,
    top + 8.9,
    { align: "center" },
  );
  return top + height;
}

export function buildBastPdf(
  bast: BastRecord,
  company: Company,
  quote: QuoteRecord,
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `BAST ${company.name} ${quote.number}`,
    subject: "Berita Acara Aktivasi Uji Terima",
    author: "PT. Usaha Adi Sanggoro",
    creator: "Hallo Pane",
  });

  // Kop putih: logo ASNET di kiri, identitas perusahaan di tengah.
  const headerTop = 0.5;
  const headerBottom = 26.5;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.35);
  doc.rect(LEFT, headerTop, INNER_W, headerBottom - headerTop);

  doc.addImage(asnetLogo, "PNG", 5.5, 7, 35.4, 10.3);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15.6);
  doc.text("PT. USAHA ADI SANGGORO", 114.5, 8, { align: "center" });
  doc.setFontSize(10.8);
  doc.text("Hosting | Domain | Colocation| Internet Broadband", 114.5, 12.4, {
    align: "center",
  });
  doc.text("| Virtual Private Server| Web Application", 114.5, 16.4, {
    align: "center",
  });

  // Pita judul oranye.
  const titleTop = headerBottom;
  const titleBottom = 39.5;
  doc.setFillColor(...ORANGE);
  doc.rect(LEFT, titleTop, INNER_W, titleBottom - titleTop, "F");
  doc.setDrawColor(...DARK_GRID);
  doc.setLineWidth(0.35);
  doc.rect(LEFT, titleTop, INNER_W, titleBottom - titleTop);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15.2);
  doc.text("BERITA ACARA AKTIVASI UJI TERIMA", 105, 31.9, { align: "center" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.2);
  doc.text("ACTIVATION LETTER OF ACCEPTANCE TEST", 105, 35.6, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text(`( ${quote.number} )`, 105, 38.4, { align: "center" });

  // Kalimat pembuka.
  const introTop = titleBottom;
  const introBottom = 55.5;
  frame(doc, introTop, introBottom - introTop);

  const intro = `Pada hari ini ${bastDateParts(bast.date)}, Instalasi terhadap layanan dilokasi pelanggan sudah dilaksanakan dengan detail sebagai berikut :`;
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.3);
  const introLines = doc.splitTextToSize(intro, 203) as string[];
  doc.text(introLines, 3.2, introTop + 5.3);

  let y = introBottom;

  // Bagian nama pelanggan.
  y = section(doc, y, 13, "NAMA PELANGGAN", "Costumer Name");
  y = field(doc, y, 9, "Nama Perusahaan", "Company Name", bast.customerName);
  y = field(
    doc,
    y,
    fieldHeight(doc, bast.customerAddress),
    "Alamat Perusahaan",
    "Company Address",
    bast.customerAddress,
  );
  y = field(doc, y, 9, "Penanggung Jawab", "Person In Charge", bast.customerPic);
  y = field(doc, y, 9, "Nomor Telepon", "Telephone Number", bast.customerPhone);
  y = field(doc, y, 9, "Alamat Email", "Email Address", bast.customerEmail);

  // Bagian lokasi pemasangan.
  y = section(doc, y, 17, "LOKASI PEMASANGAN", "The Installation Location");
  y = field(doc, y, 9, "Nama Perusahaan", "Company Name", bast.siteName);
  y = field(
    doc,
    y,
    fieldHeight(doc, bast.siteAddress),
    "Alamat Perusahaan",
    "Company Address",
    bast.siteAddress,
  );
  y = field(doc, y, 10, "Nama Layanan", "Service Name", bast.serviceName);
  y = field(doc, y, 9, "Kapasitas Bandwith", "Bandwith Capacity", bast.bandwidth);
  y = monthlyField(doc, y, formatIDR(bast.monthlyFee));
  y = field(
    doc,
    y,
    10,
    "Biaya Registrasi",
    "Installation fee",
    bast.registrationFee > 0 ? formatIDR(bast.registrationFee) : "-",
  );
  y = field(
    doc,
    y,
    9.5,
    "Tanggal Pemasangan",
    "Date Of Instalation",
    dateRange(bast.installationStart, bast.installationEnd),
  );

  // Informasi perangkat.
  y = section(doc, y, 9.5, "INFORMASI", "Device Information");
  y = deviceRow(doc, y, bast.devices);

  // Penutup.
  const closingTop = y;
  const closingBottom = y + 16;
  frame(doc, closingTop, closingBottom - closingTop);
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.3);
  const closingId =
    "Dengan demikian Berita Acara Aktivasi Uji Terima telah dibuat, bahwasanya layanan telah selesai dilakukan instalasi dan dapat berjalan dengan baik";
  const closingIdLines = doc.splitTextToSize(closingId, 203) as string[];
  doc.text(closingIdLines, 3.2, closingTop + 5.2);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.8);
  const closingEn =
    "Thus the activation letter of acceptance test has been made, that service has completed the installation and can be run properly";
  const closingEnLines = doc.splitTextToSize(closingEn, 203) as string[];
  doc.text(closingEnLines, 3.2, closingTop + 5.2 + closingIdLines.length * 4.2 + 1.5);
  y = closingBottom;

  // Tanda tangan: pengguna di kiri, penyedia di tengah, sel kosong di kanan.
  const sigTop = y;
  const sigHeadBottom = y + 9;
  doc.setFillColor(...ORANGE);
  doc.rect(LEFT, sigTop, 139, 9, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(139.5, sigTop, RIGHT - 139.5, 9, "F");
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.18);
  doc.rect(LEFT, sigTop, INNER_W, 9);
  doc.line(70.5, sigTop, 70.5, sigHeadBottom);
  doc.line(139.5, sigTop, 139.5, sigHeadBottom);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.2);
  doc.text("Pengguna Layanan/User", 35.5, sigTop + 5.5, { align: "center" });
  doc.text("Penyedia/Provider", 105, sigTop + 5.5, { align: "center" });

  const sigBodyTop = sigHeadBottom;
  const sigDateTop = 270.7;
  const sigBodyHeight = sigDateTop - sigBodyTop;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.18);
  doc.rect(LEFT, sigBodyTop, INNER_W, sigBodyHeight);
  doc.line(70.5, sigBodyTop, 70.5, sigDateTop);
  doc.line(139.5, sigBodyTop, 139.5, sigDateTop);

  // Tanda tangan penyedia memakai gambar asli; latar putih gambar menyatu
  // dengan sel putih pada formulir. Area tanda tangan tetap bersih tanpa grid.
  // Rasio gambar diambil dari file asli agar tidak melebar/menyempit.
  const sigProps = doc.getImageProperties(tandaTangan);
  const sigAspect = sigProps.width / sigProps.height;
  const sigImageW = Math.min(46, (sigBodyHeight - 0.7) * sigAspect);
  const sigImageH = sigImageW / sigAspect;
  const sigImageX = 105 - sigImageW / 2;
  const sigImageY = sigBodyTop + Math.max(0.35, (sigBodyHeight - sigImageH) / 2);
  doc.addImage(tandaTangan, "PNG", sigImageX, sigImageY, sigImageW, sigImageH);

  // Baris tanggal.
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.18);
  doc.rect(LEFT, sigDateTop, INNER_W, 9);
  doc.line(70.5, sigDateTop, 70.5, sigDateTop + 9);
  doc.line(139.5, sigDateTop, 139.5, sigDateTop + 9);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.1);
  doc.text("Tanggal/Date : ..../..../20....", 3.2, sigDateTop + 5.9);
  doc.text("Tanggal/Date :", 72.5, sigDateTop + 5.9);
  doc.text(shortNumericDate(bast.date), 96.5, sigDateTop + 5.9);

  drawFooter(doc, sigDateTop + 9);
  return doc.output("blob");
}
