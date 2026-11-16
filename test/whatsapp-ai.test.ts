import assert from "node:assert/strict";
import test from "node:test";
import {
  generateWhatsAppAiReply,
  WHATSAPP_AI_SYSTEM_PROMPT,
  whatsappAiConfigured,
} from "../worker/whatsapp-ai.js";

const env = {
  WHATSAPP_AI_BASE_URL: "https://api.groq.com/openai/v1",
  WHATSAPP_AI_API_KEY: "test-key",
  WHATSAPP_AI_MODEL: "qwen/qwen3.8-27b",
  WHATSAPP_AI_ENABLED: "true",
};

test("adapter AI hanya aktif dengan base URL, key, model, dan flag", () => {
  assert.equal(whatsappAiConfigured(env), true);
  assert.equal(whatsappAiConfigured({ ...env, WHATSAPP_AI_ENABLED: "false" }), false);
  assert.equal(whatsappAiConfigured({ ...env, WHATSAPP_AI_MODEL: "" }), false);
});

test("adapter AI mengirim request OpenAI-compatible ke Groq", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        model: "qwen/qwen3.8-27b",
        choices: [{ message: { content: "Baik, saya bantu." } }],
        usage: { total_tokens: 42 },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await generateWhatsAppAiReply(env, [
      { role: "system", content: WHATSAPP_AI_SYSTEM_PROMPT },
      { role: "user", content: "Halo, saya butuh internet." },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.content, "Baik, saya bantu.");
    assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "qwen/qwen3.8-27b");
    assert.equal(body.messages[1].content, "Halo, saya butuh internet.");
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adapter AI menerima base URL yang sudah menunjuk ke chat completions", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Siap." } }] }),
      { status: 200 },
    );
  };
  try {
    const result = await generateWhatsAppAiReply(
      { ...env, WHATSAPP_AI_BASE_URL: "https://llm.example.com/v1/chat/completions" },
      [{ role: "user", content: "Tes" }],
    );
    assert.equal(result.ok, true);
    assert.equal(calledUrl, "https://llm.example.com/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
