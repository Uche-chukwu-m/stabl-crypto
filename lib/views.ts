import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { ENGINE, SAFETY } from "@/engine/config";
import { addDays, weekStart, type ISODate } from "@/engine/dates";
import { checkingBalance } from "@/lib/balances";
import { pendingCode } from "@/lib/codes";
import { accountLabel, loadContext } from "@/lib/context";
import { titleCase } from "@/lib/format";
import { db } from "@/lib/db";
import {
  accounts,
  bills,
  channels,
  engineProfiles,
  ledgerEntries,
  messages,
  moves,
  plaidItems,
  prompts,
  sourceTags,
  transactions,
} from "@/lib/db/schema";
import { emergenciesUsed } from "@/lib/security";
import { interestEarned, vault } from "@/lib/vault";

// Read models for the five tabs. Screens render these on the server, and the
// JSON routes return the same shapes, so the two never drift.

export type ThreadMessage = {
  id: string;
  body: string;
  fromUser: boolean;
  createdAt: string;
  template: string;
  replies: string[];
  promptId: string | null;
  moveId: string | null;
};

export async function threadFor(userId: string, limit = 200): Promise<ThreadMessage[]> {
  const rows = await db
    .select({ m: messages, prompt: prompts, move: moves })
    .from(messages)
    .leftJoin(prompts, eq(messages.promptId, prompts.id))
    .leftJoin(moves, eq(messages.moveId, moves.id))
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse().map(({ m, prompt, move }) => {
    let replies: string[] = [];
    if (prompt && prompt.answer === null) replies = prompt.kind === "mystery" ? ["YES", "NO"] : ["PAUSE", "KEEP"];
    else if (m.template === "buffer_announced" && move?.state === "announced") replies = ["STOP"];
    else if (m.template === "home_base_change") replies = ["FREEZE"];
    return {
      id: m.id,
      body: m.fromUser ? m.body : m.body.replace(/^Stabl: /, ""),
      fromUser: m.fromUser,
      createdAt: m.createdAt.toISOString(),
      template: m.template,
      replies,
      promptId: m.promptId,
      moveId: m.moveId,
    };
  });
}

export type WeekPoint = { week: ISODate; incomeCents: number; buffered: number; released: number; vaultCents: number };

export async function homeView(userId: string) {
  const ctx = await loadContext(userId);
  const [profile] = await db.select().from(engineProfiles).where(eq(engineProfiles.userId, userId));
  const vaultCents = ctx.vault ? await vault.getBalance(ctx.vault.id) : 0;
  const checkingCents = ctx.homeBase ? await checkingBalance(ctx.homeBase, ctx.today, ctx.vault?.id ?? null) : 0;

  // 26 weeks of income, Monday to Sunday, ending with this week.
  const first = addDays(weekStart(ctx.today), -25 * 7);
  const incomeRows = await db
    .select({ date: transactions.date, amountCents: transactions.amountCents })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.class, "income"), gte(transactions.date, first), lte(transactions.date, ctx.today)));
  const moveRows = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.state, "settled"), gte(moves.plannedFor, first)));

  const weeks: WeekPoint[] = [];
  for (let i = 0; i < 26; i++) weeks.push({ week: addDays(first, i * 7), incomeCents: 0, buffered: 0, released: 0, vaultCents: 0 });
  const slot = (date: ISODate) => weeks.find((w) => date >= w.week && date < addDays(w.week, 7));
  for (const r of incomeRows) {
    const w = slot(r.date);
    if (w) w.incomeCents += r.amountCents;
  }
  for (const mv of moveRows) {
    const w = slot(mv.plannedFor);
    if (!w) continue;
    if (mv.direction === "buffer") w.buffered += mv.amountCents;
    else w.released += mv.amountCents;
  }

  // The vault's balance at the end of each week: the reservoir filling and draining.
  if (ctx.vault) {
    const entries = await db
      .select({ date: ledgerEntries.entryDate, cents: ledgerEntries.amountCents })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.vaultId, ctx.vault.id));
    for (const w of weeks) {
      const end = addDays(w.week, 6);
      w.vaultCents = entries.filter((e) => e.date <= end && e.date <= ctx.today).reduce((sum, e) => sum + e.cents, 0);
    }
  }

  const [lastMove] = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), inArray(moves.state, ["settled", "announced"])))
    .orderBy(desc(moves.createdAt))
    .limit(1);
  const weeklyHigh = Math.round((profile?.expenseHighCents ?? 0) / ENGINE.weeksPerMonth);

  const periodStart = addDays(ctx.today, -(ENGINE.feastWindowDays - 1));
  const periodIncome = incomeRows.filter((r) => r.date >= periodStart).reduce((s, r) => s + r.amountCents, 0);
  const toPeriod = ENGINE.feastWindowDays / 7 / ENGINE.weeksPerMonth;

  return {
    name: ctx.user.legalName ?? ctx.user.name ?? "",
    today: ctx.today,
    simulated: ctx.homeBase?.item.env === "production",
    status: profile?.status ?? "steady",
    ready: profile?.ready ?? false,
    hasMargin: profile?.hasMargin ?? true,
    vaultCents,
    checkingCents,
    checkingLabel: ctx.homeBase ? accountLabel(ctx.homeBase) : null,
    frozen: ctx.vault?.status === "frozen",
    pausedUntil: profile?.pausedUntil ?? null,
    period: {
      start: periodStart,
      incomeCents: periodIncome,
      lowCents: Math.round((profile?.expenseLowCents ?? 0) * toPeriod),
      highCents: Math.round((profile?.expenseHighCents ?? 0) * toPeriod),
    },
    weeklyBand: {
      lowCents: Math.round((profile?.expenseLowCents ?? 0) / ENGINE.weeksPerMonth),
      highCents: Math.round((profile?.expenseHighCents ?? 0) / ENGINE.weeksPerMonth),
    },
    // Weeks of spending at the high end the vault could cover in a slow stretch.
    coverWeeks: weeklyHigh > 0 ? vaultCents / weeklyHigh : 0,
    lastMove: lastMove
      ? { direction: lastMove.direction, amountCents: lastMove.amountCents, date: lastMove.plannedFor, state: lastMove.state, id: lastMove.id }
      : null,
    nextFastCheck: profile?.lastFastCheck ? addDays(profile.lastFastCheck, ENGINE.fastCheckEveryDays) : ctx.today,
    nextFeastCheck: profile?.lastFeastCheck ? addDays(profile.lastFeastCheck, ENGINE.feastCheckEveryDays) : ctx.today,
    weeks,
  };
}

export async function vaultView(userId: string) {
  const ctx = await loadContext(userId);
  if (!ctx.vault) return null;
  const v = ctx.vault;
  const entries = await db
    .select({ e: ledgerEntries, move: moves })
    .from(ledgerEntries)
    .leftJoin(moves, eq(ledgerEntries.moveId, moves.id))
    .where(eq(ledgerEntries.vaultId, v.id))
    .orderBy(desc(ledgerEntries.entryDate), desc(ledgerEntries.createdAt));
  const pending = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.state, "announced")))
    .orderBy(asc(moves.settleOn));
  const used = await emergenciesUsed(userId, ctx.today);
  const code = await pendingCode(userId, "emergency");
  const [ch] = await db.select().from(channels).where(eq(channels.userId, userId));
  const home = ctx.homeBase ? accountLabel(ctx.homeBase) : "checking";

  // Interest arrives daily; fold it into one line per month so the ledger reads.
  const ledger: { id: string; date: ISODate; kind: string; label: string; amountCents: number }[] = [];
  const interestByMonth = new Map<string, { date: ISODate; cents: number }>();
  for (const { e } of entries) {
    if (e.kind !== "interest") continue;
    const key = e.entryDate.slice(0, 7);
    const cur = interestByMonth.get(key);
    interestByMonth.set(key, { date: cur && cur.date > e.entryDate ? cur.date : e.entryDate, cents: (cur?.cents ?? 0) + e.amountCents });
  }
  for (const { e } of entries) {
    if (e.kind === "interest") continue;
    ledger.push({
      id: e.id,
      date: e.entryDate,
      kind: e.kind,
      label: e.kind === "buffer" ? `From ${home}` : e.kind === "release" ? `To ${home}` : `Emergency unlock to ${home}`,
      amountCents: e.amountCents,
    });
  }
  for (const [key, { date, cents }] of interestByMonth) {
    ledger.push({ id: `interest-${key}`, date, kind: "interest", label: "Interest (simulated)", amountCents: cents });
  }
  ledger.sort((a, b) => b.date.localeCompare(a.date));

  return {
    today: ctx.today,
    balanceCents: await vault.getBalance(v.id),
    status: v.status,
    mask: v.mask,
    legalName: v.legalName,
    partnerLabel: v.partnerLabel,
    openedAt: v.openedAt.toISOString(),
    interestCents: await interestEarned(v.id),
    apy: Number(process.env.VAULT_APY ?? "3.50"),
    ledger,
    pending: pending.map((p) => ({ id: p.id, amountCents: p.amountCents, settleOn: p.settleOn, direction: p.direction })),
    emergency: {
      left: Math.max(0, SAFETY.emergencyPerWindow - used),
      codeWaiting: Boolean(code),
      opensAt: code?.notBefore && code.notBefore > new Date() ? code.notBefore.toISOString() : null,
      lockedUntil: ch?.emergencyLockedUntil && ch.emergencyLockedUntil > new Date() ? ch.emergencyLockedUntil.toISOString() : null,
    },
    homeLabel: home,
  };
}

export async function accountsView(userId: string) {
  const ctx = await loadContext(userId);
  const items = await db.select().from(plaidItems).where(eq(plaidItems.userId, userId)).orderBy(asc(plaidItems.createdAt));
  const accts = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.createdAt));

  const since = addDays(ctx.today, -ENGINE.historyDays);
  const credits = await db
    .select({ key: transactions.sourceKey, cls: transactions.class, amountCents: transactions.amountCents, name: transactions.name, date: transactions.date, id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, since), lte(transactions.date, ctx.today), inArray(transactions.class, ["income", "mystery", "not_income"])));
  const tags = await db.select().from(sourceTags).where(eq(sourceTags.userId, userId));
  const tagOf = new Map(tags.map((t) => [t.sourceKey, t]));

  const sources = new Map<string, { key: string; totalCents: number; count: number; lastName: string; lastDate: ISODate }>();
  for (const c of credits) {
    if (c.cls === "mystery") continue;
    const s = sources.get(c.key) ?? { key: c.key, totalCents: 0, count: 0, lastName: c.name, lastDate: c.date };
    s.totalCents += c.amountCents;
    s.count += 1;
    if (c.date >= s.lastDate) {
      s.lastDate = c.date;
      s.lastName = c.name;
    }
    sources.set(c.key, s);
  }
  const mysteries = credits
    .filter((c) => c.cls === "mystery" && !tagOf.has(c.key))
    .sort((a, b) => b.date.localeCompare(a.date));
  const openPrompts = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.userId, userId), eq(prompts.kind, "mystery"), isNull(prompts.answer)));

  const upcoming = await db
    .select()
    .from(bills)
    .where(and(eq(bills.userId, userId), ne(bills.kind, "card_payment")))
    .orderBy(asc(bills.nextDue));

  return {
    homeBaseId: ctx.homeBase?.id ?? null,
    pendingHomeBase: ctx.user.homeBasePendingAccountId
      ? { accountId: ctx.user.homeBasePendingAccountId, until: ctx.user.homeBasePendingUntil?.toISOString() ?? null }
      : null,
    items: items.map((item) => ({
      id: item.id,
      institution: item.institutionName,
      status: item.status,
      env: item.env,
      accounts: accts
        .filter((a) => a.itemId === item.id)
        .map((a) => ({
          id: a.id,
          name: a.name,
          officialName: a.officialName,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          isHomeBase: a.isHomeBase,
          ownerNames: a.ownerNames,
        })),
    })),
    sources: [...sources.values()]
      .map((s) => ({ ...s, tag: tagOf.get(s.key)?.tag ?? "income", setBy: tagOf.get(s.key)?.setBy ?? "engine" }))
      .sort((a, b) => b.totalCents - a.totalCents),
    mysteries: dedupeBy(mysteries, (m) => m.key).map((m) => ({
      sourceKey: m.key,
      name: m.name,
      amountCents: m.amountCents,
      date: m.date,
      promptId: openPrompts.find((p) => (p.payloadJson as { sourceKey?: string }).sourceKey === m.key)?.id ?? null,
    })),
    bills: upcoming.map((b) => ({ payee: b.payee, amountCents: b.amountCents, nextDue: b.nextDue, dayOfMonth: b.dayOfMonth })),
  };
}

function dedupeBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}

export type FeedItem = {
  id: string;
  date: ISODate;
  title: string;
  subtitle: string;
  amountCents: number;
  tone: "in" | "out" | "vault_in" | "vault_out" | "pending";
  vault: boolean;
};

// One bank style list: every transaction on connected accounts and every vault
// move, newest first. Stabl's own moves replace their bank side rows.
export async function activityFeed(userId: string, opts: { limit?: number; days?: number } = {}): Promise<FeedItem[]> {
  const ctx = await loadContext(userId);
  const since = addDays(ctx.today, -(opts.days ?? 60));
  const accts = await db.select().from(accounts).where(eq(accounts.userId, userId));
  const label = new Map(accts.map((a) => [a.id, `${a.name}${a.mask ? ` ${a.mask}` : ""}`]));
  const txns = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, since), lte(transactions.date, ctx.today)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt));
  const moveRows = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), gte(moves.plannedFor, since), inArray(moves.state, ["settled", "announced"])))
    .orderBy(desc(moves.plannedFor));

  const items: FeedItem[] = [];
  for (const m of moveRows) {
    const isIn = m.direction === "buffer";
    items.push({
      id: m.id,
      date: m.state === "settled" && m.settledAt ? (m.direction === "buffer" ? m.settleOn : m.plannedFor) : m.plannedFor,
      title: isIn ? "Set aside" : m.direction === "emergency" ? "Emergency unlock" : "Sent back",
      subtitle: m.state === "announced" ? "Moving to your vault tomorrow" : isIn ? "Into your vault" : "From your vault to checking",
      amountCents: m.amountCents,
      tone: m.state === "announced" ? "pending" : isIn ? "vault_in" : "vault_out",
      vault: true,
    });
  }
  for (const t of txns) {
    if (t.class === "vault" || t.pending) continue;
    items.push({
      id: t.id,
      date: t.date,
      title: titleCase(t.sourceKey),
      subtitle:
        t.class === "mystery" ? "New money, needs a label" : t.class === "internal" ? "Between your accounts" : t.class === "income" ? "Income" : (label.get(t.accountId) ?? ""),
      amountCents: t.amountCents,
      tone: t.amountCents >= 0 ? "in" : "out",
      vault: false,
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || Number(b.vault) - Number(a.vault));
  return items.slice(0, opts.limit ?? 200);
}
