import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  getWhatsAppStatus,
  handleWhatsAppWebhook,
  normalizeWaId,
  readWhatsAppWindow,
  sendQuoteWhatsApp,
  sendWhatsAppTemplate,
  verifyWebhookSignature,
  whatsappOutreachConfigured,
} from "../worker/whatsapp.js";

function fakeDb(lastInboundAt = "") {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) {
          statement.args = args;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT last_inbound_at")) {
            return lastInboundAt ? { last_inbound_at: lastInboundAt } : null;
          }
          return null;
        },
        async run() {
          writes.push({ sql, args: statement.args });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

const env = {
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_PHONE_NUMBER_ID: "123456789",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_VERIFY_TOKEN: "verify-token",
  FILES: {
    async get() {
      return {
        size: 12,
        async arrayBuffer() {
          return new TextEncoder().encode("%PDF-1.4 test").buffer;
        },
      };
    },
  },
};

test("normalizeWaId memilih satu nomor PIC dan menolak nomor gabungan", () => {
  assert.equal(normalizeWaId("0812 3456 7890"), "6281234567890");
  assert.equal(normalizeWaId("+62 812-3456-7890"), "6281234567890");
  assert.equal(
    normalizeWaId("0812 3456 7890 / 021 555 1234"),
    "6281234567890",
  );
  assert.equal(normalizeWaId("081234567890081234567891"), "");
});

test("verifyWebhookSignature menerima HMAC yang benar dan menolak yang salah", async () => {
  const body = JSON.stringify({ entry: [] });
  const signature = createHmac("sha256", "app-secret").update(body).digest("hex");
  assert.equal(
    await verifyWebhookSignature("app-secret", body, `sha256=${signature}`),
    true,
  );
  assert.equal(
    await verifyWebhookSignature("app-secret", body, "sha256=deadbeef"),
    false,
  );
});

test("readWhatsAppWindow membuka jendela hanya untuk balasan 24 jam terakhir", async () => {
  const now = Date.parse("2026-11-15T12:00:00.000Z");
  const open = await readWhatsAppWindow(
    fakeDb("2026-11-15T11:00:00.000Z"),
    "0812 3456 7890",
    now,
  );
  assert.equal(open.open, true);
  assert.equal(open.phone, "6281234567890");
  assert.equal(open.expiresAt, "2026-11-16T11:00:00.000Z");

  const closed = await readWhatsAppWindow(
    fakeDb("2026-11-14T11:00:00.000Z"),
    "0812 3456 7890",
    now,
  );
  assert.equal(closed.open, false);
});

test("getWhatsAppStatus tidak membocorkan token dan melaporkan konfigurasi", async () => {
  const status = await getWhatsAppStatus(
    env,
    fakeDb(new Date().toISOString()),
    "0812 3456 7890",
  );
  assert.equal(status.configured, true);
  assert.equal(status.webhookConfigured, true);
  assert.equal(status.open, true);
  assert.equal(JSON.stringify(status).includes("test-token"), false);
});

test("webhook GET mengembalikan challenge saat verify token cocok", async () => {
  const request = new Request(
    "https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
  );
  const response = await handleWhatsAppWebhook(fakeDb(), env, request);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "abc123");
});

test("WhatsApp outreach hanya aktif dengan token, phone ID, template, dan flag", () => {
  const base = {
    WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_OUTREACH_TEMPLATE: "outreach_internet",
  };
  assert.equal(whatsappOutreachConfigured(base), false);
  assert.equal(
    whatsappOutreachConfigured({ ...base, WHATSAPP_OUTREACH_ENABLED: "true" }),
    true,
  );
  assert.equal(
    whatsappOutreachConfigured({
      ...base,
      WHATSAPP_OUTREACH_ENABLED: "true",
      WHATSAPP_OUTREACH_TEMPLATE: "template tidak valid",
    }),
    false,
  );
});

test("sendWhatsAppTemplate mengirim template outreach dengan dua parameter", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.template" }] }), {
      status: 200,
    });
  };
  try {
    const result = await sendWhatsAppTemplate(
      {
        ...env,
        WHATSAPP_OUTREACH_ENABLED: "true",
        WHATSAPP_OUTREACH_TEMPLATE: "outreach_internet",
        WHATSAPP_OUTREACH_LANGUAGE: "id",
      },
      fakeDb(),
      {
        ownerId: "user-1",
        phone: "0812 3456 7890",
        parameters: ["Budi Santoso", "Hotel Contoh"],
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.messageId, "wamid.template");
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.to, "6281234567890");
    assert.equal(payload.type, "template");
    assert.equal(payload.template.name, "outreach_internet");
    assert.equal(payload.template.language.code, "id");
    assert.deepEqual(
      payload.template.components[0].parameters.map((item) => item.text),
      ["Budi Santoso", "Hotel Contoh"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendQuoteWhatsApp mengunggah PDF lalu mengirim dokumen", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/media")) {
      return new Response(JSON.stringify({ id: "media-123" }), { status: 200 });
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), {
      status: 200,
    });
  };
  try {
    const db = fakeDb(new Date().toISOString());
    const result = await sendQuoteWhatsApp(env, db, "user-1", {
      fileId: "11111111-1111-4111-8111-111111111111",
      phone: "0812 3456 7890",
      filename: "Penawaran-001.pdf",
      message: "Halo, berikut penawaran kami.",
    });
    assert.equal(result.ok, true);
    assert.equal(result.messageId, "wamid.123");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.endsWith("/media"), true);
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
    const payload = JSON.parse(calls[1].init.body);
    assert.equal(payload.to, "6281234567890");
    assert.equal(payload.type, "document");
    assert.equal(payload.document.id, "media-123");
    assert.equal(payload.document.filename, "Penawaran-001.pdf");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendQuoteWhatsApp menolak kirim di luar jendela 24 jam", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const result = await sendQuoteWhatsApp(
      env,
      fakeDb("2026-11-14T11:00:00.000Z"),
      "user-1",
      {
        fileId: "11111111-1111-4111-8111-111111111111",
        phone: "0812 3456 7890",
        filename: "Penawaran-001.pdf",
        message: "Halo",
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
