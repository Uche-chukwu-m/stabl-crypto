import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "plaid";
import { sourceKey } from "@/engine/sources";
import { db } from "@/lib/db";
import { accounts, plaidItems, transactions } from "@/lib/db/schema";
import { accessToken, plaid, plaidErrorCode, toStablCents } from "./client";

export type SyncResult = { added: number; modified: number; removed: number; status: "ok" | "login_required" | "error" };

// /transactions/sync with a stored cursor per Item, looping while has_more.
// Rows Stabl already wrote itself (a demo injection or the bank side of a vault
// move) are matched instead of duplicated, and keep their demo clock date.
export async function syncItem(itemRowId: string): Promise<SyncResult> {
  const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, itemRowId));
  if (!item || item.env === "local" || item.status === "revoked") return { added: 0, modified: 0, removed: 0, status: "ok" };

  const accountRows = await db.select().from(accounts).where(eq(accounts.itemId, item.id));
  const accountByPlaid = new Map(accountRows.map((a) => [a.plaidAccountId, a]));

  let cursor = item.syncCursor ?? undefined;
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: string[] = [];
  try {
    for (let page = 0; page < 50; page++) {
      const { data } = await plaid().transactionsSync({ access_token: accessToken(item), cursor, count: 500 });
      added.push(...data.added);
      modified.push(...data.modified);
      removed.push(...data.removed.map((r) => r.transaction_id));
      cursor = data.next_cursor;
      if (!data.has_more) break;
    }
  } catch (error) {
    const code = plaidErrorCode(error);
    if (code === "ITEM_LOGIN_REQUIRED") {
      await db.update(plaidItems).set({ status: "login_required" }).where(eq(plaidItems.id, item.id));
      return { added: 0, modified: 0, removed: 0, status: "login_required" };
    }
    console.error("sync failed", code ?? error);
    return { added: 0, modified: 0, removed: 0, status: "error" };
  }

  for (const t of added) {
    const account = accountByPlaid.get(t.account_id);
    if (!account) continue;
    const row = toRow(t, account.id, item.userId);
    const [mine] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, account.id),
          isNull(transactions.plaidTxnId),
          inArray(transactions.origin, ["demo_inject", "vault_mirror"]),
          eq(transactions.amountCents, row.amountCents),
          eq(transactions.name, row.name),
        ),
      )
      .limit(1);
    if (mine) {
      await db.update(transactions).set({ plaidTxnId: t.transaction_id }).where(eq(transactions.id, mine.id));
    } else {
      await db.insert(transactions).values(row).onConflictDoNothing({ target: transactions.plaidTxnId });
    }
  }

  for (const t of modified) {
    const account = accountByPlaid.get(t.account_id);
    if (!account) continue;
    const { date, amountCents, name, merchant, pending, sourceKey: key } = toRow(t, account.id, item.userId);
    await db
      .update(transactions)
      .set({ amountCents, name, merchant, pending, sourceKey: key, date })
      .where(and(eq(transactions.plaidTxnId, t.transaction_id), eq(transactions.origin, "plaid")));
  }

  if (removed.length) await db.delete(transactions).where(inArray(transactions.plaidTxnId, removed));

  await db
    .update(plaidItems)
    .set({ syncCursor: cursor ?? null, lastSyncedAt: new Date(), status: item.status === "login_required" ? "active" : item.status })
    .where(eq(plaidItems.id, item.id));

  return { added: added.length, modified: modified.length, removed: removed.length, status: "ok" };
}

function toRow(t: Transaction, accountId: string, userId: string) {
  const name = t.original_description || t.name;
  return {
    accountId,
    userId,
    plaidTxnId: t.transaction_id,
    date: t.date,
    amountCents: toStablCents(t.amount),
    name,
    merchant: t.merchant_name ?? null,
    pending: t.pending,
    sourceKey: sourceKey(name),
    origin: "plaid" as const,
  };
}
