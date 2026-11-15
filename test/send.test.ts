import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidWhatsApp,
  normalizeWhatsApp,
  whatsappUrl,
} from "../src/lib/send.ts";

test("normalizeWhatsApp memformat nomor PIC tunggal", () => {
  assert.equal(normalizeWhatsApp("0812 3456 7890"), "6281234567890");
  assert.equal(normalizeWhatsApp("+62 812-3456-7890"), "6281234567890");
  assert.equal(normalizeWhatsApp("+62 (0) 812 3456 7890"), "6281234567890");
});

test("normalizeWhatsApp memilih satu nomor saat PIC punya beberapa nomor", () => {
  assert.equal(
    normalizeWhatsApp("0812 3456 7890 / 021 555 1234"),
    "6281234567890",
  );
  assert.equal(
    normalizeWhatsApp("0812 3456 7890 / 0813 1111 2222"),
    "6281234567890",
  );
});

test("normalizeWhatsApp menolak nomor gabungan yang tidak bisa dipisahkan", () => {
  assert.equal(normalizeWhatsApp("081234567890081234567891"), "");
  assert.equal(normalizeWhatsApp("08123456789012345"), "");
  assert.equal(isValidWhatsApp("08123456789012345"), false);
});

test("whatsappUrl mengarah ke nomor PIC yang dipilih", () => {
  assert.equal(
    whatsappUrl("0812 3456 7890 / 021 555 1234", "Halo"),
    "https://wa.me/6281234567890?text=Halo",
  );
});
