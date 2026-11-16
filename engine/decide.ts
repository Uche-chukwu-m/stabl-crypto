import { classify } from "./classify";
import { ENGINE } from "./config";
import { addDays, daysBetween, type ISODate } from "./dates";
import { billsDueCents, expectedSpendCents, learnProfile } from "./learn";
import { ceilDollar, floorDollar } from "./money";
import type {
  Action,
  Balances,
  DecideOptions,
  Decision,
  LearnedProfile,
  ReleaseReason,
  Status,
  Txn,
  TxnClass,
  UserState,
} from "./types";

// The whole engine. Pure: it reads what it is given and returns what should
// happen. It never calls Plaid, the vault, or the database.
export function decide(
  state: UserState,
  transactions: Txn[],
  balances: Balances,
  today: ISODate,
  opts: DecideOptions = {},
): Decision {
  const txns = transactions.filter((t) => t.date <= today);
  const classified = classify(txns, state.accounts, state);
  const homeBaseId = state.accounts.find((a) => a.isHomeBase)?.id ?? null;
  const profile = learnProfile(txns, classified.classes, classified.sourceKeys, today, homeBaseId, state.externalBills);
  const incomeIn = (days: number) => sumClass(txns, classified.classes, "income", addDays(today, -(days - 1)), today);

  const income7 = incomeIn(ENGINE.fastWindowDays);
  const bills7 = billsDueCents(profile.bills, today, ENGINE.fastWindowDays);
  const needCents = expectedSpendCents(profile, today, ENGINE.fastWindowDays) + bills7 + ENGINE.floorCents;

  const actions: Action[] = [];
  const base = { profile, ...classified, needCents };

  if (opts.learnOnly) {
    return { ...base, status: statusFor(profile, state, [], needCents, balances, today), ran: { fast: false, feast: false }, actions };
  }

  // Clock 1: fast check. Weekly, or right away when checking drops under this
  // week's bills plus the floor.
  const weeklyLow = profile.expenseLowCents / ENGINE.weeksPerMonth;
  const unusualDrop = profile.ready && income7 < weeklyLow * ENGINE.dropFraction;
  const lowBalance = balances.checkingCents < bills7 + ENGINE.floorCents;
  const fastDue = Boolean(opts.forceFast) || isDue(state.lastFastCheck, ENGINE.fastCheckEveryDays, today) || lowBalance;

  let releasedCents = 0;
  if (fastDue) {
    const gap = needCents - balances.checkingCents;
    if (gap > 0) {
      const reason: ReleaseReason = lowBalance ? "low_balance" : unusualDrop ? "unusual_drop" : "fast_check";
      if (state.frozen) actions.push({ type: "release_blocked", gapCents: gap, reason: "frozen" });
      else if (state.vaultBalanceCents <= 0) actions.push({ type: "release_blocked", gapCents: gap, reason: "vault_empty" });
      else {
        releasedCents = Math.min(ceilDollar(gap), state.vaultBalanceCents);
        actions.push({
          type: "release",
          amountCents: releasedCents,
          gapCents: gap,
          shortByCents: Math.max(0, gap - releasedCents),
          reason,
        });
      }
    }
  }

  // Clock 2: feast check, every 3 weeks. It waits while a jump prompt is open, so
  // the income it would read stays unread until the user answers.
  const feastDue =
    !state.openJumpPrompt && (Boolean(opts.forceFeast) || isDue(state.lastFeastCheck, ENGINE.feastCheckEveryDays, today));
  if (feastDue && profile.ready) {
    if (!profile.hasMargin) actions.push({ type: "no_margin" });
    else if (releasedCents === 0 && !actions.some((a) => a.type === "release_blocked")) {
      actions.push(...feastCheck(state, txns, classified.classes, profile, balances, today));
    }
  }

  if (state.promptAfter) {
    const prompted = new Set(state.promptedSources);
    for (const credit of classified.mysteryCredits) {
      if (credit.date < state.promptAfter || prompted.has(credit.sourceKey)) continue;
      prompted.add(credit.sourceKey);
      actions.push({ type: "mystery_prompt", ...credit });
    }
  }

  return {
    ...base,
    status: statusFor(profile, state, actions, needCents, balances, today),
    ran: { fast: fastDue, feast: feastDue },
    actions,
  };
}

function feastCheck(
  state: UserState,
  txns: Txn[],
  classes: Record<string, TxnClass>,
  profile: LearnedProfile,
  balances: Balances,
  today: ISODate,
): Action[] {
  const windowStart = feastWindowStart(state, today);
  const income = sumClass(txns, classes, "income", windowStart, today);
  const highFor3Weeks = feastCushion(profile);
  const surplus = income - highFor3Weeks;
  if (surplus <= ENGINE.minBufferCents) return [];

  if (state.frozen) return [{ type: "buffer_skipped", surplusCents: surplus, reason: "frozen" }];
  if (state.pausedUntil && state.pausedUntil >= today) return [{ type: "buffer_skipped", surplusCents: surplus, reason: "paused" }];
  if (state.homeBasePendingUntil && state.homeBasePendingUntil >= today) {
    return [{ type: "buffer_skipped", surplusCents: surplus, reason: "home_base_pending" }];
  }

  // Slow to take: a stretch far above normal only buffers what a typical good
  // stretch would, and asks before touching the rest.
  const jump = profile.typical3wIncomeCents > 0 && income > ENGINE.jumpMultiplier * profile.typical3wIncomeCents;
  const typicalFeast = Math.max(0, profile.feast3wIncomeCents - highFor3Weeks);
  const planned = jump ? Math.min(surplus, typicalFeast) : surplus;

  const { safetyMax, limitMax } = bufferRoom(state, profile, balances, today);
  const amount = floorDollar(Math.min(planned, safetyMax, limitMax));

  const actions: Action[] = [];
  if (amount < ENGINE.minBufferCents) {
    const reason = planned < ENGINE.minBufferCents ? "below_minimum" : safetyMax <= limitMax ? "safety" : "daily_limit";
    actions.push({ type: "buffer_skipped", surplusCents: surplus, reason });
  } else {
    const limitedBy =
      amount < floorDollar(planned) ? (safetyMax <= limitMax ? "safety" : "daily_limit") : jump ? "typical_feast" : "surplus";
    actions.push({
      type: "buffer",
      amountCents: amount,
      surplusCents: surplus,
      shrunk: limitedBy === "safety",
      limitedBy,
    });
  }

  if (jump) {
    const deposit = txns
      .filter((t) => classes[t.id] === "income" && t.date >= windowStart && t.date <= today)
      .reduce((max, t) => Math.max(max, t.amountCents), 0);
    actions.push({
      type: "jump_prompt",
      depositCents: deposit,
      incomeCents: income,
      bufferCents: amount >= ENGINE.minBufferCents ? amount : 0,
      heldCents: Math.max(0, surplus - planned),
    });
  }

  return actions;
}

// Feast while Stabl is buffering, Fast while it is releasing or checking is short
// this week, Steady otherwise.
// Income since the last feast check, at most three weeks back. Each check reads
// a stretch of income once, so nothing is buffered twice.
export function feastWindowStart(state: Pick<UserState, "lastFeastCheck">, today: ISODate): ISODate {
  const threeWeeksBack = addDays(today, -(ENGINE.feastWindowDays - 1));
  const sinceLast = state.lastFeastCheck ? addDays(state.lastFeastCheck, 1) : threeWeeksBack;
  return sinceLast > threeWeeksBack ? sinceLast : threeWeeksBack;
}

// The money has to last until the next feast check, so three weeks of spending
// at the high end always stays in checking. Only income above this is surplus.
export function feastCushion(profile: LearnedProfile): number {
  return Math.round((ENGINE.feastWindowDays / 7 / ENGINE.weeksPerMonth) * profile.expenseHighCents);
}

// Money of one class between two dates, inclusive, as a positive amount.
export function sumClass(txns: Txn[], classes: Record<string, TxnClass>, cls: TxnClass, from: ISODate, to: ISODate): number {
  let sum = 0;
  for (const t of txns) {
    if (!t.pending && classes[t.id] === cls && t.date >= from && t.date <= to) sum += Math.abs(t.amountCents);
  }
  return sum;
}

// How much a buffer may take right now: checking minus anything already announced
// (it leaves tomorrow), minus every bill due before the next feast check, a day of
// spending (the buffer settles tomorrow), and the floor. Also the daily limit.
export function bufferRoom(
  state: Pick<UserState, "recentMoves" | "dailyLimitCents" | "bufferedTodayCents">,
  profile: LearnedProfile,
  balances: Balances,
  today: ISODate,
) {
  const announced = state.recentMoves
    .filter((m) => m.direction === "buffer" && m.state === "announced")
    .reduce((sum, m) => sum + m.amountCents, 0);
  const safetyMax =
    balances.checkingCents -
    announced -
    billsDueCents(profile.bills, today, ENGINE.safetyWindowDays + 1) -
    expectedSpendCents(profile, today, 1) -
    ENGINE.floorCents;
  return { safetyMax, limitMax: state.dailyLimitCents - state.bufferedTodayCents };
}

function statusFor(
  profile: LearnedProfile,
  state: UserState,
  actions: Action[],
  needCents: number,
  balances: Balances,
  today: ISODate,
): Status {
  if (actions.some((a) => a.type === "release" || a.type === "release_blocked")) return "fast";
  if (actions.some((a) => a.type === "buffer")) return "feast";

  const weekAgo = addDays(today, -6);
  const latest = state.recentMoves
    .filter((m) => m.state !== "cancelled" && m.state !== "planned" && m.date >= weekAgo)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (latest) return latest.direction === "buffer" ? "feast" : "fast";

  if (profile.ready && needCents > balances.checkingCents) return "fast";
  return "steady";
}

function isDue(last: ISODate | null, everyDays: number, today: ISODate): boolean {
  return !last || daysBetween(last, today) >= everyDays;
}

