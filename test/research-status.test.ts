import assert from "node:assert/strict";
import test from "node:test";
import { validationStatusFor } from "../worker/research.js";

test("riset ulang menaikkan status saat bukti identitas PIC lengkap", () => {
  // Website tidak terbaca dan panel AI sempat menolak satu pemeriksaan, tetapi
  // nama/jabatan PIC, nomor PIC terikat, e-mail PIC, dan koordinat entitas
  // terbukti. Gate Publish tetap memeriksa bukti ini satu per satu.
  assert.equal(
    validationStatusFor({
      fullyVerified: false,
      personVerified: true,
      phoneVerified: true,
      emailVerified: true,
      locationVerified: true,
      hasAnyEvidence: true,
    }),
    "verified",
  );
});

test("status tetap partial bila e-mail PIC belum terbukti", () => {
  assert.equal(
    validationStatusFor({
      fullyVerified: false,
      personVerified: true,
      phoneVerified: true,
      emailVerified: false,
      locationVerified: true,
      hasAnyEvidence: true,
    }),
    "partial",
  );
});

test("status tetap partial bila nomor PIC belum terikat ke nama PIC", () => {
  assert.equal(
    validationStatusFor({
      fullyVerified: false,
      personVerified: true,
      phoneVerified: false,
      emailVerified: true,
      locationVerified: true,
      hasAnyEvidence: true,
    }),
    "partial",
  );
});

test("status tetap partial bila koordinat entitas belum tepat", () => {
  assert.equal(
    validationStatusFor({
      fullyVerified: false,
      personVerified: true,
      phoneVerified: true,
      emailVerified: true,
      locationVerified: false,
      hasAnyEvidence: true,
    }),
    "partial",
  );
});

test("tanpa bukti apa pun status missing", () => {
  assert.equal(
    validationStatusFor({ hasAnyEvidence: false }),
    "missing",
  );
});

test("hasil riset lengkap lama tetap verified", () => {
  assert.equal(validationStatusFor({ fullyVerified: true, hasAnyEvidence: true }), "verified");
});
