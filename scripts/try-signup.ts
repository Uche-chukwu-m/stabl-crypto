// npx tsx scripts/try-signup.ts
// Walks a brand new person through sign up at the server level, the way the
// screens do: the bank they pick in Plaid's window, the test history in their own
// name, home base, the vault and its hidden wallet, and the first check.
// Local development only. It creates and replaces new-person@example.test.
import "./env";
import { eq } from "drizzle-orm";
import { Products } from "plaid";
import { chain } from "@/lib/chain/config";
import { db, pool } from "@/lib/db";
import { accounts, chainWallets, engineProfiles, messages, plaidItems, users } from "@/lib/db/schema";
import { deleteUserData } from "@/lib/demo/seed";
import { runEngine } from "@/lib/engine-runner";
import { plaid } from "@/lib/plaid/client";
import { connectTestHistory, pickedInstitution } from "@/lib/plaid/test-history";
import { setHomeBase } from "@/lib/security";
import { vault } from "@/lib/vault";
import { vaultProofView } from "@/lib/views";

const email = "new-person@example.test";
const [old] = await db.select().from(users).where(eq(users.email, email));
if (old) await deleteUserData(old.id);
const [u] = await db
  .insert(users)
  .values({ email, legalName: "Pat Rivers", name: "Pat Rivers", earnType: "freelance", payFrequency: "irregular", onboardingStep: 5 })
  .returning();
console.log(`vault on Arc: ${chain.enabled}, units per cent: ${chain.unitsPerCent}`);

// What Plaid's window hands back: a public token for the bank the person picked.
const started = Date.now();
const { data } = await plaid().sandboxPublicTokenCreate({ institution_id: "ins_109508", initial_products: [Products.Transactions] });
const institution = await pickedInstitution(data.public_token);
const first = await connectTestHistory(u, institution);
console.log(`connected ${first} as "${institution}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
const second = await connectTestHistory(u, "Second Pick Bank");
const third = await connectTestHistory(u, "Third Pick Bank");
console.log(`second connection ${second}, third ${third} (the third should be false)`);

const items = await db.select().from(plaidItems).where(eq(plaidItems.userId, u.id));
const accts = await db.select().from(accounts).where(eq(accounts.userId, u.id));
for (const item of items) {
  const list = accts.filter((a) => a.itemId === item.id).map((a) => `${a.name} ${a.mask}, owners ${JSON.stringify(a.ownerNames)}, $${(a.balanceCents ?? 0) / 100}`);
  console.log(`  bank: ${item.institutionName} (${item.env}): ${list.join("; ")}`);
}

const checking = accts.find((a) => a.subtype === "checking")!;
console.log("home base:", JSON.stringify(await setHomeBase(u.id, checking.id)));
await runEngine(u.id, { learnOnly: true });
const v = await vault.openAccount(u.id, "Pat Rivers");
const [wallet] = await db.select().from(chainWallets).where(eq(chainWallets.userId, u.id));
console.log(`vault ending ${v.mask}, label "${v.partnerLabel}", hidden wallet ${wallet?.address ?? "none"}`);

await runEngine(u.id, { forceFast: true, forceFeast: true });
const [p] = await db.select().from(engineProfiles).where(eq(engineProfiles.userId, u.id));
console.log(`learned: income $${p.avgMonthlyIncomeCents / 100} a month, spending $${p.expenseLowCents / 100} to $${p.expenseHighCents / 100}, status ${p.status}`);
for (const m of await db.select().from(messages).where(eq(messages.userId, u.id))) console.log("  message:", m.body);

const proof = await vaultProofView(u.id);
console.log("settings page:", JSON.stringify({ shownCents: proof?.shownCents, onChain: proof?.onChain, matches: proof?.matches, usdcPerDollar: proof?.usdcPerDollar }));
await pool.end();
