import { and, eq, ne } from "drizzle-orm";
import { addMonths, dayOfMonth } from "@/engine/dates";
import { sourceKey } from "@/engine/sources";
import { db } from "@/lib/db";
import { bills, plaidItems } from "@/lib/db/schema";
import { accessToken, plaid, plaidErrorCode } from "./client";

// Seed upcoming bills from /transactions/recurring/get. The engine also detects
// bills itself; these fill in when there is not enough history yet.
export async function refreshRecurringBills(userId: string) {
  const items = await db
    .select()
    .from(plaidItems)
    .where(and(eq(plaidItems.userId, userId), ne(plaidItems.env, "local"), eq(plaidItems.status, "active")));
  const found: (typeof bills.$inferInsert)[] = [];
  for (const item of items) {
    try {
      const { data } = await plaid().transactionsRecurringGet({ access_token: accessToken(item) });
      for (const s of data.outflow_streams) {
        if (!s.is_active || s.frequency !== "MONTHLY" || !s.last_date) continue;
        const cents = Math.round(Math.abs(s.average_amount.amount ?? 0) * 100);
        if (cents <= 0) continue;
        found.push({
          userId,
          payee: sourceKey(s.description),
          amountCents: cents,
          dayOfMonth: dayOfMonth(s.last_date),
          lastSeen: s.last_date,
          nextDue: s.predicted_next_date ?? addMonths(s.last_date, 1),
          kind: "expense",
          source: "plaid_recurring",
        });
      }
    } catch (error) {
      console.warn("recurring unavailable", plaidErrorCode(error));
    }
  }
  await db.delete(bills).where(and(eq(bills.userId, userId), eq(bills.source, "plaid_recurring")));
  if (found.length) await db.insert(bills).values(found);
}
