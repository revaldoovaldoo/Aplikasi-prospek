import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCoordinateInput,
  parseCoordinateInput,
} from "../src/lib/coordinates.ts";
import { coordinateReviewStatus } from "../src/lib/corporate.ts";

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
      "https://www.google.com/maps/place/x/data=!4m2!3d-6.356989!4d106.780201",
    ),
    { latitude: -6.356989, longitude: 106.780201 },
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
    coordinateReviewStatus({
      ...base,
      coordinateSource: "Nominatim/OpenStreetMap (nama cocok)",
    }),
    "verified",
  );
  assert.equal(
    coordinateReviewStatus({
      ...base,
      coordinateSource: "Nominatim/OpenStreetMap",
    }),
    "review",
  );
  assert.equal(
    coordinateReviewStatus({
      ...base,
      coordinateSource: "Pusat wilayah Depok",
    }),
    "missing",
  );
});

test("format koordinat kosong tidak menampilkan nol", () => {
  assert.equal(formatCoordinateInput(0, 0), "");
  assert.equal(formatCoordinateInput(undefined, undefined), "");
  assert.equal(formatCoordinateInput(-6.356989, 106.780201), "-6.356989, 106.780201");
});
