/**
 * Pemilih nomor PIC dari daftar yang dipisahkan titik koma atau garis miring.
 *
 * Contoh input:
 *   "0812-3456-7890; 021-555-123"
 *   "Telp: 021 555 123 / HP: 0812 3456 7890"
 *
 * Robot dapat memakai dua nomor: nomor kontak perusahaan dan nomor PIC.
 * Nomor yang dipilih harus memiliki 8–16 digit; nomor duplikat dibuang.
 */

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stripPhoneLabel(value) {
  return value
    .replace(
      /^(?:(?:nomor\s+)?(?:telp|telepon|phone|hp|handphone|wa|whatsapp|mobile|seluler|pic|contact person|kontak person|narahubung)|perusahaan|company|kantor|office)\s*[:.\-]?\s*/i,
      "",
    )
    .trim();
}

export function splitPicPhones(value) {
  return String(value || "")
    .split(/[;,/\r\n]+/)
    .map((candidate) => stripPhoneLabel(clean(candidate)))
    .filter(Boolean);
}

function digitsOf(value) {
  return String(value || "").replace(/\D/g, "");
}

/** Mengembalikan hingga `limit` nomor valid tanpa duplikat. */
export function selectPicPhones(value, limit = 2) {
  const max = Math.max(1, Math.min(2, Number(limit) || 2));
  const result = [];
  const seen = new Set();
  for (const candidate of splitPicPhones(value)) {
    const digits = digitsOf(candidate);
    if (digits.length < 8 || digits.length > 16 || seen.has(digits)) continue;
    seen.add(digits);
    result.push(candidate);
    if (result.length >= max) break;
  }
  return result;
}

/** Mengembalikan nomor valid pertama, atau string kosong. */
export function selectPicPhone(value) {
  return selectPicPhones(value, 1)[0] || "";
}

/** Menampilkan satu atau dua nomor valid pada satu baris. */
export function formatPicPhones(value, limit = 2) {
  return selectPicPhones(value, limit).join(" / ");
}

export function validPicPhone(value) {
  return Boolean(selectPicPhone(value));
}
