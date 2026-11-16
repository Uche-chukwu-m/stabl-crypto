// npx tsx scripts/try-freeze.ts
// Freezes and unfreezes the test person from scripts/try-signup.ts through the
// app's own code, the way the Freeze button and the code screen do, then shows
// what the app recorded. Needs no USDC: Circle's Gas Station pays both fees.
import "./env";
import { desc, eq } from "drizzle-orm";
import { readVault } from "@/lib/chain/arc";
import { txUrl, type Address } from "@/lib/chain/config";
import { nudgePending } from "@/lib/chain/settle";
import { loadContext } from "@/lib/context";
import { db, pool } from "@/lib/db";
import { chainEvents, chainWallets, messages, users } from "@/lib/db/schema";
import { confirmUnfreeze, freeze, requestUnfreeze } from "@/lib/security";

const [u] = await db.select().from(users).where(eq(users.email, "new-person@example.test"));
if (!u) throw new Error("Run scripts/try-signup.ts first.");
const [wallet] = await db.select().from(chainWallets).where(eq(chainWallets.userId, u.id));
const onChain = () => readVault(wallet.address as Address);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let t = Date.now();
await freeze(u.id);
console.log(`freeze: app says ${(await loadContext(u.id)).vault?.status} after ${Date.now() - t}ms`);
for (let i = 0; i < 20 && !(await onChain()).frozen; i++) await wait(1000);
console.log(`        contract says frozen=${(await onChain()).frozen} after ${((Date.now() - t) / 1000).toFixed(1)}s`);

await requestUnfreeze(u.id, "app");
const [codeMessage] = await db.select().from(messages).where(eq(messages.userId, u.id)).orderBy(desc(messages.createdAt)).limit(1);
console.log(`unfreeze code message: ${codeMessage.body}`);
const code = codeMessage.body.match(/\b(\d{6})\b/)?.[1];
if (!code) throw new Error("The code was not shown in the app.");

t = Date.now();
console.log(`unfreeze with the code: ${await confirmUnfreeze(u.id, code)} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(`        app says ${(await loadContext(u.id)).vault?.status}, contract says frozen=${(await onChain()).frozen}`);

// The fallback records both events, as the Stream would on the live site.
await nudgePending(u.id, 0);
for (const e of await db.select().from(chainEvents).where(eq(chainEvents.userId, u.id)).orderBy(chainEvents.blockNumber)) {
  console.log(`  recorded ${e.name} (${e.source}) ${txUrl(e.txHash)}`);
}
await pool.end();
