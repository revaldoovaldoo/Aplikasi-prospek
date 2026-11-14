import type { PoPinCredential } from "../types";

export const PO_PIN_LENGTH = 6;
const ITERATIONS = 150_000;

/** Hanya angka; pengguna tidak bisa mengetik huruf atau spasi. */
export function normalizePoPin(value: string): string {
  return value.replace(/\D/g, "").slice(0, PO_PIN_LENGTH);
}

export function isValidPoPin(value: string): boolean {
  return /^\d{6}$/.test(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength,
  ) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function createPoPin(pin: string): Promise<PoPinCredential> {
  if (!isValidPoPin(pin)) throw new Error("PIN harus 6 digit angka.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt, ITERATIONS);
  return {
    hash,
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

export async function verifyPoPin(pin: string, credential: PoPinCredential): Promise<boolean> {
  if (!isValidPoPin(pin)) return false;
  try {
    const salt = base64ToBytes(credential.salt);
    const iterations = Number.isInteger(credential.iterations)
      ? credential.iterations
      : ITERATIONS;
    const hash = await hashPin(pin, salt, iterations);
    if (hash.length !== credential.hash.length) return false;
    let difference = 0;
    for (let index = 0; index < hash.length; index += 1) {
      difference |= hash.charCodeAt(index) ^ credential.hash.charCodeAt(index);
    }
    return difference === 0;
  } catch {
    return false;
  }
}
