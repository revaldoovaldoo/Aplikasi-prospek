/**
 * OpenAI-compatible adapter for the future WhatsApp sales agent.
 *
 * No provider is hard-coded and this module is not connected to the WhatsApp
 * webhook. It works with any endpoint that implements
 * `POST {baseUrl}/chat/completions`, for example:
 * - Groq: https://api.groq.com/openai/v1
 * - Ollama self-host: https://llm.example.com/v1
 *
 * The adapter is disabled until all four variables are set:
 * WHATSAPP_AI_BASE_URL, WHATSAPP_AI_API_KEY, WHATSAPP_AI_MODEL,
 * WHATSAPP_AI_ENABLED=true.
 */

export const WHATSAPP_AI_SYSTEM_PROMPT = `Anda adalah asisten digital ASNET yang membantu perusahaan, sekolah, dan hotel memahami kebutuhan internet, upgrade jaringan/perangkat, Data Center, dan server.

Aturan wajib:
- Gunakan Bahasa Indonesia yang sopan, jelas, dan ringkas.
- Jangan menyebut harga, diskon, tarif, SLA, garansi, kontrak, atau janji ketersediaan.
- Jangan mengaku sebagai manusia; sebut diri sebagai asisten digital ASNET bila perlu.
- Fokus menggali kebutuhan: jenis layanan, kapasitas/kuota internet, perangkat, Data Center/server, lokasi, dan waktu.
- Ajukan paling banyak dua pertanyaan dalam satu balasan.
- Jika client meminta harga, penawaran, kontrak, komplain, atau berbicara dengan manusia, arahkan ke tim ASNET dan katakan bahwa pemilik akan menghubungi dari nomor WhatsApp pribadi.
- Jika client meminta berhenti, hormati permintaan itu dan jangan mendorong percakapan lagi.
- Jangan mengarang fakta tentang perusahaan client atau layanan ASNET.
- Jangan membahas topik di luar layanan ASNET.`;

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function whatsappAiConfig(env = {}) {
  const baseUrl = clean(env.WHATSAPP_AI_BASE_URL).replace(/\/+$/, "");
  return {
    baseUrl,
    apiKey: clean(env.WHATSAPP_AI_API_KEY),
    model: clean(env.WHATSAPP_AI_MODEL),
    enabled: clean(env.WHATSAPP_AI_ENABLED).toLowerCase() === "true",
  };
}

export function whatsappAiConfigured(env = {}) {
  const config = whatsappAiConfig(env);
  return Boolean(
    config.enabled &&
      /^https?:\/\//i.test(config.baseUrl) &&
      config.apiKey &&
      config.model,
  );
}

function endpoint(baseUrl) {
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

/**
 * Generate a draft reply. The caller decides whether to send it; this function
 * never calls WhatsApp and never persists conversations.
 */
export async function generateWhatsAppAiReply(env, messages, options = {}) {
  if (!whatsappAiConfigured(env)) {
    return {
      ok: false,
      configured: false,
      error:
        "AI WhatsApp belum aktif. Isi WHATSAPP_AI_BASE_URL, WHATSAPP_AI_API_KEY, WHATSAPP_AI_MODEL, dan WHATSAPP_AI_ENABLED=true.",
    };
  }
  const config = whatsappAiConfig(env);
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && ["system", "user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 6000),
    }));
  if (!safeMessages.length) {
    return { ok: false, configured: true, error: "Pesan AI kosong." };
  }
  const body = {
    model: config.model,
    messages: safeMessages,
    temperature: 0.3,
    max_tokens: Math.max(80, Math.min(600, Number(options.maxTokens) || 320)),
    stream: false,
  };
  try {
    const response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(options.timeoutMs) || 20_000),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* respons non-JSON ditangani di bawah */
    }
    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        text.slice(0, 300) ||
        `HTTP ${response.status}`;
      return { ok: false, configured: true, status: response.status, error: String(detail) };
    }
    const content = clean(payload?.choices?.[0]?.message?.content);
    if (!content) {
      return { ok: false, configured: true, error: "AI tidak mengembalikan balasan." };
    }
    return {
      ok: true,
      configured: true,
      content,
      model: clean(payload?.model) || config.model,
      usage: payload?.usage || null,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      uncertain: true,
      error: error instanceof Error ? error.message : "AI tidak dapat dihubungi.",
    };
  }
}
