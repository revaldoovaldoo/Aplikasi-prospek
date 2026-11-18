import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCoordinateInput,
  parseCoordinateInput,
} from "../src/lib/coordinates.ts";
import {
  CORPORATE_CITIES as clientCities,
  coordinateInRegion as clientCoordinateInRegion,
  coordinateReviewStatus as clientCoordinateReviewStatus,
} from "../src/lib/corporate.ts";
import {
  CORPORATE_CITIES as workerCityRegions,
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
  // Titik pusat bbox bukan titik entitas, meskipun label sumbernya OSM.
  assert.equal(
    clientCoordinateReviewStatus({
      latitude: -6.225,
      longitude: 106.825,
      coordinateSource: "OpenStreetMap node",
    }),
    "missing",
  );
  assert.equal(
    workerCoordinateReviewStatus({
      latitude: -6.225,
      longitude: 106.825,
      coordinateSource: "OpenStreetMap node",
    }),
    "missing",
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

test("seluruh wilayah fokus tersedia di worker dan UI", () => {
  const clientNames = clientCities.map((name) => String(name));
  const workerNames = workerCityRegions.map((region: { name: string }) => region.name);
  const required = [
    "Jakarta",
    "Kota Bogor",
    "Kab. Bogor",
    "Kota Sukabumi",
    "Kab. Sukabumi",
    "Depok",
    "Tangerang",
    "Serang",
    "Subang",
    "Cipanas",
    "Kab. Cianjur",
    "Kab. Lebak",
    "Gunung Sindur",
  ];
  for (const region of required) {
    assert.ok(clientNames.includes(region), `${region} hilang dari daftar UI`);
    assert.ok(workerNames.includes(region), `${region} hilang dari daftar worker`);
  }
  assert.deepEqual(clientNames, workerNames);
});

test("koordinat Cianjur, Cipanas, Lebak, dan Gunung Sindur dikenali", () => {
  const samples: Array<[string, string, number, number]> = [
    ["Cipanas", "Cipanas", -6.705, 107.04],
    ["Kab. Cianjur", "Cianjur", -6.82, 107.14],
    ["Kab. Lebak", "Rangkasbitung", -6.4, 106.25],
    ["Gunung Sindur", "Gunung Sindur", -6.39, 106.73],
  ];
  for (const [city, area, latitude, longitude] of samples) {
    assert.equal(clientCoordinateInRegion(city, area, latitude, longitude), true, city);
    assert.equal(workerCoordinateInRegion(city, area, latitude, longitude), true, city);
  }
  // Nama wilayah tanpa prefiks tetap harus cocok.
  assert.equal(workerCoordinateInRegion("Cianjur", undefined, -6.82, 107.14), true);
  assert.equal(workerCoordinateInRegion("Lebak", undefined, -6.4, 106.25), true);
  assert.equal(clientCoordinateInRegion(undefined, "Kec. Gunung Sindur", -6.39, 106.73), true);
  assert.equal(workerCoordinateInRegion(undefined, "Kecamatan Cipanas", -6.705, 107.04), true);
});

test("format koordinat kosong tidak menampilkan nol", () => {
  assert.equal(formatCoordinateInput(0, 0), "");
  assert.equal(formatCoordinateInput(undefined, undefined), "");
  assert.equal(formatCoordinateInput(-6.356989, 106.780201), "-6.356989, 106.780201");
});
