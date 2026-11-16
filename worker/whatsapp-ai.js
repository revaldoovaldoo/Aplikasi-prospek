/**
 * OpenAI-compatible adapter for the future WhatsApp sales agent.
 *
 * No provider is hard-coded and this module is not connected to the WhatsApp
 * webhook. It works with any endpoint that implements
 * `POST {baseUrl}/chat/completions`.
 *
 * Recommended setup:
 * - Primary: Groq free tier, OpenAI-compatible.
 * - Fallback: self-hosted Ollama running Hermes 4 14B or Qwen3-8B.
 *
 * Primary variables:
 * WHATSAPP_AI_BASE_URL, WHATSAPP_AI_API_KEY, WHATSAPP_AI_MODEL,
 * WHATSAPP_AI_ENABLED=true
 *
 * Optional fallback variables:
 * WHATSAPP_AI_FALLBACK_BASE_URL, WHATSAPP_AI_FALLBACK_API_KEY,
 * WHATSAPP_AI_FALLBACK_MODEL
 */

export const WHATSAPP_AI_SYSTEM_PROMPT = `Anda adalah asisten digital ASNET yang membantu perusahaan, sekolah, dan hotel memahami kebutuhan internet, upgrade jaringan/perangkat, Data Center, dan server. Anda nantinya dihubungkan dengan rekanan kami Bapak Pane.

Aturan wajib:
- Gunakan Bahasa Indonesia yang sopan, jelas, ringkas, dan terdengar alami seperti percakapan manusia.
- Jangan menyebut harga, diskon, tarif, SLA, garansi, kontrak, atau janji ketersediaan.
- Jangan mengaku sebagai manusia. Sebut diri sebagai asisten digital ASNET bila perlu.
- Jangan menampilkan tag  thinking, proses berpikir, atau catatan internal.
- Fokus menggali kebutuhan: jenis layanan, kapasitas/kuota internet, perangkat, Data Center/server, lokasi, dan waktu.
- Ajukan paling banyak dua pertanyaan dalam satu balasan. Jangan mengulang sapaan di setiap pesan.
- Jika client meminta harga, penawaran, kontrak, komplain, atau berbicara dengan manusia, arahkan ke tim ASNET dan katakan bahwa pemilik akan menghubungi dari nomor WhatsApp pribadi.
- Jika client meminta berhenti, hormati permintaan itu dan jangan mendorong percakapan lagi.
- Jangan mengarang fakta tentang perusahaan client, layanan ASNET, atau Bapak Pane.
- Jangan membahas topik di luar layanan ASNET.`;

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function providerConfig(env, prefix) {
  return {
    baseUrl: clean(env[`${prefix}BASE_URL`]).replace(/\/+$/, ""),
    apiKey: clean(env[`${prefix}API_KEY`]),
    model: clean(env[`${prefix}MODEL`]),
  };
}

function providerReady(provider) {
  return Boolean(
    /^https?:\/\//i.test(provider.baseUrl) && provider.apiKey && provider.model,
  );
}

export function whatsappAiConfig(env = {}) {
  const primary = providerConfig(env, "WHATSAPP_AI_");
  const fallback = providerConfig(env, "WHATSAPP_AI_FALLBACK_");
  return {
    ...primary,
    enabled: clean(env.WHATSAPP_AI_ENABLED).toLowerCase() === "true",
    fallback: {
      ...fallback,
      configured: providerReady(fallback),
    },
  };
}

export function whatsappAiConfigured(env = {}) {
  const config = whatsappAiConfig(env);
  return Boolean(
    config.enabled && (providerReady(config) || config.fallback.configured),
  );
}

function endpoint(baseUrl) {
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

async function callProvider(provider, messages, options = {}) {
  const body = {
    model: provider.model,
    messages,
    temperature: Number(options.temperature) || 0.3,
    max_tokens: Math.max(80, Math.min(600, Number(options.maxTokens) || 320)),
    stream: false,
  };
  try {
    const response = await fetch(endpoint(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
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
      return { ok: false, status: response.status, error: String(detail) };
    }
    const content = clean(payload?.choices?.[0]?.message?.content);
    if (!content) {
      return { ok: false, error: "AI tidak mengembalikan balasan." };
    }
    return {
      ok: true,
      content,
      model: clean(payload?.model) || provider.model,
      usage: payload?.usage || null,
    };
  } catch (error) {
    return {
      ok: false,
      uncertain: true,
      error: error instanceof Error ? error.message : "AI tidak dapat dihubungi.",
    };
  }
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

  const primary = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  };
  const primaryResult = providerReady(primary)
    ? await callProvider(primary, safeMessages, options)
    : { ok: false, error: "Provider utama AI belum lengkap." };
  if (primaryResult.ok) {
    return { ...primaryResult, configured: true, route: "primary" };
  }

  const fallback = {
    baseUrl: config.fallback.baseUrl,
    apiKey: config.fallback.apiKey,
    model: config.fallback.model,
  };
  if (providerReady(fallback)) {
    const fallbackResult = await callProvider(fallback, safeMessages, options);
    return {
      ...fallbackResult,
      configured: true,
      route: "fallback",
      primaryError: primaryResult.error,
    };
  }

  return {
    ...primaryResult,
    configured: true,
    route: "primary",
  };
}
