import { ENGINE } from "./config";
import {
  addDays,
  addMonths,
  dayNumber,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  fromDayNumber,
  monthKey,
  weekOfMonth,
  weekOfMonthLength,
  type ISODate,
} from "./dates";
import { median, percentile } from "./money";
import { looksLikeCardPayment } from "./sources";
import type { Bill, LearnedProfile, Txn, TxnClass } from "./types";

const DAYS_PER_MONTH = ENGINE.weeksPerMonth * 7;

export function learnProfile(
  txns: Txn[],
  classes: Record<string, TxnClass>,
  sourceKeys: Record<string, string>,
  today: ISODate,
  homeBaseId: string | null,
  externalBills: Bill[] = [],
): LearnedProfile {
  const windowStart = addDays(today, -(ENGINE.historyDays - 1));
  const inWindow = txns.filter((t) => !t.pending && t.date >= windowStart && t.date <= today);
  const earliest = inWindow.reduce((min, t) => (t.date < min ? t.date : min), today);
  const start = earliest > windowStart ? earliest : windowStart;
  const historyDays = daysBetween(start, today) + 1;

  const expenses = inWindow.filter((t) => classes[t.id] === "expense");
  const income = inWindow.filter((t) => classes[t.id] === "income");

  const dailyExpense = dailySeries(expenses, start, historyDays);
  const dailyIncome = dailySeries(income, start, historyDays);

  // Rolling 4 week spending, read as a monthly figure.
  const fourWeek = rollingSums(dailyExpense, 28);
  const toMonthly = ENGINE.weeksPerMonth / 4;
  const expenseLowCents = Math.round(percentile(fourWeek, ENGINE.expenseLowPercentile) * toMonthly);
  const expenseHighCents = Math.round(percentile(fourWeek, ENGINE.expenseHighPercentile) * toMonthly);

  const threeWeek = rollingSums(dailyIncome, 21);
  const typical3wIncomeCents = median(threeWeek);
  const feast3wIncomeCents = percentile(threeWeek, ENGINE.feastIncomePercentile);

  const totalIncome = dailyIncome.reduce((a, b) => a + b, 0);
  const avgMonthlyIncomeCents = Math.round((totalIncome * DAYS_PER_MONTH) / historyDays);

  const detected = detectBills(expenses, sourceKeys, today, historyDays, "expense");
  const known = new Set(detected.map((b) => b.payee));
  const expenseBills = [...detected, ...externalBills.filter((b) => !known.has(b.payee))];
  const billKeys = new Set(expenseBills.map((b) => b.payee));
  const monthlyBillsCents = expenseBills.reduce((sum, b) => sum + b.amountCents, 0);

  // Paying a credit card from checking is not spending (the purchases already
  // were), but the cash still leaves checking on a schedule. It counts as a bill
  // for the fast check and the safety rule, and stays out of the spending range.
  const cardPayments = inWindow.filter(
    (t) => t.accountId === homeBaseId && t.amountCents < 0 && classes[t.id] === "internal" && looksLikeCardPayment(t.name),
  );
  const bills = [...expenseBills, ...detectBills(cardPayments, sourceKeys, today, historyDays, "card_payment")].sort((a, b) =>
    a.nextDue.localeCompare(b.nextDue),
  );

  const everyday = expenses.filter((t) => !billKeys.has(sourceKeys[t.id]));
  const rhythm = learnRhythm(everyday, start, today);
  // Share of everyday spending paid straight from home base, so card purchases
  // are not also expected to leave checking this week.
  const everydayTotal = everyday.reduce((sum, t) => sum - t.amountCents, 0);
  const everydayHome = everyday.filter((t) => t.accountId === homeBaseId).reduce((sum, t) => sum - t.amountCents, 0);
  const checkingShare = everydayTotal > 0 ? everydayHome / everydayTotal : 1;

  return {
    ready: historyDays >= ENGINE.minHistoryDays,
    historyDays,
    expenseLowCents,
    expenseHighCents,
    rhythm,
    typical3wIncomeCents,
    feast3wIncomeCents,
    avgMonthlyIncomeCents,
    monthlyBillsCents,
    checkingShare,
    hasMargin: avgMonthlyIncomeCents >= expenseLowCents,
    bills,
  };
}

function dailySeries(txns: Txn[], start: ISODate, days: number): number[] {
  const series = new Array<number>(days).fill(0);
  const base = dayNumber(start);
  for (const t of txns) {
    const i = dayNumber(t.date) - base;
    if (i >= 0 && i < days) series[i] += Math.abs(t.amountCents);
  }
  return series;
}

// Sums of every `width` day window. With less history than one window, the one
// partial window is scaled up so the number still means "per window".
function rollingSums(series: number[], width: number): number[] {
  if (series.length === 0) return [0];
  if (series.length < width) {
    const total = series.reduce((a, b) => a + b, 0);
    return [Math.round((total * width) / series.length)];
  }
  const sums: number[] = [];
  let running = series.slice(0, width).reduce((a, b) => a + b, 0);
  sums.push(running);
  for (let i = width; i < series.length; i++) {
    running += series[i] - series[i - width];
    sums.push(running);
  }
  return sums;
}

// Share of a month's everyday spending that lands in each week of the month.
function learnRhythm(txns: Txn[], start: ISODate, today: ISODate): LearnedProfile["rhythm"] {
  const byMonth = new Map<string, [number, number, number, number]>();
  for (const t of txns) {
    const key = monthKey(t.date);
    const buckets = byMonth.get(key) ?? [0, 0, 0, 0];
    buckets[weekOfMonth(t.date)] += Math.abs(t.amountCents);
    byMonth.set(key, buckets);
  }

  const shares: [number, number, number, number][] = [];
  for (const [key, buckets] of byMonth) {
    const [y, m] = key.split("-").map(Number);
    const first = `${key}-01`;
    const last = `${key}-${String(daysInMonth(y, m - 1)).padStart(2, "0")}`;
    if (first < start || last > today) continue; // only whole months
    const total = buckets.reduce((a, b) => a + b, 0);
    if (total > 0) shares.push(buckets.map((b) => b / total) as [number, number, number, number]);
  }

  if (shares.length === 0) return [7 / 30.4, 7 / 30.4, 7 / 30.4, 9.4 / 30.4];
  const avg = [0, 1, 2, 3].map((i) => shares.reduce((sum, s) => sum + s[i], 0) / shares.length);
  return avg as LearnedProfile["rhythm"];
}

export function detectBills(
  expenses: Txn[],
  sourceKeys: Record<string, string>,
  today: ISODate,
  historyDays: number,
  kind: Bill["kind"],
): Bill[] {
  const groups = new Map<string, Txn[]>();
  for (const t of expenses) {
    const key = sourceKeys[t.id];
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const minOccurrences = historyDays < 90 ? 2 : ENGINE.billMinOccurrences;
  const bills: Bill[] = [];

  for (const [payee, list] of groups) {
    if (list.length < minOccurrences) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    const monthlyGaps = gaps.filter((g) => g >= ENGINE.billMinGapDays && g <= ENGINE.billMaxGapDays);
    if (monthlyGaps.length < gaps.length * 0.7) continue;

    const amounts = sorted.map((t) => Math.abs(t.amountCents));
    // Card payments swing with what was charged, so they use a recent average.
    const typical = kind === "card_payment" ? Math.round(median(amounts.slice(-3))) : median(amounts);
    const steady = amounts.filter((a) => Math.abs(a - typical) <= typical * ENGINE.billAmountTolerance);
    if (kind === "expense" && steady.length < amounts.length * 0.7) continue;

    const last = sorted[sorted.length - 1];
    // A bill not seen for well over a month has probably stopped.
    if (daysBetween(last.date, today) > ENGINE.billMaxGapDays + ENGINE.billGraceDays) continue;

    const dom = dayOfMonth(last.date);
    bills.push({
      payee,
      amountCents: typical,
      dayOfMonth: dom,
      lastSeen: last.date,
      nextDue: addMonths(last.date, 1, dom),
      cadence: "monthly",
      kind,
    });
  }

  return bills.sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

// Bills due from `from` through the next `days` days. A bill a few days late with
// no payment yet still counts, because it is about to land.
export function billsDue(bills: Bill[], from: ISODate, days: number): { bill: Bill; due: ISODate }[] {
  const end = addDays(from, days - 1);
  const earliest = addDays(from, -ENGINE.billGraceDays);
  const due: { bill: Bill; due: ISODate }[] = [];
  for (const bill of bills) {
    let date = bill.nextDue;
    while (date <= end) {
      if (date >= earliest) due.push({ bill, due: date });
      date = addMonths(date, 1, bill.dayOfMonth);
    }
  }
  return due;
}

export function billsDueCents(bills: Bill[], from: ISODate, days: number): number {
  return billsDue(bills, from, days).reduce((sum, d) => sum + d.bill.amountCents, 0);
}

// Everyday spending (bills excluded) expected to leave checking over the next
// `days` days, at the high end of the range and shaped by the weekly rhythm.
export function expectedSpendCents(profile: LearnedProfile, from: ISODate, days: number): number {
  return Math.round(expectedEverydayCents(profile, from, days) * profile.checkingShare);
}

// Everyday spending across every account, before the share paid from checking.
export function expectedEverydayCents(profile: LearnedProfile, from: ISODate, days: number): number {
  const monthlyEveryday = Math.max(0, profile.expenseHighCents - profile.monthlyBillsCents);
  let share = 0;
  for (let i = 0; i < days; i++) {
    const day = fromDayNumber(dayNumber(from) + i);
    share += profile.rhythm[weekOfMonth(day)] / weekOfMonthLength(day);
  }
  return Math.round(monthlyEveryday * share);
}
