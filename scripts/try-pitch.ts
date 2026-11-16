// npx tsx scripts/try-pitch.ts
// Runs the presenter's whole story on Arc from a local machine: a fresh account
// with its balance carried onto Arc, a big client payment, the set-aside landing
// the next day, then a slow week and the release. Prints each receipt and its
// proof. Local development only: it replaces the local presenter account.
import "./env";
import { desc, eq } from "drizzle-orm";
import { readVault } from "@/lib/chain/arc";
import { txUrl, unitsToCents, type Address } from "@/lib/chain/config";
import { nudgePending, settlePending } from "@/lib/chain/settle";
import { db, pool } from "@/lib/db";
import { chainOps, chainWallets, messages, moves, vaultAccounts, vaultBalances } from "@/lib/db/schema";
import { advanceClock, injectEvent } from "@/lib/demo/admin";
import { seedPersona } from "@/lib/demo/seed";
import { formatUsdc } from "@/lib/views";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const since = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

async function state(userId: string, label: string) {
  const [w] = await db.select().from(chainWallets).where(eq(chainWallets.userId, userId));
  const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
  const [b] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, v.id));
  const chain = await readVault(w.address as Address);
  const agree = unitsToCents(chain.units) === b.balanceCents;
  console.log(`  [${label}] app shows ${money(b.balanceCents)}, contract holds ${formatUsdc(chain.units)} USDC (${money(unitsToCents(chain.units))}) ${agree ? "- they agree" : "- THEY DIFFER"}`);
}

async function lastMessage(userId: string) {
  const [m] = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(1);
  return m;
}

async function showMoves(userId: string, after: Date) {
  const rows = await db.select().from(moves).where(eq(moves.userId, userId)).orderBy(desc(moves.createdAt)).limit(6);
  for (const m of rows.filter((r) => r.createdAt >= after).reverse()) {
    console.log(`  move ${m.direction} ${money(m.amountCents)}: ${m.state}${m.confirmedBy ? `, confirmed by ${m.confirmedBy}` : ""}${m.txHash ? ` ${txUrl(m.txHash)}` : ""}`);
  }
}

let t = Date.now();
const started = new Date();
console.log("1. Fresh presenter account");
const { userId, gp } = await seedPersona("jemaya", { log: (l) => console.log(" " + l) });
console.log(`  seeded in ${since(t)}; pitch plan: set aside ${money(gp.demo?.bufferCents ?? 0)}, release ${money(gp.demo?.releaseCents ?? 0)}`);
await state(userId, "start");

console.log("\n2. Big client pays");
t = Date.now();
await injectEvent(userId, "big_client");
console.log(`  ${since(t)}: ${(await lastMessage(userId)).body}`);

console.log("\n3. Next day: the set-aside goes to Arc");
t = Date.now();
await advanceClock(userId, 1);
console.log(`  sent after ${since(t)}; waiting for the contract`);
await settlePending(userId);
console.log(`  ${since(t)}: ${(await lastMessage(userId)).body}`);
await showMoves(userId, started);
await state(userId, "after set-aside");

console.log("\n4. Slow week");
t = Date.now();
await injectEvent(userId, "slow_week");
for (let day = 0; day < 7; day++) {
  await advanceClock(userId, 1);
  await settlePending(userId);
  if ((await lastMessage(userId)).template === "release") break;
}
console.log(`  ${since(t)}: ${(await lastMessage(userId)).body}`);
await showMoves(userId, started);
await state(userId, "after release");

// The released USDC goes back to the operator, the bank side.
await new Promise((r) => setTimeout(r, 8000));
await nudgePending(userId, 0);
for (const op of await db.select().from(chainOps).where(eq(chainOps.userId, userId)).orderBy(chainOps.createdAt)) {
  console.log(`  ${op.kind}: ${op.state}${op.units ? `, ${formatUsdc(BigInt(op.units))} USDC` : ""}${op.txHash ? ` ${txUrl(op.txHash)}` : ""}`);
}
await pool.end();
