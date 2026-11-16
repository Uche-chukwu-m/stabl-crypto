import { createHmac, timingSafeEqual } from "node:crypto";
import type { RawLog } from "./arc";

// The QuickNode Stream that watches the vault contract.
//
// The Stream runs this filter on QuickNode's side against every new Arc block
// and posts only the vault's own logs to /api/chain/stream. Blocks with nothing
// from the vault produce no delivery at all.
export function streamFilter(vaultAddress: string): string {
  return `function main(stream) {
  const VAULT = '${vaultAddress.toLowerCase()}';
  const logs = [];
  const walk = (x) => {
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    if (x && typeof x.address === 'string' && x.address.toLowerCase() === VAULT) logs.push(x);
  };
  walk(stream.data);
  return logs.length ? { vault: VAULT, logs: logs } : null;
}`;
}

// QuickNode signs every delivery: HMAC-SHA256 over nonce + timestamp + body,
// keyed with the stream's security token. Deliveries older than ten minutes are
// refused, so a captured request cannot be replayed later.
export function verifyStreamSignature(rawBody: string, headers: Headers, token: string | undefined): boolean {
  const nonce = headers.get("x-qn-nonce");
  const timestamp = headers.get("x-qn-timestamp");
  const given = headers.get("x-qn-signature");
  if (!token || !nonce || !timestamp || !given || !/^[0-9a-fA-F]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", Buffer.from(token)).update(Buffer.from(nonce + timestamp + rawBody)).digest();
  if (!timingSafeEqual(expected, Buffer.from(given, "hex"))) return false;
  const sentAt = Number(timestamp) * (timestamp.length > 11 ? 1 : 1000);
  return Number.isFinite(sentAt) && Math.abs(Date.now() - sentAt) < 10 * 60_000;
}

// Pull the logs out of a delivery, whatever shape wraps them.
export function logsFromDelivery(body: unknown): RawLog[] {
  const logs: RawLog[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.address === "string" && Array.isArray(o.topics) && typeof o.transactionHash === "string") logs.push(o as RawLog);
      else for (const v of Object.values(o)) walk(v);
    }
  };
  walk(body);
  return logs;
}
