import assert from "node:assert/strict";
import test from "node:test";
import {
  coordinateCandidateMatchesName,
  coordinateReadyForPublish,
  isPicRole,
  isRoadCoordinate,
  normalizeElements,
  normalizeOsmCoordinateSource,
  osmElementCenter,
  refreshCacheReusable,
  resolveLeadCoordinates,
  sanitizePicName,
  screeningFieldsForRefresh,
  screeningFieldsForResearch,
} from "../worker/corporate.js";

test("cache refresh tidak dipakai ulang bila bbox wilayah berubah", () => {
  const bbox = [-6.42, 106.34, -5.92, 106.8];
  // Umur masih muda dan bbox sama: cache boleh dipakai ulang.
  assert.equal(refreshCacheReusable(bbox.join(","), bbox, 60_000), true);
  // Bbox diperluas: data lama tidak boleh menutupi wilayah baru.
  assert.equal(
    refreshCacheReusable([-6.33, 106.53, -6.0, 106.79].join(","), bbox, 60_000),
    false,
  );
  // Belum pernah mencatat bbox (data lama): paksa tarik ulang.
  assert.equal(refreshCacheReusable("", bbox, 60_000), false);
  // Umur melewati batas: tetap tarik ulang.
  assert.equal(refreshCacheReusable(bbox.join(","), bbox, 31 * 60 * 1000), false);
});

test("refresh kota mempertahankan konfirmasi review saat nama entitas sama", () => {
  const fields = screeningFieldsForRefresh(
    {
      name: "Hotel Contoh",
      screeningStatus: "review",
      screeningEvidence: ["OpenSanctions PIC: Budi"],
      screeningCheckedAt: "2026-11-17T01:00:00.000Z",
      screeningReviewedAt: "2026-11-17T02:00:00.000Z",
      screeningReviewedBy: "Pane",
    },
    { name: "  hotel contoh  " },
  );
  assert.equal(fields.screeningStatus, "review");
  assert.deepEqual(fields.screeningEvidence, ["OpenSanctions PIC: Budi"]);
  assert.equal(fields.screeningReviewedAt, "2026-11-17T02:00:00.000Z");
  assert.equal(fields.screeningReviewedBy, "Pane");
});

test("refresh kota menghapus screening saat nama entitas berubah", () => {
  const fields = screeningFieldsForRefresh(
    {
      name: "Hotel Lama",
      screeningStatus: "clear",
      screeningEvidence: ["bukti lama"],
      screeningCheckedAt: "2026-11-17T01:00:00.000Z",
      screeningReviewedAt: "2026-11-17T02:00:00.000Z",
      screeningReviewedBy: "Pane",
    },
    { name: "Hotel Baru" },
  );
  assert.equal(fields.screeningStatus, "");
  assert.deepEqual(fields.screeningEvidence, []);
  assert.equal(fields.screeningCheckedAt, "");
  assert.equal(fields.screeningReviewedAt, "");
  assert.equal(fields.screeningReviewedBy, "");
});

test("API screening error tidak menghapus konfirmasi review", () => {
  const lead = {
    screeningStatus: "review",
    screeningEvidence: ["OpenSanctions PIC: Budi"],
    screeningReviewedAt: "2026-11-17T02:00:00.000Z",
    screeningReviewedBy: "Pane",
  };
  for (const status of ["error", "disabled"]) {
    const fields = screeningFieldsForResearch(lead, {
      status,
      evidence: [],
    });
    assert.equal(fields.screeningStatus, status);
    assert.equal(fields.screeningReviewedAt, lead.screeningReviewedAt);
    assert.equal(fields.screeningReviewedBy, "Pane");
  }
});

test("hasil screening yang sama mempertahankan konfirmasi meski urutan bukti berubah", () => {
  const fields = screeningFieldsForResearch(
    {
      screeningStatus: "review",
      screeningEvidence: ["bukti B", "bukti A"],
      screeningReviewedAt: "2026-11-17T02:00:00.000Z",
      screeningReviewedBy: "Pane",
    },
    { status: "review", evidence: ["bukti A", "bukti B"] },
  );
  assert.deepEqual(fields.screeningEvidence, ["bukti A", "bukti B"]);
  assert.equal(fields.screeningReviewedAt, "2026-11-17T02:00:00.000Z");
});

test("bukti screening yang berubah membuka ulang review", () => {
  const fields = screeningFieldsForResearch(
    {
      screeningStatus: "clear",
      screeningEvidence: [],
      screeningReviewedAt: "2026-11-17T02:00:00.000Z",
      screeningReviewedBy: "Pane",
    },
    {
      status: "review",
      evidence: ["OpenSanctions PIC: Nama Baru — skor 1.00"],
    },
  );
  assert.equal(fields.screeningStatus, "review");
  assert.equal(fields.screeningReviewedAt, "");
  assert.equal(fields.screeningReviewedBy, "");
});

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

test("geocoder menolak nama jalan dan hanya menerima entitas yang cocok", () => {
  assert.equal(
    coordinateCandidateMatchesName(
      "Lazuardi Global Islamic School",
      "Lazuardi Global Islamic School, Limo, Depok",
    ),
    true,
  );
  assert.equal(
    coordinateCandidateMatchesName(
      "Lazuardi Global Islamic School",
      "Jalan Garuda Ujung, Limo, Depok",
    ),
    false,
  );
  assert.equal(
    coordinateCandidateMatchesName(
      "Lazuardi Global Islamic School",
      "Lazuardi Global Islamic Center, Limo, Depok",
    ),
    false,
  );
  assert.equal(
    isRoadCoordinate({ type: "residential", class: "highway" }),
    true,
  );
  assert.equal(isRoadCoordinate({ type: "school", class: "amenity" }), false);
});

test("pusat elemen way/relation ditandai sebagai sumber entity OSM", () => {
  const wayCenter = osmElementCenter(
    [
      { type: "way", id: 7, tags: { name: "Sekolah Contoh" } },
      { type: "node", id: 1, lat: -6.4, lon: 106.8 },
      { type: "node", id: 2, lat: -6.5, lon: 106.9 },
    ],
    "way",
    "7",
  );
  assert.ok(wayCenter);
  assert.ok(Math.abs(wayCenter.lat - -6.45) < 1e-9);
  assert.ok(Math.abs(wayCenter.lon - 106.85) < 1e-9);
  assert.equal(wayCenter.element.tags.name, "Sekolah Contoh");
  const relationCenter = osmElementCenter(
    [
      { type: "relation", id: 9, tags: { name: "Hotel Contoh" } },
      { type: "node", id: 1, lat: -6.3, lon: 106.7 },
      { type: "node", id: 2, lat: -6.4, lon: 106.8 },
    ],
    "relation",
    "9",
  );
  assert.ok(relationCenter);
  assert.ok(Math.abs(relationCenter.lat - -6.35) < 1e-9);
  assert.ok(Math.abs(relationCenter.lon - 106.75) < 1e-9);
  assert.equal(
    normalizeOsmCoordinateSource("OpenStreetMap", "osm:way/487275703"),
    "OpenStreetMap way (pusat elemen)",
  );
  assert.equal(
    normalizeOsmCoordinateSource("OpenStreetMap", "osm:relation/123"),
    "OpenStreetMap relation (pusat elemen)",
  );
  const [hotel] = normalizeElements(
    [
      {
        type: "way",
        id: 487275703,
        center: { lat: -6.4, lon: 106.8 },
        tags: { name: "favehotel Margonda" },
      },
    ],
    "Depok",
    "hotel",
    5,
  );
  assert.equal(hotel.coordinateSource, "OpenStreetMap way (pusat elemen)");
  assert.equal(
    coordinateReadyForPublish({
      city: "Depok",
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      coordinateSource: hotel.coordinateSource,
    }),
    true,
  );
});

test("konfirmasi manual di luar bbox tetap dipertahankan", () => {
  const coordinate = resolveLeadCoordinates({
    city: "Depok",
    area: "Limo",
    latitude: -6.2,
    longitude: 106.7,
    coordinateSource: "Dikonfirmasi manual — koreksi lapangan",
  });
  assert.equal(coordinate.latitude, -6.2);
  assert.equal(coordinate.longitude, 106.7);
  assert.equal(coordinate.coordinateSource, "Dikonfirmasi manual — koreksi lapangan");
  assert.equal(coordinate.approximate, false);
  assert.equal(
    coordinateReadyForPublish({
      city: "Depok",
      area: "Limo",
      latitude: -6.2,
      longitude: 106.7,
      coordinateSource: "Dikonfirmasi manual — koreksi lapangan",
    }),
    true,
  );
});

test("koordinat publikasi harus berasal dari entitas atau koreksi manual", () => {
  const lead = {
    city: "Depok",
    latitude: -6.3569892,
    longitude: 106.7802015,
  };
  assert.equal(
    coordinateReadyForPublish({
      ...lead,
      coordinateSource: "Nominatim/OpenStreetMap (nama cocok)",
    }),
    true,
  );
  assert.equal(
    coordinateReadyForPublish({
      ...lead,
      coordinateSource: "Dikonfirmasi manual",
    }),
    true,
  );
  assert.equal(
    coordinateReadyForPublish({
      ...lead,
      coordinateSource: "Nominatim/OpenStreetMap",
    }),
    false,
  );
  assert.equal(
    coordinateReadyForPublish({
      ...lead,
      coordinateSource: "Pusat wilayah Depok",
    }),
    false,
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
