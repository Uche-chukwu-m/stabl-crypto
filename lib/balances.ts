import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { ISODate } from "@/engine/dates";
import { db } from "@/lib/db";
import { ledgerEntries, transactions } from "@/lib/db/schema";
import type { HomeBase } from "@/lib/context";

// Home base checking as Stabl sees it.
// Sandbox and local: the bank's balance on the anchor date, plus every
// transaction since (injections and the bank side of vault moves included),
// because sandbox balances never change on their own.
// Production (Trial plan): no money really moves, so the live balance minus the
// net of every vault move. The app labels this "simulated".
export async function checkingBalance(home: HomeBase, today: ISODate, vaultId: string | null): Promise<number> {
  const anchor = home.balanceCents ?? 0;
  if (home.item.env === "production") {
    if (!vaultId) return anchor;
    const [{ net }] = await db
      .select({ net: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.vaultId, vaultId), inArray(ledgerEntries.kind, ["buffer", "release", "emergency"])));
    return anchor - net;
  }
  // Bank feed rows after the anchor day move the balance. Rows Stabl wrote itself
  // (demo injections, the bank side of vault moves) were never in the bank's
  // balance, so they always count, even on the anchor day.
  const since = home.balanceAsOf ?? "1970-01-01";
  const [{ change }] = await db
    .select({ change: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, home.id),
        lte(transactions.date, today),
        eq(transactions.pending, false),
        or(inArray(transactions.origin, ["demo_inject", "vault_mirror"]), gt(transactions.date, since)),
      ),
    );
  return anchor + change;
}
