import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

// Plaid access tokens are encrypted at rest with AES 256 GCM. Only server code
// holds TOKEN_ENC_KEY, so only server code can read them.
function key(): Buffer {
  const raw = Buffer.from(requireEnv("TOKEN_ENC_KEY"), "base64");
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64");
  return raw;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptToken(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1") throw new Error("Unknown token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

// One time codes are stored only as a keyed hash.
export function hashCode(code: string): string {
  return createHmac("sha256", requireEnv("AUTH_SECRET")).update(code).digest("hex");
}

export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
