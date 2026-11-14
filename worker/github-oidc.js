const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
const ISSUER = "https://token.actions.githubusercontent.com";
const DEFAULT_AUDIENCE = "hallo-pane-robot";
const DEFAULT_REPOSITORY = "revaldoovaldoo/aplikasi-prospek";
const DEFAULT_REF = "refs/heads/main";

let jwksCache = { fetchedAt: 0, keys: [] };

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function loadJwks(force = false) {
  if (!force && jwksCache.keys.length > 0 && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  const response = await fetch(JWKS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub JWKS HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  jwksCache = { fetchedAt: Date.now(), keys };
  return keys;
}

/**
 * Verifies a GitHub Actions OIDC JWT. No repository secret is stored in the
 * Worker; the signature, repository and default branch are checked instead.
 */
export async function verifyGithubOidc(token, env = {}) {
  const value = clean(token);
  if (!value) return { ok: false, reason: "Token kosong." };

  const parts = value.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Format JWT tidak valid." };

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: "JWT tidak dapat dibaca." };
  }

  if (header?.alg !== "RS256") {
    return { ok: false, reason: "Algoritma JWT bukan RS256." };
  }
  if (!header?.kid) return { ok: false, reason: "kid JWT tidak ada." };

  const signature = decodeBase64Url(parts[2]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let keys = await loadJwks();
  let jwk = keys.find((key) => key?.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(true);
    jwk = keys.find((key) => key?.kid === header.kid);
  }
  if (!jwk) return { ok: false, reason: "Kunci publik GitHub tidak ditemukan." };

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signed,
    );
  } catch {
    return { ok: false, reason: "Verifikasi tanda tangan gagal." };
  }
  if (!verified) return { ok: false, reason: "Tanda tangan JWT tidak cocok." };

  const audience = clean(env.GITHUB_OIDC_AUDIENCE) || DEFAULT_AUDIENCE;
  const repository = (clean(env.GITHUB_OIDC_REPOSITORY) || DEFAULT_REPOSITORY).toLowerCase();
  const ref = clean(env.GITHUB_OIDC_REF) || DEFAULT_REF;
  const now = Math.floor(Date.now() / 1000);
  const expires = Number(payload?.exp || 0);
  const notBefore = Number(payload?.nbf || 0);

  if (payload?.iss !== ISSUER) return { ok: false, reason: "Issuer bukan GitHub Actions." };
  const audiences = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  if (!audiences.includes(audience)) return { ok: false, reason: "Audience tidak cocok." };
  if (String(payload?.repository || "").toLowerCase() !== repository) {
    return { ok: false, reason: "Repository tidak cocok." };
  }
  if (payload?.ref !== ref) return { ok: false, reason: "Bukan branch utama." };
  if (!expires || expires <= now) return { ok: false, reason: "Token kedaluwarsa." };
  if (notBefore && notBefore > now + 60) return { ok: false, reason: "Token belum berlaku." };

  return { ok: true, claims: payload };
}
