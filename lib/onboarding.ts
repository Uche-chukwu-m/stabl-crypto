import { eq } from "drizzle-orm";
import { billsDue } from "@/engine/learn";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { sourceTags } from "@/lib/db/schema";
import { runEngine } from "@/lib/engine-runner";

// What the engine learned, in the shape step 7 shows: average income, the
// expense range, bills with the week they land, and credits that need a label.
export async function learnedSummary(userId: string) {
  const d = await runEngine(userId, { learnOnly: true });
  const { today } = await loadContext(userId);
  const labeled = new Set((await db.select().from(sourceTags).where(eq(sourceTags.userId, userId))).map((t) => t.sourceKey));
  const seen = new Set<string>();
  const mysteries = d.mysteryCredits
    .filter((m) => !labeled.has(m.sourceKey) && !seen.has(m.sourceKey) && seen.add(m.sourceKey))
    .map((m) => ({ sourceKey: m.sourceKey, name: m.name, amountCents: m.amountCents, date: m.date }));
  const p = d.profile;
  return {
    ready: p.ready,
    historyDays: p.historyDays,
    avgMonthlyIncomeCents: p.avgMonthlyIncomeCents,
    expenseLowCents: p.expenseLowCents,
    expenseHighCents: p.expenseHighCents,
    hasMargin: p.hasMargin,
    bills: p.bills
      .filter((b) => b.kind === "expense")
      .map((b) => ({
        payee: b.payee,
        amountCents: b.amountCents,
        dayOfMonth: b.dayOfMonth,
        week: Math.min(4, Math.floor((b.dayOfMonth - 1) / 7) + 1),
        nextDue: billsDue([b], today, 40)[0]?.due ?? b.nextDue,
      })),
    mysteries,
  };
}
