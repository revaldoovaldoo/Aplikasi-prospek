import assert from "node:assert/strict";
import test from "node:test";
import { isPicRole, sanitizePicName } from "../worker/corporate.js";

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
  assert.equal(sanitizePicName("Bunyamin, M.M."), "Bunyamin");
  assert.equal(
    sanitizePicName("Ustadz Rahmatika Muhammad Iqbal, Lc., M.Pd., Gr."),
    "Rahmatika Muhammad Iqbal",
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
  assert.equal(
    sanitizePicName("Tidak disebutkan dalam data publik Operator tercatat kosong"),
    "",
  );
});

test("sanitizePicName menolak label resepsionis dan customer service", () => {
  assert.equal(sanitizePicName("Wulan Staf Resepsionis"), "");
  assert.equal(sanitizePicName("Customer Service Hotel"), "");
  assert.equal(sanitizePicName("Operator Chintya Dwi Putri"), "");
  assert.equal(sanitizePicName("Admin Tuti"), "");
  assert.equal(isPicRole("Staf Resepsionis"), false);
  assert.equal(isPicRole("Customer Service"), false);
  assert.equal(isPicRole("General Manager"), true);
});

test("sanitizePicName menolak placeholder dan nama perusahaan", () => {
  assert.equal(
    sanitizePicName("Bapak Herman disebut sebagai Owner pada data tahun"),
    "",
  );
  assert.equal(sanitizePicName("Tidak tersedia Operator Chintya Dwi Putri"), "");
  assert.equal(sanitizePicName("Smk Darussalam Exelensia"), "");
  assert.equal(sanitizePicName("Ibu Ratna"), "Ratna");
});

test("sanitizePicName menolak beberapa nama dalam satu field", () => {
  assert.equal(sanitizePicName("Herlina, Nazila Thaher"), "");
  assert.equal(
    sanitizePicName("Rilla Amelia, Shanti Triharti Utami, Riki Winurya Budi"),
    "",
  );
  assert.equal(
    sanitizePicName("Alex Tirta Pendiri Terkait , Lina Novita Konsultan Hukum"),
    "",
  );
  assert.equal(
    sanitizePicName("Indri Lurita Sari Director of Sales Marketing Beta Desiana HR Manager Agus Santo"),
    "",
  );
});

test("sanitizePicName menolak nama yang masih memuat jabatan", () => {
  assert.equal(sanitizePicName("Nurhayati Basir General Manager"), "");
  assert.equal(sanitizePicName("Adrianto Djokosoetono Direktur Utama"), "");
  assert.equal(
    sanitizePicName("Prof. Dr. E.S. Margianti, S.E., M.M. Rektor"),
    "",
  );
});
