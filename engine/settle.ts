import { ENGINE } from "./config";
import type { ISODate } from "./dates";
import { billsDueCents } from "./learn";
import type { Bill } from "./types";

// The safety rule, run again with a fresh balance at the moment a buffer settles:
// checking after the move must still cover every bill due in the next 14 days
// plus the floor. If it does not, the buffer is cancelled.
export function settleCheck(amountCents: number, checkingCents: number, bills: Bill[], today: ISODate) {
  const requiredCents = billsDueCents(bills, today, ENGINE.safetyWindowDays) + ENGINE.floorCents;
  const afterCents = checkingCents - amountCents;
  return { ok: afterCents >= requiredCents, requiredCents, afterCents };
}
