import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCoordinateInput,
  parseCoordinateInput,
} from "../src/lib/coordinates.ts";
import {
  coordinateInRegion as clientCoordinateInRegion,
  coordinateReviewStatus as clientCoordinateReviewStatus,
} from "../src/lib/corporate.ts";
import {
  coordinateInRegion as workerCoordinateInRegion,
  coordinateReviewStatus as workerCoordinateReviewStatus,
} from "../worker/corporate.js";

test("koordinat desimal dapat ditempel langsung", () => {
  assert.deepEqual(parseCoordinateInput("-6.356989, 106.780201"), {
    latitude: -6.356989,
    longitude: 106.780201,
  });
  assert.deepEqual(parseCoordinateInput("-6.356989;106.780201"), {
    latitude: -6.356989,
    longitude: 106.780201,
  });
});

test("koordinat dari URL Google Maps dapat diambil", () => {
  assert.deepEqual(
    parseCoordinateInput(
      "https://www.google.com/maps/place/Lazuardi/@-6.356989,106.780201,17z",
    ),
    { latitude: -6.356989, longitude: 106.780201 },
  );
  assert.deepEqual(
    parseCoordinateInput(
      "https://www.google.com/maps?q=-6.356989,106.780201",
    ),
    { latitude: -6.356989, longitude: 106.780201 },
  );
  assert.deepEqual(
    parseCoordinateInput(
      "https://www.google.com/maps?q=loc:-6.356989,106.780201",
    ),
    { latitude: -6.356989, longitude: 106.780201 },
  );
  assert.deepEqual(
    parseCoordinateInput(
      "https://www.google.com/maps/place/x/data=!4m2!3d-6.356989!4d106.780201",
    ),
    { latitude: -6.356989, longitude: 106.780201 },
  );
});

test("koordinat DMS dapat ditempel", () => {
  const parsed = parseCoordinateInput(`6°21'22.7"S 106°46'51.2"E`);
  assert.ok(parsed);
  assert.ok(Math.abs(parsed.latitude - -6.3563055556) < 1e-9);
  assert.ok(Math.abs(parsed.longitude - 106.7808888889) < 1e-9);
  assert.equal(
    parseCoordinateInput(`6°60'00.0"S 106°46'51.2"E`),
    null,
  );
});

test("koordinat tidak valid dan link pendek ditolak", () => {
  assert.equal(parseCoordinateInput(""), null);
  assert.equal(parseCoordinateInput("https://goo.gl/maps/abc123"), null);
  assert.equal(parseCoordinateInput("91, 106.7"), null);
  assert.equal(parseCoordinateInput("-6.3, 181"), null);
  assert.equal(parseCoordinateInput("0, 0"), null);
});

test("status titik mengikuti sumber koordinat", () => {
  const base = { latitude: -6.356989, longitude: 106.780201 };
  assert.equal(
    clientCoordinateReviewStatus({
      ...base,
      coordinateSource: "Nominatim/OpenStreetMap (nama cocok)",
    }),
    "verified",
  );
  assert.equal(
    clientCoordinateReviewStatus({
      ...base,
      coordinateSource: "Nominatim/OpenStreetMap",
    }),
    "review",
  );
  assert.equal(
    clientCoordinateReviewStatus({
      ...base,
      coordinateSource: "Pusat wilayah Depok",
    }),
    "missing",
  );
  assert.equal(
    workerCoordinateReviewStatus({
      ...base,
      coordinateSource: "Panel AI (verifier, nama cocok)",
    }),
    "review",
  );
});

test("pusat way/relation OSM diterima sebagai koordinat entity", () => {
  const base = {
    city: "Depok",
    latitude: -6.4,
    longitude: 106.8,
  };
  for (const source of [
    "OpenStreetMap way (pusat elemen)",
    "OpenStreetMap relation (pusat elemen)",
  ]) {
    assert.equal(
      clientCoordinateReviewStatus({ ...base, coordinateSource: source }),
      "verified",
    );
    assert.equal(
      workerCoordinateReviewStatus({ ...base, coordinateSource: source }),
      "verified",
    );
  }
});

test("validasi wilayah klien dan worker memakai city/area yang sama", () => {
  assert.equal(clientCoordinateInRegion("Depok", "Limo", -6.4, 106.8), true);
  assert.equal(workerCoordinateInRegion("Depok", "Limo", -6.4, 106.8), true);
  assert.equal(clientCoordinateInRegion(undefined, "Depok", -6.4, 106.8), true);
  assert.equal(workerCoordinateInRegion(undefined, "Depok", -6.4, 106.8), true);
  assert.equal(
    clientCoordinateInRegion(undefined, "Kecamatan Limo, Depok", -6.4, 106.8),
    true,
  );
  assert.equal(
    workerCoordinateInRegion(undefined, "Kecamatan Limo, Depok", -6.4, 106.8),
    true,
  );
  assert.equal(clientCoordinateInRegion("Depok", "Limo", -6.2, 106.7), false);
  assert.equal(workerCoordinateInRegion("Depok", "Limo", -6.2, 106.7), false);
});

test("konfirmasi manual sah tidak menjadi missing karena bbox kota", () => {
  const manual = {
    city: "Depok",
    area: "Limo",
    latitude: -6.2,
    longitude: 106.7,
    coordinateSource: "Dikonfirmasi manual — koreksi lapangan",
  };
  assert.equal(clientCoordinateReviewStatus(manual), "verified");
  assert.equal(workerCoordinateReviewStatus(manual), "verified");
  const nonManual = { ...manual, coordinateSource: "Nominatim/OpenStreetMap (nama cocok)" };
  assert.equal(clientCoordinateReviewStatus(nonManual), "missing");
  assert.equal(workerCoordinateReviewStatus(nonManual), "missing");
});

test("format koordinat kosong tidak menampilkan nol", () => {
  assert.equal(formatCoordinateInput(0, 0), "");
  assert.equal(formatCoordinateInput(undefined, undefined), "");
  assert.equal(formatCoordinateInput(-6.356989, 106.780201), "-6.356989, 106.780201");
});
