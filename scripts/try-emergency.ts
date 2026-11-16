// npx tsx scripts/try-emergency.ts <userId> [dollars]
// An emergency unlock through the app's own code, the way the Vault screen does
// it: ask for a code, enter it with an amount, and wait for the contract's event.
// The transaction is sent from the owner's own wallet, not the operator's.
// Runs against whatever DATABASE_URL is set; for the live site pass the live
// database and its AUTH_SECRET.
import "./env";
import { desc, eq } from "drizzle-orm";
import { readVault } from "@/lib/chain/arc";
import { txUrl, unitsToCents, type Address } from "@/lib/chain/config";
import { db, pool } from "@/lib/db";
import { chainWallets, messages, moves, vaultAccounts, vaultBalances } from "@/lib/db/schema";
import { confirmEmergency, startEmergency } from "@/lib/security";

const [userId, dollars = "150"] = process.argv.slice(2);
if (!userId) throw new Error("Pass the user id.");
const cents = Math.round(Number(dollars) * 100);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const balances = async () => {
  const [w] = await db.select().from(chainWallets).where(eq(chainWallets.userId, userId));
  const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
  const [b] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, v.id));
  const chain = await readVault(w.address as Address);
  return { app: b.balanceCents, chain: unitsToCents(chain.units) };
};

const before = await balances();
console.log(`before: app ${money(before.app)}, contract ${money(before.chain)}`);

console.log(`start: ${await startEmergency(userId, "app")}`);
const [codeMsg] = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(1);
const code = codeMsg.body.match(/\b(\d{6})\b/)?.[1];
if (!code) throw new Error(`No code in the app: ${codeMsg.body}`);
console.log(`code shown in the app: ${codeMsg.body}`);

const t = Date.now();
console.log(`confirm ${money(cents)}: ${JSON.stringify(await confirmEmergency(userId, code, cents))}`);

let move;
for (let i = 0; i < 60; i++) {
  [move] = await db.select().from(moves).where(eq(moves.userId, userId)).orderBy(desc(moves.createdAt)).limit(1);
  if (move.state === "settled" || move.state === "cancelled") break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`move ${move!.direction} ${money(move!.amountCents)}: ${move!.state}, confirmed by ${move!.confirmedBy ?? "nothing"} after ${((Date.now() - t) / 1000).toFixed(1)}s`);
if (move!.txHash) console.log(`  ${txUrl(move!.txHash)}`);
await new Promise((r) => setTimeout(r, 3000));
const [receipt] = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(1);
console.log(`receipt: ${receipt.body}`);
const after = await balances();
console.log(`after: app ${money(after.app)}, contract ${money(after.chain)} ${after.app === after.chain ? "- they agree" : "- THEY DIFFER"}`);
await pool.end();
