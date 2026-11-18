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
  runFindingQualifierAgent,
} from "../worker/robot.js";
import {
  isCorporateLeadAddable,
  isLeadPublishable,
  pruneIncompleteRobotCompanies,
  scrubRobotCompanyCoordinates,
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

test("Kurir Telegram menolak nama resepsionis, placeholder, dan beberapa nama", () => {
  const base = {
    name: "Hotel Contoh",
    city: "Jakarta",
    category: "hotel",
    phone: "08123456789",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
    screeningStatus: "clear",
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
  email: "",
  phone: "+62 812-3456-7890",
  website: "",
  contactName: "Budi",
  validationStatus: "partial",
  latitude: -6.6,
  longitude: 106.8,
  coordinateSource: "OpenStreetMap node",
  screeningStatus: "clear",
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
  assert.equal(data.companies[0].validationStatus, "partial");
  assert.equal(data.companies[0].email, "");
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
  });
  assert.equal(second.added, false);
  assert.equal(second.updated, true);
  const data = JSON.parse(db.state.payload);
  assert.equal(data.companies.length, 1);
  assert.equal(data.companies[0].contactName, "Budi Santoso");
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

test("screening error tidak menahan publish; status yang belum diperiksa tetap menahan", () => {
  const lead = {
    name: "Hotel Contoh",
    contactName: "Budi",
    phone: "081234567890",
    latitude: -6.2,
    longitude: 106.8,
    coordinateSource: "OpenStreetMap node",
  };
  assert.equal(
    isLeadPublishable({ ...lead, screeningStatus: "error" } as never),
    true,
    "error kuota harus tetap bisa diproses dan ditandai untuk review",
  );
  assert.equal(
    isCorporateLeadAddable({ ...lead, screeningStatus: "error" } as never, true),
    true,
  );
  for (const screeningStatus of ["disabled", ""]) {
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
  }
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
