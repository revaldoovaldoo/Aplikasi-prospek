import { jsPDF } from "jspdf";
import asnetLogo from "../assets/asnet-logo.png?inline";
import footerImage from "../assets/2_DThread_1794511151612_10690167631961.png?inline";
import signature from "../assets/tanda-tangan.png?inline";
import { formatLongDate } from "./data";

export interface QuoteDevice {
  name: string;
  quantity: number;
}

export interface QuotePdfInput {
  number: string;
  date: string;
  city: string;
  contactName: string;
  companyName: string;
  bandwidth: string;
  monthly: number;
  otc: number | "FREE";
  devices: QuoteDevice[];
}

const PAGE_W = 210;
const LEFT = 14;
const RIGHT = 196;
const CONTENT_W = RIGHT - LEFT;
const GOLD: [number, number, number] = [242, 178, 27];
const PEACH: [number, number, number] = [248, 217, 198];
const TEXT: [number, number, number] = [34, 34, 34];
const GRID: [number, number, number] = [120, 120, 120];

const INTRO =
  "Bersama dengan ini, kami bermaksud mengajukan penawaran harga Internet Service Provider yang kami kelola. Layanan kami memberikan Anda fleksibilitas dan waktu yang Anda butuhkan untuk fokus kepada fasilitas atau konten dari bisnis Anda. POP kami pun berada di pusat kota satu gedung dengan NOC sehingga terkontrol 24 jam. Berikut penawaran harga layanan dari kami :";

const KETERANGAN = [
  "Mendapatkan IP Public Static / 29",
  "Mendapatkan Traffic Management Report / MRTG",
  "SLA ( Service Level Agreement ) 99,5%",
  "Technical Support 24/7",
  "Customer Service 24/7",
];

const TERMS = [
  "Waktu instalasi minimal 1-2 minggu atau menurut hasil survei di lapangan.",
  "Harga mengikat setelah dilakukan survei.",
  "Harga tidak termasuk perizinan khusus kawasan atau gedung; perizinan akan dibantu oleh pihak pelanggan.",
  "Masa kontrak minimal 1 (satu) tahun.",
  "Pemutusan kontrak sebelum 1 (satu) tahun kontrak selesai secara sepihak oleh pelanggan akan dikenakan denda sebesar 50% x Biaya Bulanan x Sisa Masa Sewa.",
  "Penawaran ini untuk layanan end-to-end dengan antarmuka Ethernet/RJ45.",
  "Pengaturan perangkat dan dukungan fasilitas tambahan menjadi tanggung jawab pelanggan.",
];

function rupiah(value: number): string {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `Rp ${amount.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function wrap(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 5.0,
): number {
  const lines = doc.splitTextToSize(text, width) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

/** Paragraf rata kanan-kiri, dengan baris terakhir tetap rata kiri. */
function wrapJustified(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 5.1,
): number {
  const lines = doc.splitTextToSize(text, width) as string[];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLast = index === lines.length - 1;
    if (isLast || line.trim().split(/\s+/).length < 2) {
      doc.text(line, x, y);
    } else {
      doc.text(line, x, y, { align: "justify", maxWidth: width });
    }
    y += lineHeight;
  }
  return y;
}

function bulletList(
  doc: jsPDF,
  items: string[],
  x: number,
  y: number,
  width: number,
): number {
  let top = y;
  for (const item of items) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.3);
    doc.text("•", x, top);
    top = wrap(doc, item, x + 4, top, width - 4, 4.6) + 0.4;
  }
  return top;
}

function footer(doc: jsPDF): void {
  // Footer master ASNET: band emas berisi kutipan dan foto, lalu alamat situs.
  doc.addImage(footerImage, "PNG", 0, 270.1, PAGE_W, 26.9);
}

function pageHeader(doc: jsPDF): void {
  doc.addImage(asnetLogo, "PNG", 12, 10, 42, 8.5);

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.2);
  doc.text("PT. Usaha Adi Sanggoro", RIGHT, 12, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text("Internet Broadband - Data Center - Hosting", RIGHT, 17, { align: "right" });
  doc.text("Internet Broadband Division", RIGHT, 22, { align: "right" });

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.9);
  doc.line(12, 31.5, RIGHT, 31.5);
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.2);
  doc.text(text, LEFT, y);
  return y + 5;
}

export function buildQuotePdf(input: QuotePdfInput): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `Penawaran ${input.number}`,
    subject: `Penawaran harga internet untuk ${input.companyName}`,
    author: "PT. Usaha Adi Sanggoro",
    creator: "Hallo Pane",
  });

  pageHeader(doc);
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  // Nomor, lampiran, hal, dan tanggal.
  let y = 39;
  doc.text("Nomor", LEFT, y);
  doc.text(":", LEFT + 26, y);
  doc.text(input.number, LEFT + 31, y);
  doc.text(`${input.city || "Bogor"}, ${formatLongDate(input.date)}`, RIGHT, y, {
    align: "right",
  });
  y += 4.8;
  doc.text("Lampiran", LEFT, y);
  doc.text(":", LEFT + 26, y);
  doc.text("2 (dua)", LEFT + 31, y);
  y += 4.8;
  doc.text("Hal", LEFT, y);
  doc.text(":", LEFT + 26, y);
  doc.text("Penawaran Harga Internet Service Provider", LEFT + 31, y);

  // Jarak lega setelah “Hal”, seperti Quote Master, lalu alamat penerima yang rapat.
  y = 66.5;
  doc.text("Kepada Yth.", LEFT, y);
  y += 5.1;
  doc.text(input.contactName || "-", LEFT, y);
  y += 5.1;
  doc.text(input.companyName, LEFT, y);
  y += 5.1;
  doc.text("Di tempat.", LEFT, y);

  // Satu baris kosong sebelum salam pembuka.
  y += 8;
  doc.text("Dengan Hormat,", LEFT, y);
  y += 6;
  y = wrapJustified(doc, INTRO, LEFT, y, CONTENT_W, 5.1);
  y += 8;

  // Tabel penawaran.
  const tableX = LEFT;
  const tableW = CONTENT_W;
  const titleH = 7;
  const headH = 7;
  const rowH = 7.5;
  const colW = [45, 45, 46, 46];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT);
  doc.text("ACCESS INTERNET PACKAGE FIBER OPTIC", tableX + tableW / 2, y + 4, {
    align: "center",
  });

  const tableTop = y + 7;
  doc.setFillColor(...PEACH);
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.25);
  doc.rect(tableX, tableTop, tableW, titleH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Service Requirement", tableX + tableW / 2, tableTop + 4.7, {
    align: "center",
  });

  const headTop = tableTop + titleH;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  let x = tableX;
  const headers = ["Bandwidth", "Media", "Monthly (*)", "OTC (**)"];
  for (let index = 0; index < headers.length; index += 1) {
    doc.setFillColor(...PEACH);
    doc.rect(x, headTop, colW[index], headH, "FD");
    doc.text(headers[index], x + colW[index] / 2, headTop + 4.8, { align: "center" });
    x += colW[index];
  }

  const bodyTop = headTop + headH;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  const cells = [
    input.bandwidth || "-",
    "Fiber Optic",
    rupiah(input.monthly),
    input.otc === "FREE" ? "Free" : rupiah(input.otc),
  ];
  x = tableX;
  for (let index = 0; index < cells.length; index += 1) {
    doc.setFillColor(...PEACH);
    doc.rect(x, bodyTop, colW[index], rowH, "FD");
    doc.text(cells[index], x + colW[index] / 2, bodyTop + 4.9, { align: "center" });
    x += colW[index];
  }

  const devices = input.devices.filter((device) => device.name.trim());
  let tableBottom = bodyTop + rowH;
  if (devices.length > 0) {
    const deviceText = `Termasuk: ${devices
      .map((device) => `${device.name.trim()} ${Math.max(1, device.quantity)} Unit`)
      .join(", ")}`;
    const lines = doc.splitTextToSize(deviceText, tableW - 5) as string[];
    const deviceH = Math.max(8, lines.length * 4 + 4);
    doc.setFillColor(...PEACH);
    doc.rect(tableX, tableBottom, tableW, deviceH, "FD");
    doc.text(lines, tableX + 2.5, tableBottom + 4.7);
    tableBottom += deviceH;
  }

  // Catatan tabel.
  y = tableBottom + 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text("*   Harga Belum Termasuk PPN 11%", LEFT, y);
  y += 4.4;
  doc.text("**  One Time Charge (OTC)", LEFT, y);
  y += 4.4;
  doc.text("*** Harga berlaku 14 hari dari tanggal penawaran", LEFT, y);

  // Keterangan.
  y += 7;
  y = sectionTitle(doc, "Keterangan :", y);
  y = bulletList(doc, KETERANGAN, LEFT, y, CONTENT_W);
  y += 6;

  // Ketentuan.
  y = sectionTitle(doc, "Ketentuan Berlangganan :", y);
  y = bulletList(doc, TERMS, LEFT, y, CONTENT_W);

  footer(doc);
  doc.addPage();
  pageHeader(doc);
  footer(doc);

  // Penutup dan tanda tangan di halaman kedua.
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  let closeY = 39;
  closeY = wrapJustified(
    doc,
    "Besar harapan kami dapat mempertimbangkan penawaran yang kami ajukan ini. Apabila Bapak/Ibu membutuhkan informasi atau penjelasan yang lebih terperinci, dapat menghubungi kami; dengan senang hati kami akan membantu mendapatkan pelayanan terbaik sesuai kebutuhan Anda.",
    LEFT,
    closeY,
    CONTENT_W,
    5.2,
  );
  closeY += 4;
  closeY = wrapJustified(
    doc,
    "Demikian hal ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.",
    LEFT,
    closeY,
    CONTENT_W,
    5.2,
  );

  closeY += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Hormat Kami,", LEFT, closeY);
  closeY += 5;
  doc.text("PT. Usaha Adi Sanggoro", LEFT, closeY);
  closeY += 5;
  doc.text("ASNET", LEFT, closeY);
  doc.addImage(signature, "PNG", LEFT - 1, closeY + 2, 58, 28);
  closeY += 29;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Pane", LEFT, closeY);
  closeY += 5;
  doc.text("0851 565 902 61", LEFT, closeY);

  return doc.output("blob");
}
