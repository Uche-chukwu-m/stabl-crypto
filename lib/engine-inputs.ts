import { and, eq, gte, ne, or } from "drizzle-orm";
import { ENGINE } from "@/engine/config";
import { addDays } from "@/engine/dates";
import type { AccountKind, Balances, Bill, EngineAccount, SourceTag, Txn, UserState } from "@/engine/types";
import { checkingBalance } from "@/lib/balances";
import { localDate } from "@/lib/clock";
import type { UserContext } from "@/lib/context";
import { db } from "@/lib/db";
import {
  accounts,
  bills,
  engineProfiles,
  moves,
  plaidItems,
  prompts,
  sourceTags,
  transactions,
  vaultBalances,
} from "@/lib/db/schema";

export type EngineInputs = {
  state: UserState;
  txns: Txn[];
  balances: Balances;
  profile: typeof engineProfiles.$inferSelect | null;
};

export function accountKind(type: string, subtype: string | null): AccountKind {
  if (type === "credit") return "credit";
  if (subtype === "savings") return "savings";
  if (type === "depository") return "checking";
  return "other";
}

// Everything decide() needs, read from the database for one user.
export async function loadEngineInputs(ctx: UserContext): Promise<EngineInputs> {
  const userId = ctx.user.id;
  const since = addDays(ctx.today, -(ENGINE.historyDays + 14));

  const accountRows = await db
    .select({ id: accounts.id, type: accounts.type, subtype: accounts.subtype, isHomeBase: accounts.isHomeBase })
    .from(accounts)
    .innerJoin(plaidItems, eq(accounts.itemId, plaidItems.id))
    .where(and(eq(accounts.userId, userId), ne(plaidItems.status, "revoked")));
  const engineAccounts: EngineAccount[] = accountRows.map((a) => ({
    id: a.id,
    kind: accountKind(a.type, a.subtype),
    isHomeBase: a.isHomeBase,
  }));
  const live = new Set(engineAccounts.map((a) => a.id));

  const txnRows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amountCents: transactions.amountCents,
      name: transactions.name,
      pending: transactions.pending,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, since)));
  const txns: Txn[] = txnRows.filter((t) => live.has(t.accountId));

  const tagRows = await db.select().from(sourceTags).where(eq(sourceTags.userId, userId));
  const tags: Record<string, SourceTag> = Object.fromEntries(tagRows.map((t) => [t.sourceKey, t.tag]));

  const promptRows = await db.select().from(prompts).where(eq(prompts.userId, userId));
  const promptedSources = promptRows
    .filter((p) => p.kind === "mystery")
    .map((p) => String((p.payloadJson as { sourceKey?: string }).sourceKey ?? ""));
  const openJumpPrompt = promptRows.some((p) => p.kind === "jump" && p.answer === null);

  const [profile] = await db.select().from(engineProfiles).where(eq(engineProfiles.userId, userId));

  const window = addDays(ctx.today, -(ENGINE.feastWindowDays - 1));
  const moveRows = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), or(gte(moves.plannedFor, window), eq(moves.state, "announced"))));
  const bufferedToday = moveRows
    .filter((m) => m.direction === "buffer" && m.state !== "cancelled" && m.plannedFor === ctx.today)
    .reduce((sum, m) => sum + m.amountCents, 0);

  let vaultCents = 0;
  if (ctx.vault) {
    const [row] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, ctx.vault.id));
    vaultCents = row?.balanceCents ?? 0;
  }

  const external: Bill[] = (
    await db.select().from(bills).where(and(eq(bills.userId, userId), eq(bills.source, "plaid_recurring")))
  ).map((b) => ({
    payee: b.payee,
    amountCents: b.amountCents,
    dayOfMonth: b.dayOfMonth,
    lastSeen: b.lastSeen,
    nextDue: b.nextDue,
    cadence: "monthly",
    kind: b.kind,
  }));

  const state: UserState = {
    accounts: engineAccounts,
    sourceTags: tags,
    promptedSources,
    promptAfter: ctx.user.promptAfter,
    vaultBalanceCents: vaultCents,
    frozen: ctx.vault?.status === "frozen",
    pausedUntil: profile?.pausedUntil ?? null,
    homeBasePendingUntil: ctx.user.homeBasePendingUntil ? localDate(ctx.user.homeBasePendingUntil, ctx.user.timezone) : null,
    lastFastCheck: profile?.lastFastCheck ?? null,
    lastFeastCheck: profile?.lastFeastCheck ?? null,
    dailyLimitCents: ctx.user.dailyLimitCents,
    bufferedTodayCents: bufferedToday,
    recentMoves: moveRows.map((m) => ({ direction: m.direction, amountCents: m.amountCents, state: m.state, date: m.plannedFor })),
    openJumpPrompt,
    externalBills: external,
  };

  const checkingCents = ctx.homeBase ? await checkingBalance(ctx.homeBase, ctx.today, ctx.vault?.id ?? null) : 0;
  return { state, txns, balances: { checkingCents }, profile: profile ?? null };
}
