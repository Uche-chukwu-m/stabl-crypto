import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Plaid's signing key, played by a key pair made here.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "ES256", use: "sig" };

vi.mock("@/lib/plaid/client", () => ({
  plaid: () => ({
    webhookVerificationKeyGet: async ({ key_id }: { key_id: string }) => {
      if (key_id !== "test-kid") throw new Error("unknown key");
      return { data: { key: jwk } };
    },
  }),
}));

const { verifyPlaidWebhook } = await import("@/lib/plaid/webhook-verify");

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");

function token(body: string, opts: { iat?: number; kid?: string; alg?: string } = {}) {
  const header = b64({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "test-kid", typ: "JWT" });
  const claims = b64({ iat: opts.iat ?? Math.floor(Date.now() / 1000), request_body_sha256: createHash("sha256").update(body).digest("hex") });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64(signature)}`;
}

const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "abc" });

describe("Plaid webhook verification", () => {
  it("accepts a correctly signed, fresh webhook", async () => {
    expect(await verifyPlaidWebhook(body, token(body))).toBe(true);
  });

  it("rejects anything unsigned or malformed", async () => {
    expect(await verifyPlaidWebhook(body, null)).toBe(false);
    expect(await verifyPlaidWebhook(body, "")).toBe(false);
    expect(await verifyPlaidWebhook(body, "not.a.jwt")).toBe(false);
    expect(await verifyPlaidWebhook(body, "only-one-part")).toBe(false);
  });

  it("rejects a body that was changed after signing", async () => {
    expect(await verifyPlaidWebhook(body.replace("abc", "xyz"), token(body))).toBe(false);
  });

  it("rejects a stale signature, a wrong algorithm, and an unknown key", async () => {
    expect(await verifyPlaidWebhook(body, token(body, { iat: Math.floor(Date.now() / 1000) - 600 }))).toBe(false);
    expect(await verifyPlaidWebhook(body, token(body, { alg: "HS256" }))).toBe(false);
    expect(await verifyPlaidWebhook(body, token(body, { kid: "other" }))).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const [h, p] = token(body).split(".");
    const forged = sign("sha256", Buffer.from(`${h}.${p}`), { key: other, dsaEncoding: "ieee-p1363" });
    expect(await verifyPlaidWebhook(body, `${h}.${p}.${b64(forged)}`)).toBe(false);
  });
});
