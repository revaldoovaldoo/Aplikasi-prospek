import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeaderReply,
  handleTelegramLeaderWebhook,
  isRetryRequest,
  readLeaderSnapshot,
} from "../worker/leader.js";

const snapshot = {
  data: {
    companies: [
      { id: "1", name: "Alpha", lostAt: "" },
      { id: "2", name: "Beta", lostAt: "" },
      { id: "3", name: "Gamma", lostAt: "2026-01-01" },
    ],
    quotes: [
      { id: "q1", quoteFile: { id: "f1" }, status: "penawaran" },
      { id: "q2", quoteFile: { id: "f2" }, status: "po" },
    ],
  },
  stats: {
    searches: 12,
    finding: 2,
    clarification: 3,
    publishTelegram: 1,
    publishProspect: 4,
    published: 5,
    notified: 6,
    done: 7,
    paused: 0,
  },
  lastRun: null,
  lastRunAt: "",
  settings: null,
};

test("AI Leader menjawab progress seluruh tim dalam bahasa Indonesia", () => {
  const reply = buildLeaderReply("Bagaimana progress tim?", snapshot);
  assert.match(reply, /Progress Tim Robot/);
  assert.match(reply, /Finding/);
  assert.match(reply, /Klarifikasi/);
  assert.match(reply, /Publish Telegram/);
  assert.match(reply, /12/);
});

test("AI Leader menjawab jumlah prospek dari data aplikasi", () => {
  const reply = buildLeaderReply("Berapa banyak prospek saya?", snapshot);
  assert.match(reply, /Total prospek/);
  assert.match(reply, /2/);
});

test("AI Leader menjawab status penawaran", () => {
  const reply = buildLeaderReply("status penawaran", snapshot);
  assert.match(reply, /PDF penawaran/);
  assert.match(reply, /PO/);
});

const locationSnapshot = {
  ...snapshot,
  leads: [
    {
      name: "Aston Hotel Bogor",
      city: "Kab. Bogor",
      area: "Ciawi",
      category: "hotel",
      contactName: "Nurhayati",
      phone: "+62 815-5333-2602",
    },
    {
      name: "Kian Mas Boutique Resort",
      city: "Kab. Bogor",
      area: "Ciawi",
      category: "hotel",
      contactName: "Putri Sales",
      phone: "0812-3456-7890",
    },
    {
      name: "SMAN 1 Cibinong",
      city: "Kab. Bogor",
      category: "school",
      contactName: "Budi Santoso",
      phone: "0813-1111-2222",
    },
    {
      name: "PT Sentul Teknologi",
      city: "Kab. Bogor",
      category: "company",
      contactName: "Rina",
      phone: "0814-3333-4444",
    },
    {
      name: "Hotel Jakarta Pusat",
      city: "Jakarta",
      category: "hotel",
      contactName: "Andi",
      phone: "0815-5555-6666",
    },
  ],
};

test("AI Leader menyebut nama dan PIC lead sesuai kabupaten yang ditanyakan", () => {
  const reply = buildLeaderReply(
    "berikan saya nama hotel/perusahaan/sekolah untuk kabupaten bogor",
    locationSnapshot,
  );
  assert.match(reply, /Kab\. Bogor/);
  assert.match(reply, /Aston Hotel Bogor/);
  assert.match(reply, /SMAN 1 Cibinong/);
  assert.match(reply, /PT Sentul Teknologi/);
  assert.match(reply, /Nurhayati/);
  assert.match(reply, /wa\.me\/6281553332602/);
  assert.doesNotMatch(reply, /Hotel Jakarta Pusat/);
});

test("AI Leader tetap menampilkan daftar saat lokasi disebut singkat", () => {
  const reply = buildLeaderReply("Untuk kabupaten bogor", locationSnapshot);
  assert.match(reply, /Aston Hotel Bogor/);
  assert.match(reply, /SMAN 1 Cibinong/);
  assert.match(reply, /PT Sentul Teknologi/);
});

test("AI Leader merangkum semua lokasi yang diproses Tim Robot", () => {
  const reply = buildLeaderReply("lokasi apa saja yang diproses tim robot?", locationSnapshot);
  assert.match(reply, /Cakupan Lokasi Tim Robot/);
  assert.match(reply, /Kab\. Bogor/);
  assert.match(reply, /Jakarta/);
  assert.match(reply, /<b>5<\/b> lead/);
});

test("AI Leader hanya menghitung lead yang punya telepon atau e-mail", () => {
  const reply = buildLeaderReply("hotel di kabupaten bogor", {
    ...locationSnapshot,
    leads: [
      ...locationSnapshot.leads,
      {
        name: "Hotel Nama Saja",
        city: "Kab. Bogor",
        category: "hotel",
        contactName: "Nama Tanpa Nomor",
        phone: "",
        email: "",
      },
      {
        name: "Hotel Email Saja",
        city: "Kab. Bogor",
        category: "hotel",
        contactName: "",
        phone: "",
        email: "pic@hotel-email.test",
      },
    ],
  });
  assert.doesNotMatch(reply, /Hotel Nama Saja/);
  assert.match(reply, /Hotel Email Saja/);
  assert.match(reply, /pic@hotel-email\.test/);
  assert.match(reply, /Ditemukan <b>3<\/b> lead dengan nomor telepon atau e-mail/);
});

test("AI Leader memfilter cakupan lokasi sesuai kategori yang disebut", () => {
  const reply = buildLeaderReply("hotel di semua lokasi", locationSnapshot);
  assert.match(reply, /Cakupan Lokasi Tim Robot · Hotel/);
  assert.match(reply, /<b>3<\/b> lead hotel/);
  assert.doesNotMatch(reply, /Sekolah \d/);
  assert.doesNotMatch(reply, /Perusahaan \d/);
});

test("AI Leader hanya memicu kirim ulang saat diminta eksplisit", () => {
  assert.equal(isRetryRequest("tolong kirim ulang pesan macet"), true);
  assert.equal(isRetryRequest("berapa prospek saya"), false);
  assert.equal(isRetryRequest("kenapa pesan macet?"), false);
});

test("readLeaderSnapshot hanya menjalankan SELECT dan tidak menulis data robot", async () => {
  const statements: string[] = [];
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      const chain = {
        bind() {
          return chain;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          if (/FROM corporate_robot_settings/.test(sql)) {
            return { owner_id: "owner-1", telegram_chat_id: "123" };
          }
          if (/FROM corporate_robot_runs/.test(sql)) {
            return {
              started_at: "2026-11-14T20:00:00.000Z",
              finished_at: "2026-11-14T20:01:00.000Z",
              checked: 1,
              found: 1,
              published: 1,
              notified: 0,
              error: "",
            };
          }
          if (/FROM app_state/.test(sql)) {
            return {
              payload: JSON.stringify({ companies: [{ id: "c1", lostAt: "" }], quotes: [] }),
            };
          }
          return {};
        },
        async run() {
          writes.push(sql);
          throw new Error("read-only snapshot attempted a write");
        },
      };
      return chain;
    },
  };

  const result = await readLeaderSnapshot(db);
  assert.equal(writes.length, 0);
  assert.ok(statements.length > 0);
  assert.ok(statements.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.equal(result.ownerId, "owner-1");
  assert.equal(result.settings?.telegram_chat_id, "123");
  assert.equal(result.stats.searches, 0);
  assert.equal(result.data?.companies.length, 1);
  assert.deepEqual(result.leads, []);
});

test("AI Leader menjawab antrean Telegram dan prioritas kerja", () => {
  const snapshotWithQueue = {
    ...snapshot,
    outbox: {
      pending: 1,
      sending: 0,
      sent: 4,
      failed: 2,
      uncertain: 1,
      needsReview: 0,
      retryable: 2,
      total: 8,
      attention: 3,
    },
  };
  const queue = buildLeaderReply("status antrean telegram", snapshotWithQueue);
  assert.match(queue, /Antrean Telegram/);
  assert.match(queue, /Gagal/);
  const advice = buildLeaderReply("apa prioritas kerja saya", snapshotWithQueue);
  assert.match(advice, /Prioritas Kerja/);
  assert.match(advice, /Follow up|Buat penawaran|Periksa/);
});

test("AI Leader menjawab detail perusahaan dan nomor penawarannya", () => {
  const reply = buildLeaderReply("status PT Alpha", {
    ...snapshot,
    data: {
      companies: [{ id: "1", name: "PT Alpha", location: "Jakarta", lostAt: "" }],
      quotes: [
        {
          id: "q1",
          companyId: "1",
          number: "004/UAS/QUOT-PANE/XI/2026",
          date: "2026-11-03",
          status: "po",
          poAmount: 10000000,
          poCommission: 1000000,
          quoteFile: { id: "f1" },
          updatedAt: "2026-11-03T00:00:00.000Z",
        },
      ],
    },
  });
  assert.match(reply, /PT Alpha/);
  assert.match(reply, /004\/UAS\/QUOT-PANE\/XI\/2026/);
  assert.match(reply, /Rp 10\.000\.000/);
});

test("pertanyaan bebas dijawab lewat jalur AI read-only", async () => {
  const writes: string[] = [];
  const replies: { text: string; options: Record<string, unknown> }[] = [];
  const db = {
    prepare(sql: string) {
      if (/SELECT value FROM corporate_meta/.test(sql)) {
        return { bind: () => ({ first: async () => ({ value: "secret-benar" }) }) };
      }
      if (/INSERT INTO corporate_meta/.test(sql)) {
        return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
      }
      writes.push(sql);
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const request = {
    headers: new Headers({ "x-telegram-bot-api-secret-token": "secret-benar" }),
    json: async () => ({
      update_id: 9002,
      message: {
        chat: { id: 123, type: "private" },
        text: "jelaskan peluang kerja yang paling penting",
      },
    }),
  };
  const result = await handleTelegramLeaderWebhook(db, {}, request, {
    readLeaderSnapshot: async () => ({ ...snapshot, settings: { telegram_chat_id: "123" } }),
    askJenova: async () => "Jawaban bebas dari data aplikasi.",
    sendTelegram: async (_env, _settings, text, options) => {
      replies.push({ text, options: options || {} });
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Jawaban bebas/);
  assert.equal(replies[0].options.parseMode, "plain");
  assert.equal(writes.length, 0);
});

test("pertanyaan daftar per lokasi dijawab dari data tanpa model", async () => {
  let aiCalled = false;
  const replies: string[] = [];
  const db = {
    prepare(sql: string) {
      if (/SELECT value FROM corporate_meta/.test(sql)) {
        return { bind: () => ({ first: async () => ({ value: "secret-benar" }) }) };
      }
      if (/INSERT INTO corporate_meta/.test(sql)) {
        return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const request = {
    headers: new Headers({ "x-telegram-bot-api-secret-token": "secret-benar" }),
    json: async () => ({
      update_id: 9010,
      message: {
        chat: { id: 123, type: "private" },
        text: "jelaskan daftar hotel di kabupaten bogor",
      },
    }),
  };
  const result = await handleTelegramLeaderWebhook(db, {}, request, {
    readLeaderSnapshot: async () => ({
      ...locationSnapshot,
      settings: { telegram_chat_id: "123" },
    }),
    askJenova: async () => {
      aiCalled = true;
      return "jawaban model";
    },
    sendTelegram: async (_env, _settings, text) => {
      replies.push(text);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(aiCalled, false);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Aston Hotel Bogor/);
  assert.doesNotMatch(replies[0], /jawaban model/);
});

test("webhook hanya memproses satu update_id sekali", async () => {
  let replies = 0;
  const seen = new Set<string>();
  const db = {
    prepare(sql: string) {
      if (/SELECT value FROM corporate_meta/.test(sql)) {
        return { bind: () => ({ first: async () => ({ value: "secret-benar" }) }) };
      }
      if (/INSERT INTO corporate_meta/.test(sql)) {
        return {
          bind: (key: string) => ({
            run: async () => {
              const first = !seen.has(key);
              seen.add(key);
              return { meta: { changes: first ? 1 : 0 } };
            },
          }),
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const body = {
    update_id: 9001,
    message: { chat: { id: 123, type: "private" }, text: "status" },
  };
  const request = () => ({
    headers: new Headers({ "x-telegram-bot-api-secret-token": "secret-benar" }),
    json: async () => body,
  });
  const deps = {
    readLeaderSnapshot: async () => ({ ...snapshot, settings: { telegram_chat_id: "123" } }),
    sendTelegram: async () => {
      replies += 1;
      return { ok: true };
    },
  };

  const first = await handleTelegramLeaderWebhook(db, {}, request(), deps);
  const second = await handleTelegramLeaderWebhook(db, {}, request(), deps);
  assert.equal(first.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(replies, 1);
});

test("webhook AI Leader menolak update tanpa secret yang benar", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return { first: async () => ({ value: "secret-benar" }) };
        },
      };
    },
  };
  const request = {
    headers: new Headers(),
    json: async () => ({ update_id: 1 }),
  };
  const result = await handleTelegramLeaderWebhook(db, {}, request);
  assert.equal(result.status, 401);
  assert.equal(result.ok, false);
});
