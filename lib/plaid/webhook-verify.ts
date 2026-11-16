import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { plaid } from "./client";

const keyCache = new Map<string, JsonWebKey>();

function b64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// Plaid signs every webhook with an ES256 JWT in the Plaid-Verification header.
// The JWT carries a hash of the body. Anything unsigned, stale, or altered fails.
export async function verifyPlaidWebhook(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;

  let jwtHeader: { alg?: string; kid?: string };
  let claims: { iat?: number; request_body_sha256?: string };
  try {
    jwtHeader = JSON.parse(b64url(h).toString("utf8"));
    claims = JSON.parse(b64url(p).toString("utf8"));
  } catch {
    return false;
  }
  if (jwtHeader.alg !== "ES256" || !jwtHeader.kid) return false;

  let jwk = keyCache.get(jwtHeader.kid);
  if (!jwk) {
    try {
      const { data } = await plaid().webhookVerificationKeyGet({ key_id: jwtHeader.kid });
      jwk = data.key as unknown as JsonWebKey;
      keyCache.set(jwtHeader.kid, jwk);
    } catch {
      return false;
    }
  }

  const key = createPublicKey({ key: jwk, format: "jwk" });
  const ok = verifySignature("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, b64url(s));
  if (!ok) return false;

  if (!claims.iat || Math.abs(Date.now() / 1000 - claims.iat) > 5 * 60) return false;
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return claims.request_body_sha256 === bodyHash;
}
