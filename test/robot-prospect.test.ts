import assert from "node:assert/strict";
import test from "node:test";
import {
  auditProspectTelegramHistory,
  backfillCorporateScreening,
  auditTelegramProspects,
  buildTelegramMessage,
  findingSearchQueries,
  publishLeadToProspect,
  reconcileTelegramProspects,
  reviewCorporateScreening,
  runFindingQualifierAgent,
  sendPublishTelegram,
} from "../worker/robot.js";
import {
  boundPicPhoneSource,
  hasBoundPicPhoneEvidence,
  phoneBoundToPic,
  screeningHoldReason,
} from "../worker/corporate.js";
import {
  isCorporateLeadAddable,
  isLeadPublishable,
  pruneIncompleteRobotCompanies,
  scrubRobotCompanyCoordinates,
  screeningBadgeView,
  screeningReviewRequired,
  syncRobotCompanies,
} from "../src/lib/corporate.ts";

test("Finding memakai query upgrade dan query khusus kategori", () => {
  const hotel = findingSearchQueries({
    name: "Hotel Contoh",
    city: "Jakarta",
    category: "hotel",
  });
  const school = findingSearchQueries({
    name: "SMA Contoh",
    city: "Depok",
    category: "school",
  });
  assert.equal(hotel.length, 4);
  assert.match(hotel.join(" "), /upgrade|peningkatan|pengadaan/i);
  assert.match(hotel.join(" "), /meeting room|ballroom|property management/i);
  assert.match(school.join(" "), /lab komputer|CBT|smart school/i);
});

test("Penilai kebutuhan tidak meloloskan hotel hanya karena menyebut wifi", () => {
  const result = runFindingQualifierAgent(
    { category: "hotel" },
    { text: "Hotel menyediakan wifi gratis untuk tamu di seluruh area." },
    { results: [] },
  );
  assert.equal(result.strongCount, 0);
  assert.equal(result.qualified, false);
});

test("Penilai kebutuhan tidak menghitung 'upgrade villa' sebagai upgrade jaringan", () => {
  const result = runFindingQualifierAgent(
    { category: "hotel" },
    {
      text: "Ulasan tamu: pemilik villa ramah dan ingin upgrade villa yang lebih bagus lagi.",
    },
    { results: [] },
  );
  assert.equal(result.qualified, false);
  assert.equal(
    result.allEvidence.some((item) => item.startsWith("Rencana upgrade/pengadaan jaringan")),
    false,
  );
});

test("Penilai kebutuhan meloloskan sinyal upgrade jaringan yang kuat", () => {
  const result = runFindingQualifierAgent(
    { category: "hotel" },
    {
      text: "Rencana upgrade access point dan bandwidth untuk meeting room serta ballroom.",
    },
    { results: [] },
  );
  assert.ok(result.strongCount >= 1);
  assert.equal(result.qualified, true);
  assert.ok(result.score >= 48);
});

test("Nama dan nomor PIC harus berada di satu halaman, bukan digabung dari dua halaman", () => {
  const pages = [
    { url: "https://contoh.co.id/tentang", text: "Profil perusahaan. Direktur: Budi Santoso." },
    {
      url: "https://contoh.co.id/kontak",
      text: "Kantor pusat. Telepon 0812-3456-7890. Jam kerja Senin-Jumat.",
    },
  ];
  assert.equal(boundPicPhoneSource("Budi Santoso", "0812-3456-7890", pages), null);
  assert.equal(
    boundPicPhoneSource("Budi Santoso", "0812-3456-7890", [
      {
        url: "https://contoh.co.id/kontak",
        text: "Kontak langsung Budi Santoso, WhatsApp 0812-3456-7890.",
      },
    ])?.url,
    "https://contoh.co.id/kontak",
  );
});

test("Nomor PIC harus muncul dekat nama PIC, bukan nomor CS/kantor", () => {
  assert.equal(
    phoneBoundToPic(
      "Budi Santoso",
      "0812-3456-7890",
      "Kontak langsung: Budi Santoso, WhatsApp 0812-3456-7890. Alamat Jl. Contoh No.1.",
    ),
    true,
  );
  assert.equal(
    phoneBoundToPic(
      "Budi Santoso",
      "0812-3456-7890",
      "Customer Service 0812-3456-7890. Budi Santoso adalah direktur di halaman lain.",
    ),
    false,
  );
  assert.equal(
    phoneBoundToPic(
      "Budi Santoso",
      "0812-3456-7890",
      `${"Budi Santoso disebut di profil. ".repeat(20)}Kantor pusat 0812-3456-7890.`,
    ),
    false,
  );
  assert.equal(
    hasBoundPicPhoneEvidence({
      validationEvidence: ["Nomor PIC 0812-3456-7890 ditemukan pada website/sumber resmi."],
    }),
    false,
  );
  assert.equal(
    hasBoundPicPhoneEvidence({
      validationEvidence: [
        "Nomor PIC 0812-3456-7890 tercantum bersama PIC Budi Santoso pada https://contoh.co.id/kontak.",
      ],
    }),
    true,
  );
});

test("Kurir Telegram menolak nama resepsionis, placeholder, dan beberapa nama", () => {
  const base = {
    name: "Hotel Contoh",
    city: "Jakarta",
    category: "hotel",
    email: "budi@contoh.co.id",
    phone: "08123456789",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "clear",
    validationStatus: "verified",
    validationEvidence: [
      "Nomor PIC 08123456789 tercantum bersama PIC Budi Santoso pada https://contoh.co.id/kontak.",
    ],
  };
  assert.equal(
    buildTelegramMessage({
      ...base,
      contactName: "Wulan Staf Resepsionis",
      contactRole: "Staf Resepsionis",
    }),
    "",
  );
  assert.equal(
    buildTelegramMessage({
      ...base,
      contactName: "Tidak tersedia Operator Chintya Dwi Putri",
      contactRole: "Operator",
    }),
    "",
  );
  assert.equal(
    buildTelegramMessage({
      ...base,
      contactName: "Rilla Amelia, Shanti Triharti Utami",
      contactRole: "Sales Manager",
    }),
    "",
  );
  assert.match(
    buildTelegramMessage({
      ...base,
      contactName: "Budi Santoso",
      contactRole: "IT Manager",
    }),
    /Nama PIC : Budi Santoso/,
  );
});

function fakeStateDb(data: Record<string, unknown>) {
  const state = {
    payload: JSON.stringify(data),
    revision: 1,
    updated: false,
  };
  return {
    state,
    prepare(sql: string) {
      if (/SELECT payload, revision FROM app_state/.test(sql)) {
        return {
          bind: () => ({
            first: async () => ({
              payload: state.payload,
              revision: state.revision,
            }),
          }),
        };
      }
      if (/UPDATE app_state SET payload/.test(sql)) {
        return {
          bind: (payload: string, _now: string, _owner: string, revision: number) => ({
            run: async () => {
              if (Number(revision) !== state.revision) return { meta: { changes: 0 } };
              state.payload = payload;
              state.revision += 1;
              state.updated = true;
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

const lead = {
  id: "lead-1",
  name: "Hotel Contoh",
  city: "Kab. Bogor",
  area: "Ciawi",
  category: "hotel",
  email: "budi@hotelexample.com",
  phone: "+62 812-3456-7890",
  website: "",
  contactName: "Budi",
  validationStatus: "verified",
  latitude: -6.6,
  longitude: 106.8,
  coordinateSource: "OpenStreetMap node",
  screeningStatus: "clear",
  validationEvidence: [
    "Nomor PIC +62 812-3456-7890 tercantum bersama PIC Budi pada https://hotel.example.com/kontak.",
  ],
};

test("Penulis Prospek menyimpan lead yang sudah lolos syarat Telegram", async () => {
  const db = fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  const result = await publishLeadToProspect(db, "owner-1", lead);
  assert.equal(result.added, true);
  assert.equal(db.state.updated, true);
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies.length, 1);
  assert.equal(data.companies[0].name, "Hotel Contoh");
  assert.equal(data.companies[0].contactName, "Budi");
  assert.equal(data.companies[0].sourceLeadId, "lead-1");
  assert.equal(data.companies[0].validationStatus, "verified");
  assert.equal(data.companies[0].email, "budi@hotelexample.com");
  assert.equal(data.companies[0].website, "");
});

test("Penulis Prospek memperbarui lead yang sudah ada tanpa duplikat", async () => {
  const db = fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  await publishLeadToProspect(db, "owner-1", lead);
  const second = await publishLeadToProspect(db, "owner-1", {
    ...lead,
    contactName: "Budi Santoso",
    // Bukti harus ikut menyebut nama PIC terbaru; bukti lama untuk "Budi"
    // sekarang ditolak karena tidak mengikat orang yang sama.
    validationEvidence: [
      "Nomor PIC +62 812-3456-7890 tercantum bersama PIC Budi Santoso pada https://hotel.example.com/kontak.",
    ],
  });
  assert.equal(second.added, false);
  assert.equal(second.updated, true);
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies.length, 1);
  assert.equal(data.companies[0].contactName, "Budi Santoso");
});

test("Sinkronisasi mengeluarkan Prospek robot yang tidak lagi valid", () => {
  const data = {
    companies: [
      {
        id: "co_robot_1",
        name: "Hotel Contoh",
        source: "Corporate Engine · Robot AI",
        sourceLeadId: "lead-1",
        validationStatus: "verified",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
  };
  const next = syncRobotCompanies(data as never, [
    { ...lead, validationStatus: "partial" } as never,
  ]);
  assert.equal(next.companies.length, 0);
});

test("Sinkronisasi robot tidak menimpa koordinat yang sudah dikoreksi", () => {
  const data = {
    companies: [
      {
        id: "co_robot_1",
        name: "Hotel Contoh",
        location: "Jakarta",
        source: "Corporate Engine · Robot AI",
        sourceLeadId: "lead-1",
        latitude: -6.3569892,
        longitude: 106.7802015,
        coordinateSource: "Dikonfirmasi manual",
        coordinateAddress: "Titik yang sudah dicek",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
  };
  const next = syncRobotCompanies(data as never, [
    {
      ...lead,
      latitude: -6.3563,
      longitude: 106.7809,
      coordinateSource: "Panel AI (disetujui Verifier)",
    } as never,
  ]);
  assert.equal(next.companies[0].latitude, -6.3569892);
  assert.equal(next.companies[0].longitude, 106.7802015);
  assert.equal(next.companies[0].coordinateSource, "Dikonfirmasi manual");
  assert.equal(next.companies[0].coordinateAddress, "Titik yang sudah dicek");
});

test("Sinkronisasi robot tidak memasukkan koordinat yang belum terverifikasi", () => {
  const data = {
    companies: [
      {
        id: "co_robot_1",
        name: "Hotel Contoh",
        location: "Jakarta",
        source: "Corporate Engine · Robot AI",
        sourceLeadId: "lead-1",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
  };
  const next = syncRobotCompanies(data as never, [
    {
      ...lead,
      latitude: -6.3563,
      longitude: 106.7809,
      coordinateSource: "Panel AI (disetujui Verifier)",
    } as never,
  ]);
  assert.equal(next.companies[0].latitude, undefined);
  assert.equal(next.companies[0].longitude, undefined);
  assert.equal(next.companies[0].coordinateSource, undefined);
});

test("Penulis Prospek tidak menimpa koordinat yang sudah dikoreksi", async () => {
  const db = fakeStateDb({
    companies: [
      {
        id: "co_robot_existing",
        name: "Hotel Contoh",
        source: "Corporate Engine · Robot AI",
        sourceLeadId: "lead-1",
        latitude: -6.3569892,
        longitude: 106.7802015,
        coordinateSource: "Dikonfirmasi manual",
        coordinateAddress: "Titik yang sudah dicek",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  await publishLeadToProspect(db, "owner-1", {
    ...lead,
    latitude: -6.3563,
    longitude: 106.7809,
    coordinateSource: "Panel AI (disetujui Verifier)",
  });
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies.length, 1);
  assert.equal(data.companies[0].latitude, -6.3569892);
  assert.equal(data.companies[0].longitude, 106.7802015);
  assert.equal(data.companies[0].coordinateSource, "Dikonfirmasi manual");
  assert.equal(data.companies[0].coordinateAddress, "Titik yang sudah dicek");
});

test("Penulis Prospek tidak menimpa Prospek manual dengan nama sama", async () => {
  const db = fakeStateDb({
    companies: [
      {
        id: "co_manual",
        name: "Hotel Contoh",
        source: "Input manual",
        email: "manual@example.com",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  const result = await publishLeadToProspect(db, "owner-1", lead);
  const data = JSON.parse(db.state.payload);
  assert.equal(result.added, true);
  assert.equal(data.companies.length, 2);
  assert.equal(data.companies.find((item) => item.id === "co_manual").email, "manual@example.com");
});

test("Penulis Prospek mempertahankan field lama saat data baru kosong", async () => {
  const db = fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  await publishLeadToProspect(db, "owner-1", {
    ...lead,
    email: "hotel@example.com",
    website: "https://hotel.example.com",
  });
  await publishLeadToProspect(db, "owner-1", {
    ...lead,
    email: "",
    website: "",
    contactRole: "",
  });
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies[0].email, "hotel@example.com");
  assert.equal(data.companies[0].website, "https://hotel.example.com");
});

test("Penulis Prospek menolak lead yang belum dinyatakan valid oleh Klarifikasi", async () => {
  const db = fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  const result = await publishLeadToProspect(db, "owner-1", {
    ...lead,
    validationStatus: "partial",
  });
  assert.equal(result.added, false);
  assert.match(result.reason, /valid|e-mail|identitas/i);
  assert.equal(db.state.updated, false);
});

test("Penulis Prospek menolak lead tanpa nama atau nomor PIC", async () => {
  const db = fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
  const result = await publishLeadToProspect(db, "owner-1", {
    ...lead,
    contactName: "",
  });
  assert.equal(result.added, false);
  assert.match(result.reason, /PIC/);
  assert.equal(db.state.updated, false);
});

function fakeAuditDb(companies: Record<string, unknown>[], rows: Record<string, unknown>[]) {
  const updates: string[] = [];
  return {
    updates,
    prepare(sql: string) {
      if (/SELECT payload FROM app_state/.test(sql)) {
        return {
          bind: () => ({
            first: async () => ({ payload: JSON.stringify({ companies }) }),
          }),
        };
      }
      if (/FROM corporate_leads l/.test(sql)) {
        return { bind: () => ({ all: async () => ({ results: rows }) }) };
      }
      if (/UPDATE corporate_robot_jobs/.test(sql)) {
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              updates.push(String(args[2] ?? ""));
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

test("Audit Telegram menjelaskan lead yang belum masuk Prospek", async () => {
  const rows = [
    { lead_id: "in", name: "Hotel A", contact_name: "Ani", phone: "081234567890", job_stage: "done" },
    { lead_id: "eligible", name: "Hotel B", contact_name: "Budi", phone: "081234567891", job_stage: "done", city: "Jakarta", latitude: -6.2, longitude: 106.8, coordinate_source: "OpenStreetMap node" },
    { lead_id: "queued", name: "Hotel C", contact_name: "Cici", phone: "081234567892", job_stage: "publish_prospect", city: "Jakarta", latitude: -6.2, longitude: 106.8, coordinate_source: "OpenStreetMap node" },
    { lead_id: "no-pic", name: "Hotel D", contact_name: "", phone: "081234567893", job_stage: "paused" },
    { lead_id: "bad-phone", name: "Hotel E", contact_name: "Eka", phone: "", job_stage: "paused" },
  ];
  const db = fakeAuditDb([{ id: "co_a", sourceLeadId: "in", name: "Hotel A" }], rows);
  const audit = await auditTelegramProspects(db, "owner-1");
  assert.equal(audit.telegramSent, 5);
  assert.equal(audit.inProspect, 1);
  assert.equal(audit.queued, 1);
  assert.equal(audit.eligible, 1);
  assert.equal(audit.notEligible, 2);
  assert.deepEqual(audit.reasons.map((item) => item.reason), [
    "Nama PIC kosong.",
    "Nomor PIC kosong atau tidak valid.",
  ]);
});

function fakeHistoryDb(data: {
  companies: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
}) {
  return {
    prepare(sql: string) {
      if (/SELECT payload FROM app_state/.test(sql)) {
        return {
          bind: () => ({ first: async () => ({ payload: JSON.stringify({ companies: data.companies }) }) }),
        };
      }
      if (/FROM corporate_leads WHERE id IN/.test(sql)) {
        return { bind: () => ({ all: async () => ({ results: data.leads }) }) };
      }
      if (/FROM corporate_robot_jobs j/.test(sql)) {
        return { bind: () => ({ all: async () => ({ results: data.jobs }) }) };
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

test("Audit terbalik memisahkan Prospek lama dan antrean yang tidak sinkron", async () => {
  const db = fakeHistoryDb({
    companies: [
      { id: "co_sent", name: "Terkirim", sourceLeadId: "sent", source: "Corporate Engine · Robot AI" },
      { id: "co_pending", name: "Tertunda", sourceLeadId: "pending", source: "Corporate Engine · Robot AI" },
      { id: "co_no_note", name: "Tanpa Catatan", sourceLeadId: "done", source: "Corporate Engine · Robot AI" },
      { id: "co_no_source", name: "Tanpa Sumber", source: "Corporate Engine · Robot AI" },
      { id: "co_missing", name: "Lead Hilang", sourceLeadId: "missing", source: "Corporate Engine · Robot AI" },
      { id: "co_manual", name: "Manual", source: "Corporate Engine · Manual" },
    ],
    leads: [
      { id: "sent", name: "Terkirim" },
      { id: "pending", name: "Tertunda" },
      { id: "done", name: "Tanpa Catatan" },
    ],
    jobs: [
      { lead_id: "sent", stage: "done", telegram_sent_at: "2026-11-15T00:00:00Z", outbox_status: "sent" },
      { lead_id: "pending", stage: "publish_telegram", telegram_sent_at: "", outbox_status: "pending" },
      { lead_id: "done", stage: "done", telegram_sent_at: "", outbox_status: "" },
      { lead_id: "missing", stage: "done", telegram_sent_at: "", outbox_status: "" },
    ],
  });
  const audit = await auditProspectTelegramHistory(db, "owner-1");
  assert.equal(audit?.totalProspects, 6);
  assert.equal(audit?.robotCompanies, 5);
  assert.equal(audit?.manualCompanies, 1);
  assert.equal(audit?.withTelegram, 1);
  assert.equal(audit?.withoutTelegram, 4);
  assert.deepEqual(audit?.categories, {
    "tanpa-source": 1,
    "lead-hilang": 1,
    "job-hilang": 0,
    "antrean-telegram": 1,
    "perlu-ditinjau": 0,
    "tanpa-catatan": 1,
    "belum-terkirim": 0,
  });
});

test("Rekonsiliasi hanya memasukkan lead terkirim yang memenuhi syarat", async () => {
  const rows = [
    { lead_id: "eligible", name: "Hotel B", contact_name: "Budi", phone: "081234567891", job_stage: "done", city: "Jakarta", latitude: -6.2, longitude: 106.8, coordinate_source: "OpenStreetMap node" },
    { lead_id: "no-pic", name: "Hotel D", contact_name: "", phone: "081234567893", job_stage: "paused" },
  ];
  const db = fakeAuditDb([], rows);
  const result = await reconcileTelegramProspects(db, "owner-1");
  assert.equal(result.eligible, 1);
  assert.equal(result.requeued, 1);
  assert.deepEqual(db.updates, ["eligible"]);
  assert.equal(result.notEligible, 1);
});

test("Kurir Telegram menolak lead yang belum dinyatakan valid oleh Klarifikasi", () => {
  const message = buildTelegramMessage({
    name: "PT Contoh",
    city: "Kota Bogor",
    category: "company",
    contactName: "Budi Santoso",
    contactRole: "IT Manager",
    phone: "08123456789",
    email: "info@contoh.co.id",
    latitude: -6.59,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "clear",
    validationStatus: "partial",
    validationEvidence: [
      "Nomor PIC 08123456789 tercantum bersama PIC Budi Santoso pada https://contoh.co.id/kontak.",
      "E-mail yang ditemukan masih generik (info/sales/admin), bukan e-mail PIC.",
    ],
  });
  assert.equal(message, "");
});

test("Kurir Telegram menolak koordinat yang belum dikonfirmasi", () => {
  const message = buildTelegramMessage({
    name: "Lazuardi Global Islamic School",
    city: "Depok",
    category: "school",
    contactName: "Budi Santoso",
    contactRole: "Kepala Sekolah",
    phone: "08123456789",
    latitude: -6.3562728,
    longitude: 106.7804875,
    coordinateSource: "Nominatim/OpenStreetMap",
    validationStatus: "verified",
  });
  assert.equal(message, "");
});

test("Prospek robot tidak dibuang hanya karena e-mail/website kosong", () => {
  const robot = {
    id: "co_robot_1",
    name: "Hotel Contoh",
    contactName: "Budi",
    picPhone: "081234567890",
    email: "",
    website: "",
    sourceLeadId: "lead-1",
    source: "Corporate Engine · Robot AI",
    screeningStatus: "clear",
  };
  const data = {
    companies: [
      robot,
      {
        ...robot,
        id: "co_robot_2",
        name: "Tanpa PIC",
        contactName: "",
        picPhone: "",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
  };
  const result = pruneIncompleteRobotCompanies(data as never);
  assert.deepEqual(result.companies.map((company) => company.id), ["co_robot_1"]);
  assert.equal(isLeadPublishable(lead as never), true);
});

test("publish Prospek menolak review OpenSanctions yang belum dikonfirmasi", async () => {
  const result = await publishLeadToProspect(null as never, "owner-1", {
    id: "lead-review",
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "review",
  } as never);
  assert.equal(result.added, false);
});

test("backfill screening tanpa key tidak menyentuh antrean", async () => {
  const result = await backfillCorporateScreening(null as never, {} as never, 5);
  assert.equal(result.skipped, true);
  assert.equal(result.checked, 0);
});

test("sinkronisasi menghapus Prospek robot yang review screening-nya belum dikonfirmasi", () => {
  const data = {
    companies: [
      {
        id: "co_review",
        name: "Hotel Review",
        source: "Corporate Engine",
        sourceLeadId: "lead-review",
      },
    ],
    quotes: [],
    locations: [],
  };
  const next = syncRobotCompanies(data as never, [
    {
      id: "lead-review",
      name: "Hotel Review",
      contactName: "Budi",
      phone: "081234567890",
      latitude: -6.2,
      longitude: 106.8,
      coordinateSource: "OpenStreetMap node",
      screeningStatus: "review",
    } as never,
  ]);
  assert.deepEqual(next.companies, []);
});

test("error kuota tidak menghapus Prospek lama tetapi tetap menahan publish", () => {
  const data = {
    companies: [
      {
        id: "co_error",
        name: "Hotel Error",
        source: "Corporate Engine",
        sourceLeadId: "lead-error",
      },
    ],
    quotes: [],
    locations: ["Jakarta"],
  };
  const next = syncRobotCompanies(data as never, [
    {
      id: "lead-error",
      name: "Hotel Error",
      contactName: "Budi",
      phone: "081234567890",
      latitude: -6.2,
      longitude: 106.8,
      coordinateSource: "OpenStreetMap node",
      validationStatus: "verified",
      screeningStatus: "error",
      screeningEvidence: ["OpenSanctions: kuota/billing API habis (HTTP 402)."],
    } as never,
  ]);
  assert.deepEqual(next.companies.map((company) => company.id), ["co_error"]);
  assert.equal(
    isLeadPublishable({
      name: "Hotel Error",
      contactName: "Budi",
      phone: "081234567890",
      latitude: -6.2,
      longitude: 106.8,
      coordinateSource: "OpenStreetMap node",
      screeningStatus: "error",
    } as never),
    false,
  );
});

test("review OpenSanctions yang belum dikonfirmasi menahan tombol manual Corporate", () => {
  const lead = {
    id: "osm:node/1",
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "review",
  };
  assert.equal(isCorporateLeadAddable(lead as never, true), false);
  assert.equal(
    isCorporateLeadAddable(
      { ...lead, screeningReviewedAt: "2026-11-17T05:00:00.000Z" } as never,
      true,
    ),
    true,
  );
  assert.equal(
    isCorporateLeadAddable({ ...lead, screeningStatus: "clear" } as never, true),
    true,
  );
});

test("Prospek robot tidak menyimpan titik pusat wilayah", () => {
  const data = {
    companies: [
      {
        id: "co_bad",
        name: "Akademi Contoh",
        source: "Corporate Engine",
        sourceLeadId: "osm:node/1",
        latitude: -6.225,
        longitude: 106.825,
        coordinateAddress: "Jakarta",
        coordinateSource: "OpenStreetMap node",
      },
    ],
  };
  const cleaned = scrubRobotCompanyCoordinates(data as never);
  assert.equal(cleaned.companies[0].latitude, 0);
  assert.equal(cleaned.companies[0].longitude, 0);
  assert.equal(cleaned.companies[0].coordinateSource, "");
});

test("screening error, disabled, dan belum diperiksa menahan sampai ditinjau", () => {
  const lead = {
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
  };
  for (const screeningStatus of ["error", "disabled", ""]) {
    assert.equal(
      isLeadPublishable({ ...lead, screeningStatus } as never),
      false,
      `status ${screeningStatus || "kosong"} harus tertahan`,
    );
    assert.equal(
      isCorporateLeadAddable({ ...lead, screeningStatus } as never, true),
      false,
      `manual ${screeningStatus || "kosong"} harus tertahan`,
    );
    assert.equal(
      isLeadPublishable({
        ...lead,
        screeningStatus,
        screeningReviewedAt: "2026-11-18T05:00:00.000Z",
      } as never),
      true,
      `status ${screeningStatus || "kosong"} boleh lanjut setelah ditinjau`,
    );
  }
});

test("alasan penahanan membedakan risiko, kuota 402, nonaktif, dan belum diperiksa", () => {
  assert.match(
    screeningHoldReason({ screeningStatus: "review" }),
    /kandidat berisiko/,
  );
  assert.match(
    screeningHoldReason({
      screeningStatus: "error",
      screeningEvidence: ["OpenSanctions: kuota/billing API habis (HTTP 402)."],
    }),
    /kuota\/billing/,
  );
  assert.match(
    screeningHoldReason({ screeningStatus: "disabled" }),
    /belum aktif/,
  );
  assert.match(
    screeningHoldReason({ screeningStatus: "" }),
    /belum dijalankan/,
  );
});

test("error kuota 402 non-blocking tetapi tetap ditandai error", () => {
  const lead = {
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "error",
    screeningEvidence: ["OpenSanctions: kuota/billing API habis (HTTP 402)."],
  };
  assert.equal(screeningReviewRequired(lead as never), false);
  assert.equal(isLeadPublishable(lead as never), true);
  assert.equal(isCorporateLeadAddable(lead as never, true), true);
  assert.equal(screeningBadgeView(lead as never).label, "OpenSanctions kuota 402");
  assert.equal(screeningBadgeView(lead as never).tone, "error");
});

test("badge screening membedakan review, error kuota, nonaktif, dan belum diperiksa", () => {
  assert.equal(screeningBadgeView({ screeningStatus: "review" }).label, "OpenSanctions review");
  assert.equal(screeningBadgeView({ screeningStatus: "error" }).label, "OpenSanctions error");
  assert.equal(
    screeningBadgeView({
      screeningStatus: "error",
      screeningEvidence: ["OpenSanctions: kuota/billing API habis (HTTP 402)."],
    }).label,
    "OpenSanctions kuota 402",
  );
  assert.equal(
    screeningBadgeView({ screeningStatus: "disabled" }).label,
    "OpenSanctions belum aktif",
  );
  assert.equal(
    screeningBadgeView({ screeningStatus: "" }).label,
    "Screening belum diperiksa",
  );
  assert.equal(
    screeningBadgeView(
      { screeningStatus: "error", screeningReviewedAt: "2026-11-18T05:00:00.000Z" },
    ).label,
    "Error · ditinjau",
  );
});

test("tinjauan manual dapat melepas penahanan error 402 tanpa mengubah status screening", async () => {
  const updates: string[] = [];
  const db = {
    batch: async () => undefined,
    prepare(sql: string) {
      if (/SELECT id, screening_status FROM corporate_leads/.test(sql)) {
        return {
          bind: () => ({
            first: async () => ({ id: "lead-error", screening_status: "error" }),
          }),
        };
      }
      if (/UPDATE corporate_leads/.test(sql)) {
        return {
          bind: () => ({
            run: async () => {
              updates.push(sql);
              return { meta: { changes: 1 } };
            },
          }),
        };
      }
      if (/UPDATE corporate_robot_jobs/.test(sql)) {
        return {
          bind: () => ({
            run: async () => {
              updates.push(sql);
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
  const result = await reviewCorporateScreening(
    db as never,
    "owner-1",
    "lead-error",
    true,
  );
  assert.equal(result.ok, true);
  assert.equal(result.reviewed, true);
  assert.match(result.message, /Tinjauan manual/);
  assert.equal(
    updates.some((sql) => /screening_reviewed_at = \?/.test(sql)),
    true,
  );
});

test("publish Prospek menolak screening disabled/kosong tanpa konfirmasi", async () => {
  for (const screeningStatus of ["disabled", ""]) {
    const result = await publishLeadToProspect(null as never, "owner-1", {
      ...lead,
      screeningStatus,
    } as never);
    assert.equal(
      result.added,
      false,
      `publish ${screeningStatus || "kosong"} harus ditolak`,
    );
  }
});

/**
 * Jalur publish nyata: sendPublishTelegram (pengirim Telegram) dan
 * publishLeadToProspect (penulis Prospek). Setiap lead cacat harus menghasilkan
 * nol panggilan jaringan Telegram dan nol baris baru di Prospek.
 */
const publishReadyLead = {
  id: "lead-gate",
  name: "PT Contoh Nusantara",
  city: "Kab. Bogor",
  area: "Ciawi",
  category: "company",
  email: "budi.santoso@contoh.co.id",
  phone: "081234567890",
  contactName: "Budi Santoso",
  contactRole: "IT Manager",
  latitude: -6.6,
  longitude: 106.8,
  coordinateSource: "OpenStreetMap node",
  screeningStatus: "clear",
  validationStatus: "verified",
  validationEvidence: [
    "Nomor PIC 081234567890 tercantum bersama PIC Budi Santoso pada https://contoh.co.id/kontak.",
  ],
};

function emptyProspectDb() {
  return fakeStateDb({
    companies: [],
    quotes: [],
    locations: ["Jakarta"],
    profile: {},
  });
}

async function expectPublishBlocked(caseName: string, badLead: Record<string, unknown>) {
  const telegramSettings = { telegram_chat_id: "chat-1", auto_publish: true };
  const env = { TELEGRAM_BOT_TOKEN: "token-uji", TELEGRAM_CHAT_ID: "chat-1" };
  const db = emptyProspectDb();
  let telegramCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    telegramCalls += 1;
    throw new Error("Telegram tidak boleh dipanggil untuk lead tidak valid");
  }) as typeof fetch;
  let telegramResult: { ok: boolean } = { ok: true };
  let prospectResult: { added: boolean } = { added: true };
  try {
    telegramResult = await sendPublishTelegram(
      db as never,
      { lead_id: String(badLead.id || ""), telegram_sent_at: "" } as never,
      env as never,
      telegramSettings as never,
      badLead as never,
    );
    prospectResult = await publishLeadToProspect(db as never, "owner-1", badLead as never);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(telegramResult.ok, false, `${caseName}: Telegram harus menolak`);
  assert.equal(telegramCalls, 0, `${caseName}: tidak boleh ada panggilan Telegram`);
  assert.equal(prospectResult.added, false, `${caseName}: Prospek harus menolak`);
  assert.equal(db.state.updated, false, `${caseName}: Prospek tidak boleh ditulis`);
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies.length, 0, `${caseName}: tidak boleh ada baris Prospek baru`);
}

test("fixture publish siap terbit sehingga penolakan berasal dari cacat yang diuji", () => {
  assert.match(buildTelegramMessage(publishReadyLead as never), /Nama PIC : Budi Santoso/);
});

test("publish menolak lead yang validationStatus-nya bukan verified", async () => {
  for (const status of ["partial", "missing", ""]) {
    await expectPublishBlocked(`status ${status || "kosong"}`, {
      ...publishReadyLead,
      validationStatus: status,
    });
  }
});

test("publish menolak lead verified tanpa e-mail PIC atau e-mail generik", async () => {
  await expectPublishBlocked("e-mail kosong", { ...publishReadyLead, email: "" });
  await expectPublishBlocked("e-mail generik", {
    ...publishReadyLead,
    email: "info@contoh.co.id",
  });
});

test("publish menolak lead verified dengan nomor PIC kosong atau tidak valid", async () => {
  await expectPublishBlocked("nomor kosong", { ...publishReadyLead, phone: "" });
  await expectPublishBlocked("nomor tidak valid", { ...publishReadyLead, phone: "12345" });
  await expectPublishBlocked("nomor kantor", {
    ...publishReadyLead,
    phone: "021-555-1234",
  });
});

test("publish menolak lead verified dengan nama PIC kosong atau placeholder", async () => {
  await expectPublishBlocked("nama kosong", { ...publishReadyLead, contactName: "" });
  await expectPublishBlocked("nama placeholder", {
    ...publishReadyLead,
    contactName: "Admin",
  });
  await expectPublishBlocked("nama penerima tamu", {
    ...publishReadyLead,
    contactName: "Resepsionis",
  });
});

test("publish menolak bukti satu halaman yang menyebut orang lain", async () => {
  // Nama dan nomor valid, tetapi bukti mengikat nomor ke PIC lain.
  await expectPublishBlocked("nama bukti berbeda", {
    ...publishReadyLead,
    validationEvidence: [
      "Nomor PIC 081234567890 tercantum bersama PIC Siti Aminah pada https://contoh.co.id/kontak.",
    ],
  });
  // Nama cocok, tetapi nomor pada bukti nomor orang lain.
  await expectPublishBlocked("nomor bukti berbeda", {
    ...publishReadyLead,
    validationEvidence: [
      "Nomor PIC 081298765432 tercantum bersama PIC Budi Santoso pada https://contoh.co.id/kontak.",
    ],
  });
  // Bukti hanya nomor kantor/CS tanpa mengikat nama PIC.
  await expectPublishBlocked("bukti tanpa ikatan", {
    ...publishReadyLead,
    validationEvidence: ["Nomor kantor 081234567890 tertera di halaman kontak."],
  });
});

test("Publish menyimpan hasil screening sehingga record bisa diaudit ulang", async () => {
  const quotaLead = {
    ...publishReadyLead,
    screeningStatus: "error",
    screeningEvidence: ["OpenSanctions HTTP 402: kuota/billing API habis."],
    screeningCheckedAt: "2026-11-18T06:00:00.000Z",
  };
  const db = emptyProspectDb();
  const first = await publishLeadToProspect(db, "owner-1", quotaLead as never);
  assert.equal(first.added, true, first.reason);
  const saved = JSON.parse(db.state.payload).companies[0];
  assert.equal(saved.screeningStatus, "error");
  assert.match(saved.screeningEvidence[0], /402/);
  // Audit ulang memakai fungsi gate yang sama terhadap record yang tersimpan.
  const auditDb = emptyProspectDb();
  const audit = await publishLeadToProspect(auditDb, "owner-1", {
    id: saved.sourceLeadId,
    name: saved.name,
    email: saved.email,
    phone: saved.picPhone,
    contactName: saved.contactName,
    contactRole: saved.contactRole,
    latitude: saved.latitude,
    longitude: saved.longitude,
    coordinateSource: saved.coordinateSource,
    validationStatus: saved.validationStatus,
    validationEvidence: saved.validationEvidence,
    screeningStatus: saved.screeningStatus,
    screeningEvidence: saved.screeningEvidence,
  } as never);
  assert.equal(audit.added, true, audit.reason);
});

test("lead dengan review OpenSanctions belum dikonfirmasi ditahan dari Prospek", () => {
  const lead = {
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "review",
  };
  assert.equal(isLeadPublishable(lead as never), false);
  assert.equal(
    isLeadPublishable({
      ...lead,
      screeningReviewedAt: "2026-11-17T04:00:00.000Z",
    } as never),
    true,
  );
  assert.equal(
    isLeadPublishable({ ...lead, screeningStatus: "clear" } as never),
    true,
  );
});
