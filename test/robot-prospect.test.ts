import assert from "node:assert/strict";
import test from "node:test";
import {
  auditTelegramProspects,
  publishLeadToProspect,
  reconcileTelegramProspects,
} from "../worker/robot.js";
import {
  isLeadPublishable,
  pruneIncompleteRobotCompanies,
} from "../src/lib/corporate.ts";

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
    { lead_id: "eligible", name: "Hotel B", contact_name: "Budi", phone: "081234567891", job_stage: "done" },
    { lead_id: "queued", name: "Hotel C", contact_name: "Cici", phone: "081234567892", job_stage: "publish_prospect" },
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

test("Rekonsiliasi hanya memasukkan lead terkirim yang memenuhi syarat", async () => {
  const rows = [
    { lead_id: "eligible", name: "Hotel B", contact_name: "Budi", phone: "081234567891", job_stage: "done" },
    { lead_id: "no-pic", name: "Hotel D", contact_name: "", phone: "081234567893", job_stage: "paused" },
  ];
  const db = fakeAuditDb([], rows);
  const result = await reconcileTelegramProspects(db, "owner-1");
  assert.equal(result.eligible, 1);
  assert.equal(result.requeued, 1);
  assert.deepEqual(db.updates, ["eligible"]);
  assert.equal(result.notEligible, 1);
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
