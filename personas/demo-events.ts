import { decide, feastCushion, feastWindowStart, sumClass } from "@/engine/decide";
import { addDays, type ISODate } from "@/engine/dates";
import { ceilDollar } from "@/engine/money";
import type { Txn, UserState } from "@/engine/types";

export type DemoEventKey = "big_client" | "slow_week" | "new_source" | "huge_jump";

export type DemoTxn = { date: ISODate; amountCents: number; name: string };

export type DemoEvent = {
  key: DemoEventKey;
  label: string;
  description: string;
  // Which checks the admin runs right after injecting, as the webhook would.
  forceFeast: boolean;
  // Size the payment so the feast check sets aside exactly this much.
  targetBufferCents?: number;
  txns(today: ISODate, paymentCents?: number): DemoTxn[];
};

// The four live demo events from the PRD. All land on home base checking and use
// the demo clock date, so dates stay consistent after the clock is advanced.
export const DEMO_EVENTS: Record<DemoEventKey, DemoEvent> = {
  big_client: {
    key: "big_client",
    label: "Big client pays",
    description: "A client payment from STRIPE TRANSFER ACME STUDIO, sized so the feast check sets aside $650.00.",
    forceFeast: true,
    targetBufferCents: 650_00,
    txns: (today, paymentCents = 4_800_00) => [{ date: today, amountCents: paymentCents, name: "STRIPE TRANSFER ACME STUDIO" }],
  },
  slow_week: {
    key: "slow_week",
    label: "Slow week",
    description: "No income, a $620.00 repair at MIDAS AUTO 2231, a rental car, and a normal week of spending. Then advance 7 days.",
    forceFeast: false,
    txns: (today) => [
      { date: today, amountCents: -620_00, name: "MIDAS AUTO 2231" },
      { date: today, amountCents: -96_40, name: "ENTERPRISE RENT A CAR" },
      { date: addDays(today, 1), amountCents: -94_18, name: "KROGER #412" },
      { date: addDays(today, 2), amountCents: -41_70, name: "SHELL OIL 5741" },
      { date: addDays(today, 3), amountCents: -13_84, name: "CHICK FIL A #1123" },
      { date: addDays(today, 4), amountCents: -38_99, name: "AMAZON MKTP US" },
      { date: addDays(today, 6), amountCents: -81_40, name: "KROGER #412" },
    ],
  },
  new_source: {
    key: "new_source",
    label: "New source",
    description: "$300.00 from ZELLE FROM K JONES. Mystery credit prompt.",
    forceFeast: false,
    txns: (today) => [{ date: today, amountCents: 300_00, name: "ZELLE FROM K JONES" }],
  },
  huge_jump: {
    key: "huge_jump",
    label: "Huge jump",
    description: "$12,000.00 from PAYROLL NEW EMPLOYER LLC. Typical buffer only, then PAUSE or KEEP.",
    forceFeast: true,
    txns: (today) => [{ date: today, amountCents: 12_000_00, name: "PAYROLL NEW EMPLOYER LLC" }],
  },
};

// The client payment that makes the next feast check set aside exactly `target`.
// It uses the engine's own rules: three weeks of high end spending stays in
// checking, and only income above that, since the last feast check, is surplus.
// Rounded up to a whole dollar, which the buffer then rounds back down.
export function paymentForBuffer(state: UserState, txns: Txn[], today: ISODate, targetCents: number): number {
  const d = decide(state, txns, { checkingCents: 0 }, today, { learnOnly: true });
  const already = sumClass(txns, d.classes, "income", feastWindowStart(state, today), today);
  return ceilDollar(Math.max(100_00, targetCents + feastCushion(d.profile) - already));
}

// The transactions for an event, with the payment sized when the event asks for it.
export function eventTxns(key: DemoEventKey, state: UserState, txns: Txn[], today: ISODate): DemoTxn[] {
  const event = DEMO_EVENTS[key];
  const payment = event.targetBufferCents ? paymentForBuffer(state, txns, today, event.targetBufferCents) : undefined;
  return event.txns(today, payment);
}
