import { and, eq, gte, isNull, lt, lte, ne, or } from "drizzle-orm";
import { addDays } from "@/engine/dates";
import { audit } from "@/lib/audit";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { messages, plaidItems, prompts, transactions, vaultAccounts } from "@/lib/db/schema";
import { runEngine } from "@/lib/engine-runner";
import { notify } from "@/lib/notify";
import { settleDueBuffers } from "@/lib/moves";
import { syncItem } from "@/lib/plaid/sync";
import { activatePendingHomeBase } from "@/lib/security";
import { accrueInterest, vault } from "@/lib/vault";

// The daily job for one user, in the PRD's order. The admin's "advance the demo
// clock" runs this once per day it skips, so a week passes the same way it would
// in real life.
export async function runDailyForUser(userId: string) {
  await activatePendingHomeBase(userId);
  await settleDueBuffers(userId);
  await runEngine(userId);
  const ctx = await loadContext(userId);
  if (ctx.vault) await accrueInterest(ctx.vault.id, ctx.today);
  await expirePrompts(userId);
  await weeklySummary(userId);
}

// No answer to an unusual jump in 48 hours means keep buffering at the typical size.
export async function expirePrompts(userId: string) {
  const ctx = await loadContext(userId);
  const expired = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.userId, userId), eq(prompts.kind, "jump"), isNull(prompts.answer), lte(prompts.expiresAt, ctx.now)));
  for (const prompt of expired) {
    await db.update(prompts).set({ answer: "DEFAULT", answeredAt: ctx.now }).where(eq(prompts.id, prompt.id));
    await audit(userId, "engine", "prompt_defaulted", { promptId: prompt.id });
    await notify(userId, "jump_default", {});
  }
}

// Mondays, real users only: last week in one line, by email too.
async function weeklySummary(userId: string) {
  const ctx = await loadContext(userId);
  if (ctx.user.isDemo || !ctx.vault) return;
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: ctx.user.timezone, weekday: "short" });
  if (weekday !== "Mon") return;
  const [recent] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.template, "weekly_summary"), gte(messages.createdAt, new Date(Date.now() - 6 * 86_400_000))))
    .limit(1);
  if (recent) return;

  const from = addDays(ctx.today, -7);
  const rows = await db
    .select({ amountCents: transactions.amountCents, cls: transactions.class })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, from), lt(transactions.date, ctx.today)));
  const incomeCents = rows.filter((r) => r.cls === "income").reduce((s, r) => s + r.amountCents, 0);
  const spendCents = rows.filter((r) => r.cls === "expense").reduce((s, r) => s - r.amountCents, 0);
  const entries = await vault.entries(ctx.vault.id);
  const moves = entries.filter((e) => e.kind !== "interest" && e.entryDate >= from).length;
  await notify(userId, "weekly_summary", { incomeCents, spendCents, vaultCents: await vault.getBalance(ctx.vault.id), moves });
}

// Vercel Cron, once a day: sync stale Items, then run every user.
export async function runDailyJob() {
  const stale = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(
      and(
        ne(plaidItems.env, "local"),
        eq(plaidItems.status, "active"),
        or(isNull(plaidItems.lastSyncedAt), lt(plaidItems.lastSyncedAt, new Date(Date.now() - 24 * 3_600_000))),
      ),
    );
  for (const item of stale) await syncItem(item.id).catch((e) => console.error("sync", item.id, e));

  const people = await db.select({ userId: vaultAccounts.userId }).from(vaultAccounts);
  const results = { users: people.length, failed: 0, synced: stale.length };
  for (const { userId } of people) {
    try {
      await runDailyForUser(userId);
    } catch (error) {
      results.failed++;
      console.error("daily failed", userId, error);
    }
  }
  return results;
}
