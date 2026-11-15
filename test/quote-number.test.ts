import assert from "node:assert/strict";
import test from "node:test";
import {
  nextAvailableQuoteNumber,
  nextAvailableQuoteSequence,
  quoteFiles,
  quoteSequence,
} from "../src/lib/data.ts";

function file(id: string) {
  return {
    id,
    name: `${id}.pdf`,
    size: 100,
    uploadedAt: "2026-10-01T00:00:00.000Z",
  };
}

function quote(
  id: string,
  companyId: string,
  number: string,
  date: string,
  status: "penawaran" | "po" | "tidak-jadi",
) {
  return {
    id,
    companyId,
    number,
    date,
    status,
    quoteFile: file(`file-${id}`),
    lostReason: "",
    lostAt: "",
    poFile: null,
    poAt: "",
    poAmount: 0,
    poPpn: 0,
    poYears: 0,
    poCommission: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

test("nomor mengikuti urutan berikutnya, tetapi nomor cancel dipakai ulang", () => {
  const quotes = [
    quote("1", "pt-1", "001/UAS/QUOT-PANE/X/2026", "2026-10-01", "penawaran"),
    quote("2", "pt-2", "002/UAS/QUOT-PANE/X/2026", "2026-10-02", "penawaran"),
    quote("3", "pt-3", "003/UAS/QUOT-PANE/X/2026", "2026-10-03", "penawaran"),
    quote("4", "pt-4", "004/UAS/QUOT-PANE/X/2026", "2026-10-04", "tidak-jadi"),
    quote("5", "pt-5", "005/UAS/QUOT-PANE/X/2026", "2026-10-05", "penawaran"),
  ];

  assert.equal(nextAvailableQuoteSequence(quotes, "2026-11-03"), 4);
  assert.equal(
    nextAvailableQuoteNumber(quotes, "2026-11-03"),
    "004/UAS/QUOT-PANE/XI/2026",
  );
});

test("urutan berlanjut lintas bulan dan tahun, lalu nomor cancel tersedia lagi", () => {
  const active = [
    quote("1", "pt-a", "001/UAS/QUOT-PANE/X/2026", "2026-10-01", "penawaran"),
    quote("2", "pt-b", "002/UAS/QUOT-PANE/X/2026", "2026-10-02", "penawaran"),
    quote("3", "pt-c", "003/UAS/QUOT-PANE/X/2026", "2026-10-03", "penawaran"),
  ];

  assert.equal(nextAvailableQuoteSequence(active, "2026-11-03"), 4);
  assert.equal(nextAvailableQuoteSequence(active, "2027-01-03"), 4);
  assert.equal(
    nextAvailableQuoteNumber(active, "2026-11-03"),
    "004/UAS/QUOT-PANE/XI/2026",
  );

  const withNext = [
    ...active,
    quote("4", "school-a", "004/UAS/QUOT-PANE/XI/2026", "2026-11-10", "penawaran"),
  ];
  assert.equal(
    nextAvailableQuoteNumber(withNext, "2026-12-01"),
    "005/UAS/QUOT-PANE/XII/2026",
  );

  const cancelled = active.map((item) =>
    item.id === "3" ? { ...item, status: "tidak-jadi" as const } : item,
  );
  assert.equal(nextAvailableQuoteSequence(cancelled, "2026-11-03"), 3);
  assert.equal(
    nextAvailableQuoteNumber(cancelled, "2026-11-03"),
    "003/UAS/QUOT-PANE/XI/2026",
  );
});

test("nomor dari perusahaan cancel dipakai ulang, bukan dilewati", () => {
  const quotes = [
    quote("1", "pt-1", "001/UAS/QUOT-PANE/X/2026", "2026-10-01", "penawaran"),
    quote("2", "pt-2", "002/UAS/QUOT-PANE/X/2026", "2026-10-02", "tidak-jadi"),
  ];

  assert.equal(nextAvailableQuoteSequence(quotes, "2026-10-20"), 2);
  assert.equal(quoteSequence("002/UAS/QUOT-PANE/XI/2026"), 2);
});

test("celah dari penawaran yang dihapus tidak dipakai ulang", () => {
  const quotes = [
    quote("1", "pt-a", "001/UAS/QUOT-PANE/X/2026", "2026-10-01", "penawaran"),
    quote("3", "pt-c", "003/UAS/QUOT-PANE/X/2026", "2026-10-03", "penawaran"),
  ];

  assert.equal(nextAvailableQuoteSequence(quotes, "2026-11-03"), 4);
  assert.equal(
    nextAvailableQuoteNumber(quotes, "2026-11-03"),
    "004/UAS/QUOT-PANE/XI/2026",
  );
});

test("riwayat PDF menampilkan versi terbaru lebih dulu tanpa duplikat", () => {
  const record = {
    ...quote("1", "pt-1", "003/UAS/QUOT-PANE/XI/2026", "2026-11-01", "penawaran"),
    quoteFile: file("new"),
    quoteHistory: [file("old-1"), file("old-2")],
  };

  assert.deepEqual(
    quoteFiles(record).map((item) => item.id),
    ["new", "old-2", "old-1"],
  );
});
