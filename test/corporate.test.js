import assert from "node:assert/strict";
import test from "node:test";
import {
  CORPORATE_CITIES,
  chooseLeadCity,
  coordinateCandidateMatchesName,
  coordinateInRegion,
  coordinateReadyForPublish,
  isPicRole,
  isRoadCoordinate,
  normalizeElements,
  normalizeOsmCoordinateSource,
  osmElementCenter,
  planCorporateRelabel,
  refreshWritePlan,
  relabelCorporateLeads,
  refreshCacheKey,
  refreshCacheReusable,
  regionCandidateRank,
  regionCoordinate,
  resolveLeadCoordinates,
  sanitizePicName,
  screeningFieldsForRefresh,
  screeningFieldsForResearch,
} from "../worker/corporate.js";

test("node OSM memakai lat/lon elemen, bukan hanya center", () => {
  const [nodeLead] = normalizeElements(
    [
      {
        type: "node",
        id: 123,
        lat: -6.6,
        lon: 106.8,
        tags: { name: "Hotel Node", tourism: "hotel" },
      },
    ],
    "Kab. Bogor",
    "hotel",
    5,
  );
  assert.equal(nodeLead.latitude, -6.6);
  assert.equal(nodeLead.longitude, 106.8);
  assert.equal(nodeLead.coordinateSource, "OpenStreetMap node");
});

test("lead duplikat mengikuti bukti wilayah sebelum bbox terkecil", () => {
  // Area menyebut Tangerang Selatan: label Tangerang menang walau bbox Depok kecil.
  assert.equal(
    chooseLeadCity({ area: "South Tangerang", latitude: -6.36, longitude: 106.71 }, [
      "Depok",
      "Tangerang",
    ]),
    "Tangerang",
  );
  // Tanpa area, wilayah dengan bbox paling kecil yang memuat titik dipakai.
  assert.equal(
    chooseLeadCity({ area: "", latitude: -6.39, longitude: 106.73 }, [
      "Depok",
      "Gunung Sindur",
    ]),
    "Gunung Sindur",
  );
});

test("label wilayah dipilih dari bukti, bukan urutan refresh", () => {
  const allCities = CORPORATE_CITIES.map((city) => city.name);
  const choose = (lead, candidates) => chooseLeadCity(lead, candidates);
  // Titik di Kab. Sukabumi tidak boleh berpindah ke Kab. Cianjur/Depok hanya
  // karena wilayah lain di-refresh belakangan.
  assert.equal(
    choose(
      { latitude: -6.99, longitude: 106.55, area: "Kabupaten Sukabumi" },
      ["Kota Sukabumi", "Kab. Sukabumi", "Kab. Cianjur", "Depok"],
    ),
    "Kab. Sukabumi",
  );
  // Alamat Tangerang Selatan menang atas bbox Depok yang lebih kecil.
  assert.equal(
    choose(
      { latitude: -6.36, longitude: 106.71, area: "South Tangerang" },
      ["Depok", "Tangerang"],
    ),
    "Tangerang",
  );
  // Alamat Kabupaten Bogor menang atas kantong Gunung Sindur.
  assert.equal(
    choose(
      { latitude: -6.421, longitude: 106.733, area: "Kabupaten Bogor" },
      ["Gunung Sindur", "Kab. Bogor"],
    ),
    "Kab. Bogor",
  );
  // Tanpa alamat, bbox paling spesifik yang memuat titik dipakai.
  assert.equal(
    choose({ latitude: -6.39, longitude: 106.73, area: "" }, [
      "Kab. Bogor",
      "Gunung Sindur",
    ]),
    "Gunung Sindur",
  );
  // Titik di luar semua bbox kandidat tetap memakai kandidat terdekat, bukan
  // diam-diam diberi wilayah yang tidak memuatnya.
  assert.equal(
    choose({ latitude: -6.2, longitude: 106.8, area: "" }, allCities).length > 0,
    true,
  );
});

const relabelRows = [
  {
    id: "osm:node/1",
    name: "Hotel Sukabumi Timur",
    city: "Kab. Cianjur",
    area: "",
    latitude: -6.99,
    longitude: 106.55,
  },
  {
    id: "osm:node/2",
    name: "Sekolah Parung",
    city: "Kota Bogor",
    area: "Kabupaten Bogor",
    latitude: -6.421,
    longitude: 106.733,
  },
  {
    id: "osm:node/3",
    name: "Kantor Tangsel",
    city: "Depok",
    area: "South Tangerang",
    latitude: -6.36,
    longitude: 106.71,
  },
  {
    id: "osm:node/4",
    name: "Hotel Jakarta",
    city: "Jakarta",
    area: "",
    latitude: -6.18,
    longitude: 106.83,
  },
  {
    id: "osm:node/5",
    name: "Titik Rusak",
    city: "Jakarta",
    area: "",
    latitude: -7.5,
    longitude: 110.2,
  },
];

/** Bbox wilayah itu sendiri, tanpa bantuan nama area. */
function bboxContains(cityName, latitude, longitude) {
  const city = CORPORATE_CITIES.find((item) => item.name === cityName);
  if (!city) return false;
  const [south, west, north, east] = city.bbox;
  return (
    latitude >= south - 0.02 &&
    latitude <= north + 0.02 &&
    longitude >= west - 0.02 &&
    longitude <= east + 0.02
  );
}

test("rencana relabel menjelaskan perpindahan dan tidak memindah titik rusak", () => {
  const plan = planCorporateRelabel(relabelRows);
  assert.equal(plan.total, 5);
  assert.equal(plan.changed, 3);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.violations.length, 1);
  assert.equal(plan.violations[0].id, "osm:node/5");
  const byId = new Map(plan.moves.map((move) => [move.id, move]));
  assert.equal(byId.get("osm:node/1").to, "Kab. Sukabumi");
  assert.match(byId.get("osm:node/1").reason, /bbox Kab\. Sukabumi/);
  assert.equal(byId.get("osm:node/2").to, "Kab. Bogor");
  assert.match(byId.get("osm:node/2").reason, /bbox Kab\. Bogor/);
  assert.equal(byId.get("osm:node/3").to, "Tangerang");
  // Setiap perpindahan wajib punya bukti bahwa wilayah tujuan memuat titiknya.
  for (const move of plan.moves) {
    assert.equal(move.containsCoordinate, true, move.id);
    assert.equal(bboxContains(move.to, move.latitude, move.longitude), true, move.id);
  }
});

function fakeRelabelDb(rows) {
  const updates = [];
  return {
    updates,
    prepare(sql) {
      if (/SELECT id, name, city, area, latitude, longitude FROM corporate_leads/.test(sql)) {
        return { all: async () => ({ results: rows }) };
      }
      if (/UPDATE corporate_leads SET city/.test(sql)) {
        return {
          bind: (...args) => ({
            run: async () => {
              updates.push(args);
              return { meta: { changes: 1 } };
            },
          }),
        };
      }
      const chain = {
        bind: () => chain,
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
        first: async () => null,
      };
      return chain;
    },
  };
}

test("relabel default hanya audit, apply baru menulis", async () => {
  const auditDb = fakeRelabelDb(relabelRows);
  const audit = await relabelCorporateLeads(auditDb);
  assert.equal(audit.apply, false);
  assert.equal(audit.applied, 0);
  assert.equal(audit.changed, 3);
  assert.equal(auditDb.updates.length, 0);

  const applyDb = fakeRelabelDb(relabelRows);
  const applied = await relabelCorporateLeads(applyDb, { apply: true });
  assert.equal(applied.apply, true);
  assert.equal(applied.applied, 3);
  assert.equal(applyDb.updates.length, 3);
  assert.deepEqual(
    applyDb.updates.map((args) => [args[0], args[2]]).sort(),
    [
      ["Kab. Bogor", "osm:node/2"],
      ["Kab. Sukabumi", "osm:node/1"],
      ["Tangerang", "osm:node/3"],
    ],
  );
});

function rawLead(overrides = {}) {
  return {
    id: "osm:node/1",
    name: "Hotel A",
    city: "Kota Bogor",
    area: "",
    category: "hotel",
    email: "pic@hotel-a.id",
    phone: "081234567890",
    website: "https://hotel-a.id",
    contact_name: "Budi",
    contact_role: "General Manager",
    contact_url: "https://hotel-a.id/kontak",
    contact_source: "Website resmi",
    latitude: -6.59,
    longitude: 106.8,
    coordinate_address: "Jl. A",
    coordinate_source: "OpenStreetMap (node 1)",
    ...overrides,
  };
}

function plannedLead(overrides = {}) {
  return {
    id: "osm:node/1",
    name: "Hotel A",
    city: "Kota Bogor",
    area: "",
    category: "hotel",
    email: "pic@hotel-a.id",
    phone: "081234567890",
    website: "https://hotel-a.id",
    contactName: "Budi",
    contactRole: "General Manager",
    contactUrl: "https://hotel-a.id/kontak",
    contactSource: "Website resmi",
    latitude: -6.59,
    longitude: 106.8,
    coordinateAddress: "Jl. A",
    coordinateSource: "OpenStreetMap (node 1)",
    ...overrides,
  };
}

test("refresh tidak menulis ulang lead yang tidak berubah", () => {
  const plan = refreshWritePlan([rawLead()], [plannedLead()]);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.deletes, []);
});

test("refresh hanya menulis lead yang benar-benar berubah", () => {
  const changed = plannedLead({ name: "Hotel A Baru", city: "Kab. Bogor" });
  const plan = refreshWritePlan([rawLead()], [changed]);
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].id, "osm:node/1");
  assert.deepEqual(plan.deletes, []);
});

test("nilai kosong dari OSM tidak menghapus data yang sudah tersimpan", () => {
  // SQL upsert memakai CASE: excluded kosong berarti pertahankan nilai lama,
  // jadi baris seperti ini tidak perlu ditulis sama sekali.
  const plan = refreshWritePlan(
    [rawLead()],
    [
      plannedLead({
        area: "",
        email: "",
        phone: "",
        website: "",
        contactName: "",
        contactRole: "",
        contactUrl: "",
        contactSource: "",
        latitude: 0,
        longitude: 0,
        coordinateAddress: "",
        coordinateSource: "",
      }),
    ],
  );
  assert.deepEqual(plan.writes, []);
});

test("refresh menghapus hanya entitas yang benar-benar hilang", () => {
  const gone = rawLead({ id: "osm:node/2", name: "Hotel B" });
  const plan = refreshWritePlan([rawLead(), gone], [plannedLead()]);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.deletes, ["osm:node/2"]);
});

test("urutan refresh tidak mengubah label wilayah lead", () => {
  const lead = { area: "", latitude: -6.99, longitude: 106.55 };
  // Refresh Kab. Sukabumi dulu, lalu Kab. Cianjur yang bbox-nya beririsan.
  const forward = chooseLeadCity(lead, [
    chooseLeadCity(lead, ["Kab. Sukabumi"]),
    "Kab. Cianjur",
  ]);
  assert.equal(forward, "Kab. Sukabumi");
  // Urutan sebaliknya harus menghasilkan label yang sama.
  const reverse = chooseLeadCity(lead, [
    chooseLeadCity(lead, ["Kab. Cianjur"]),
    "Kab. Sukabumi",
  ]);
  assert.equal(reverse, "Kab. Sukabumi");
  // Lead di Jakarta tidak boleh berpindah hanya karena Bekasi di-refresh nanti.
  const jakarta = { area: "", latitude: -6.18, longitude: 106.83 };
  assert.equal(
    chooseLeadCity(jakarta, [chooseLeadCity(jakarta, ["Jakarta"]), "Bekasi"]),
    "Jakarta",
  );
});

test("label wilayah selalu wilayah yang memuat koordinat lead", () => {
  const samples = [
    { area: "Bogor Tengah", latitude: -6.595, longitude: 106.816 },
    { area: "Parung", latitude: -6.421, longitude: 106.733 },
    { area: "Cipanas", latitude: -6.705, longitude: 107.04 },
    { area: "Cianjur", latitude: -6.82, longitude: 107.14 },
    { area: "Rangkasbitung", latitude: -6.36, longitude: 106.25 },
    { area: "Sukabumi", latitude: -6.92, longitude: 106.93 },
    { area: "Kabupaten Sukabumi", latitude: -6.99, longitude: 106.55 },
    { area: "Beji", latitude: -6.39, longitude: 106.82 },
    { area: "South Tangerang", latitude: -6.36, longitude: 106.71 },
    { area: "Teluknaga", latitude: -6.03, longitude: 106.45 },
    { area: "Jakarta Utara", latitude: -6.12, longitude: 106.88 },
    { area: "Pulau Pramuka", latitude: -5.745, longitude: 106.61 },
    { area: "Anyer", latitude: -6.05, longitude: 105.9 },
    { area: "Cilegon", latitude: -6.02, longitude: 106.05 },
    { area: "Pamanukan", latitude: -6.21, longitude: 107.81 },
  ];
  const allCities = CORPORATE_CITIES.map((city) => city.name);
  for (const sample of samples) {
    const city = chooseLeadCity(sample, allCities);
    assert.ok(city, `tidak ada wilayah untuk ${sample.area}`);
    assert.equal(
      bboxContains(city, sample.latitude, sample.longitude),
      true,
      `${sample.area} diberi label ${city} yang tidak memuat titiknya`,
    );
  }
});

test("Kota Sukabumi memakai pusat kotanya, bukan pusat kabupaten", () => {
  const coordinate = regionCoordinate("Kota Sukabumi", "");
  assert.match(coordinate.coordinateAddress, /Kota Sukabumi/);
  assert.notEqual(coordinate.latitude, regionCoordinate("Kab. Sukabumi", "").latitude);
});

test("cache refresh tidak dipakai ulang bila bbox atau versi data berubah", () => {
  const bbox = [-6.42, 106.34, -5.92, 106.8];
  // Umur masih muda, bbox dan versi sama: cache boleh dipakai ulang.
  assert.equal(refreshCacheReusable(refreshCacheKey(bbox), bbox, 60_000), true);
  // Bbox diperluas: data lama tidak boleh menutupi wilayah baru.
  assert.equal(
    refreshCacheReusable(
      refreshCacheKey([-6.33, 106.53, -6.0, 106.79]),
      bbox,
      60_000,
    ),
    false,
  );
  // Belum pernah mencatat cache: paksa tarik ulang.
  assert.equal(refreshCacheReusable("", bbox, 60_000), false);
  // Versi pembacaan data lama: tarik ulang walau bbox sama.
  assert.equal(refreshCacheReusable(refreshCacheKey(bbox, 1), bbox, 60_000), false);
  // Umur melewati batas: tetap tarik ulang.
  assert.equal(refreshCacheReusable(refreshCacheKey(bbox), bbox, 31 * 60 * 1000), false);
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
