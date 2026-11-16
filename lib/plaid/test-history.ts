import { eq } from "drizzle-orm";
import { addDays } from "@/engine/dates";
import { localDate } from "@/lib/clock";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { connectPersona } from "@/lib/demo/seed";
import { env } from "@/lib/env";
import { generatePersona, type PersonaKey } from "@/personas";
import { plaid } from "./client";

// Test banks only (Plaid Sandbox). Never used with real accounts.
//
// A person connects through Plaid's real window. In Sandbox, every bank there
// returns the same stock test user: someone else's name, and transactions with
// no income pattern Stabl could learn from. So once Link finishes, Stabl asks
// Plaid's Sandbox for a custom test user instead: the person's own name, under
// the bank they picked, with six months of history for the way they said they
// earn. Everything after that is the normal path: Plaid serves the accounts and
// transactions, and the engine learns from them.

const HISTORY_FOR: Record<string, PersonaKey> = {
  freelance: "jemaya",
  commission: "jordan",
  own_business: "ada",
  mix: "jemaya",
};

// The freelance history ends on a quiet stretch. A client payment yesterday
// gives a new person's first check something to act on.
const RECENT_PAYMENT = { cents: 2_650_00, name: "STRIPE TRANSFER ST 55210" };

// Which bank did the person pick in Link? Then drop that connection: its stock
// data is not used.
export async function pickedInstitution(publicToken: string): Promise<string> {
  const { data } = await plaid().itemPublicTokenExchange({ public_token: publicToken });
  let name = "Bank";
  try {
    const { data: item } = await plaid().itemGet({ access_token: data.access_token });
    name = item.item.institution_name ?? name;
  } catch {
    // The name is cosmetic.
  }
  await plaid().itemRemove({ access_token: data.access_token }).catch(() => {});
  return name;
}

type Person = { id: string; timezone: string; legalName: string | null; name: string | null; earnType: string | null };

// Connect the next bank of the person's test history under `institution`.
// Returns false when all of it is connected already.
export async function connectTestHistory(user: Person, institution: string): Promise<boolean> {
  if (env.plaidMode === "production") throw new Error("Test history is never used with real banks.");
  const key = HISTORY_FOR[user.earnType ?? "freelance"] ?? "jemaya";
  const today = localDate(new Date(), user.timezone);
  const gp = generatePersona(key, today, { pitch: false });

  const mine = await db.select({ mask: accounts.mask }).from(accounts).where(eq(accounts.userId, user.id));
  const have = new Set(mine.map((a) => a.mask));
  const next = gp.persona.items.find((item) => !item.accounts.some((a) => have.has(a.mask)));
  if (!next) return false;

  const home = next.accounts.find((a) => a.homeBase);
  if (home && key === "jemaya") {
    gp.txns.push({ id: "recent-payment", accountId: home.key, date: addDays(today, -1), amountCents: RECENT_PAYMENT.cents, name: RECENT_PAYMENT.name } as (typeof gp.txns)[number]);
    gp.endBalances[home.key] += RECENT_PAYMENT.cents;
  }

  await connectPersona(user.id, gp, () => {}, user.legalName ?? user.name ?? "", { itemKey: next.key, label: institution });
  return true;
}
