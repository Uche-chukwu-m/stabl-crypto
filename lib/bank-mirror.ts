import { VAULT } from "@/engine/config";
import type { ISODate } from "@/engine/dates";
import { sourceKey } from "@/engine/sources";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import type { HomeBase } from "@/lib/context";
import { accessToken } from "@/lib/plaid/client";
import { postSandboxTransactions } from "@/lib/plaid/sandbox";

type NewTxn = { date: ISODate; amountCents: number; name: string };

// Write transactions onto home base the way a bank feed would show them. Stabl's
// own row is the record (it carries the demo clock date). Sandbox Items also get
// the transaction posted to Plaid, and the next sync matches it to this row.
export async function postToHomeBase(home: HomeBase, txns: NewTxn[], origin: "demo_inject" | "vault_mirror") {
  if (txns.length === 0) return;
  await db.insert(transactions).values(
    txns.map((t) => ({
      accountId: home.id,
      userId: home.userId,
      date: t.date,
      amountCents: t.amountCents,
      name: t.name,
      sourceKey: sourceKey(t.name),
      origin,
    })),
  );
  if (home.item.env === "sandbox") {
    try {
      await postSandboxTransactions(accessToken(home.item), home.plaidAccountId, txns);
    } catch (error) {
      // The demo keeps working from Stabl's own rows even if Plaid is slow.
      console.warn("sandbox post failed", (error as Error).message);
    }
  }
}

// The bank side of a vault move: minus for a buffer, plus for a release. Real
// Trial plan accounts never move money, so they get no row; their balance is
// adjusted instead (lib/balances).
export async function mirrorVaultMove(home: HomeBase, date: ISODate, signedCents: number) {
  if (home.item.env === "production") return;
  await postToHomeBase(home, [{ date, amountCents: signedCents, name: VAULT.vaultTransferName }], "vault_mirror");
}
