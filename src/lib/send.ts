import type { Profile } from "../types";

export type SendChannel = "whatsapp" | "email";

/** Ubah nomor Indonesia menjadi format internasional untuk wa.me. */
export function normalizeWhatsApp(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("620")) return `62${digits.slice(3)}`;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function isValidWhatsApp(input: string): boolean {
  return normalizeWhatsApp(input).length >= 9;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test((input || "").trim());
}

export function whatsappUrl(number: string, message: string): string {
  const target = normalizeWhatsApp(number);
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent((email || "").trim())}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

export function quoteSubject(companyName: string, quoteNumber: string): string {
  return `Penawaran ${quoteNumber} - ${companyName}`;
}

interface MessageInput {
  channel: SendChannel;
  companyName: string;
  quoteNumber: string;
  senderName: string;
  profile: Profile;
}

export function quoteMessage({
  channel,
  companyName,
  quoteNumber,
  senderName,
  profile,
}: MessageInput): string {
  const greeting = `Dear ${companyName}`;
  const body = `Saya lampirkan surat Penawaran dengan nomor ${quoteNumber}, kiranya Bapak/Ibu dapat melihat terlebih dahulu Penawaran yang kami sampaikan. Apabila ada yang ingin ditanyakan, silakan menghubungi saya melalui WhatsApp.`;

  const signature = ["Hormat saya,", senderName.trim() || "Pane"];
  const email = profile.email.trim();
  if (channel === "email" && email) signature.push(`E-mail: ${email}`);

  return `${greeting}\n\n${body}\n\n${signature.join("\n")}`;
}

export function quoteFilename(quoteNumber: string): string {
  const clean = quoteNumber
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Penawaran-${clean || "PDF"}.pdf`;
}
