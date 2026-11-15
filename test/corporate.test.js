import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePicName } from "../worker/corporate.js";

test("sanitizePicName membersihkan pecahan JSON yang rusak", () => {
  assert.equal(
    sanitizePicName('""},personVerified:{citations:[],confidence:'),
    "",
  );
  assert.equal(
    sanitizePicName('Budi "},personVerified:{citations:[]}'),
    "Budi",
  );
  assert.equal(
    sanitizePicName("personVerified:{citations:[],confidence:0}"),
    "",
  );
});

test("sanitizePicName mempertahankan nama yang valid", () => {
  assert.equal(sanitizePicName("Budi Santoso"), "Budi Santoso");
  assert.equal(sanitizePicName("  Siti Rahmawati  "), "Siti Rahmawati");
});

test("sanitizePicName membuang label Nama PIC", () => {
  assert.equal(sanitizePicName("Nama PIC: Budi Santoso"), "Budi Santoso");
  assert.equal(sanitizePicName("Nama PIC : Siti Rahmawati"), "Siti Rahmawati");
  assert.equal(sanitizePicName("Nama PIC - Ahmad Fauzi"), "Ahmad Fauzi");
});

test("sanitizePicName mempertahankan tanda baca pada nama", () => {
  assert.equal(sanitizePicName("O'Connor"), "O'Connor");
  assert.equal(sanitizePicName("A. Rahman"), "A. Rahman");
  assert.equal(sanitizePicName("Budi-Santoso"), "Budi-Santoso");
  assert.equal(
    sanitizePicName("Herlina, Nazila Thaher"),
    "Herlina, Nazila Thaher",
  );
});

test("sanitizePicName menolak nama yang tidak valid", () => {
  assert.equal(sanitizePicName(""), "");
  assert.equal(sanitizePicName("   "), "");
  assert.equal(sanitizePicName("Nama PIC:"), "");
  assert.equal(sanitizePicName("12345"), "");
  assert.equal(sanitizePicName("info@example.com"), "");
  assert.equal(sanitizePicName("https://example.com"), "");
  assert.equal(sanitizePicName("personVerified:{citations:[]}"), "");
});
