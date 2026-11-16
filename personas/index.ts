import { addDays, addMonths, daysBetween, type ISODate } from "@/engine/dates";
import { Simulator } from "@/engine/simulate";
import type { EngineAccount, Txn } from "@/engine/types";
import { ada } from "./ada";
import { DEMO_EVENTS, eventTxns } from "./demo-events";
import { Gen, type Persona } from "./gen";
import { jordan } from "./jordan";
import { jemaya } from "./jemaya";
import { tee } from "./tee";

export const PERSONAS = { jemaya, jordan, ada, tee } as const;
export type PersonaKey = keyof typeof PERSONAS;
export type { Persona } from "./gen";

export const HISTORY_DAYS = 182;
// Stabl has been running for the last four months of each persona's history.
const STABL_START_OFFSET = -120;
const SEEDS: Record<PersonaKey, number> = { jemaya: 1101, jordan: 2202, ada: 3303, tee: 4404 };

export type GeneratedPersona = {
  persona: Persona;
  start: ISODate;
  end: ISODate;
  accounts: EngineAccount[];
  // Bank feed, including the vault transfers Stabl made during the history.
  txns: Txn[];
  checkingStartCents: number;
  endBalances: Record<string, number>;
  sim: Simulator;
  demo: DemoDryRun | null;
};

export type DemoDryRun = { bufferCents: number; releaseCents: number; marginCents: number };

// The last day of a persona's history. Jemaya's is pinned to the 20th so rent on
// the 1st falls inside the slow week of the pitch script, whatever the date.
export function historyEnd(persona: Persona, today: ISODate): ISODate {
  if (!persona.demoDayOfMonth) return today;
  const thisMonth = addMonths(today, 0, persona.demoDayOfMonth);
  return thisMonth <= today ? thisMonth : addMonths(today, -1, persona.demoDayOfMonth);
}

export function engineAccounts(persona: Persona): EngineAccount[] {
  return persona.items.flatMap((item) =>
    item.accounts.map((a) => ({
      id: a.key,
      kind: a.subtype === "credit card" ? "credit" : a.subtype === "savings" ? "savings" : "checking",
      isHomeBase: Boolean(a.homeBase),
    })),
  );
}

function homeBaseKey(persona: Persona): string {
  return engineAccounts(persona).find((a) => a.isHomeBase)!.id;
}

function bankFeed(persona: Persona, end: ISODate): Txn[] {
  const start = addDays(end, -(HISTORY_DAYS - 1));
  const g = new Gen(start, end, SEEDS[persona.key]);
  persona.build(g);
  return g.txns
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map((t, i) => ({ id: `${persona.key}_${i}`, accountId: t.account, date: t.date, amountCents: t.amountCents, name: t.name, pending: false }));
}

function runHistory(persona: Persona, feed: Txn[], checkingStart: number, end: ISODate): Simulator {
  const sim = new Simulator(engineAccounts(persona), feed, checkingStart, addDays(end, STABL_START_OFFSET));
  // History credits are labeled on the onboarding summary, not prompted.
  sim.promptAfter = null;
  sim.run();
  sim.advance(daysBetween(sim.today, end));
  // From here on, new sources get a prompt.
  sim.promptAfter = end;
  return sim;
}

// Find the opening balance that lands home base near `target` at the end of
// history. Good enough for personas whose history ends without a recent release.
function calibrate(persona: Persona, feed: Txn[], end: ISODate, target: number): Simulator {
  const home = homeBaseKey(persona);
  let start = target - feed.filter((t) => t.accountId === home).reduce((sum, t) => sum + t.amountCents, 0);
  let sim = runHistory(persona, feed, start, end);
  for (let i = 0; i < 8; i++) {
    const diff = target - sim.checkingOn(end);
    if (Math.abs(diff) < 100) break;
    start += diff;
    sim = runHistory(persona, feed, start, end);
  }
  return sim;
}

// Play the pitch script against a copy of the persona: big client pays, settle the
// next day, then a slow week. Returns what the judges would see.
export function demoDryRun(make: () => Simulator): DemoDryRun {
  const sim = make();
  const start = sim.today;
  sim.inject(eventTxns("big_client", sim.state(), sim.txns, sim.today).map((t) => ({ ...t, accountId: sim.homeBaseId })));
  sim.run({ forceFast: true, forceFeast: true });
  sim.advance(1);
  sim.inject(DEMO_EVENTS.slow_week.txns(sim.today).map((t) => ({ ...t, accountId: sim.homeBaseId })));
  sim.run({ forceFast: true });
  sim.advance(7);
  const after = sim.moves.filter((m) => m.date >= start);
  return {
    bufferCents: after.filter((m) => m.direction === "buffer" && m.state === "settled").reduce((s, m) => s + m.amountCents, 0),
    releaseCents: after.filter((m) => m.direction === "release").reduce((s, m) => s + m.amountCents, 0),
    marginCents: 0,
  };
}

// A fresh simulator at the end of a generated persona's history, for tests and
// dry runs that should not disturb the original.
export function replayHistory(gp: GeneratedPersona): Simulator {
  const feed = gp.txns.filter((t) => !t.id.startsWith("vault_"));
  return runHistory(gp.persona, feed, gp.checkingStartCents, gp.end);
}

// `pitch` pins Jemaya's history to her demo day and calibrates her for the script.
// A new user borrowing a persona's bank data gets history that ends today.
export function generatePersona(key: PersonaKey, today: ISODate, opts: { pitch?: boolean } = {}): GeneratedPersona {
  const persona = PERSONAS[key];
  const pitch = opts.pitch ?? true;
  const end = pitch ? historyEnd(persona, today) : today;
  const feed = bankFeed(persona, end);

  let sim = calibrate(persona, feed, end, persona.targetEndCheckingCents);
  let demo: DemoDryRun | null = null;

  if (pitch && persona.demoDayOfMonth) {
    // Start Jemaya Steady, just above what this week needs, with the most cushion
    // that still gives the slow week a visible release. Buffers and releases in
    // the history react to the opening balance, so scan it rather than solve.
    const need = sim.lastDecision!.needCents;
    const base = sim.checkingStartCents;
    const scan: { start: number; end: number }[] = [];
    for (let start = Math.max(0, base - 2_000_00); start <= base + 2_000_00; start += 50_00) {
      const candidate = runHistory(persona, feed, start, end);
      const endCents = candidate.checkingOn(end);
      if (candidate.lastDecision!.status === "steady" && endCents >= need) scan.push({ start, end: endCents });
    }
    for (const margin of [300_00, 250_00, 200_00, 150_00, 100_00, 50_00, 0]) {
      const best = scan
        .filter((s) => s.end >= need + margin && s.end <= need + margin + 50_00)
        .sort((a, b) => a.end - b.end)[0];
      if (!best) continue;
      const run = demoDryRun(() => runHistory(persona, feed, best.start, end));
      if (run.bufferCents > 0 && run.releaseCents >= 100_00) {
        sim = runHistory(persona, feed, best.start, end);
        demo = { ...run, marginCents: best.end - need };
        break;
      }
    }
    if (!demo) demo = demoDryRun(() => runHistory(persona, feed, sim.checkingStartCents, end));
  }

  const accounts = engineAccounts(persona);
  const endBalances: Record<string, number> = {};
  for (const a of accounts) {
    const opening = a.isHomeBase ? sim.checkingStartCents : (persona.openingCents[a.id] ?? 0);
    const net = sim.txns.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amountCents, 0);
    // Credit cards report what is owed, as a positive number.
    endBalances[a.id] = a.kind === "credit" ? Math.max(0, -(opening + net)) : opening + net;
  }

  return {
    persona,
    start: addDays(end, -(HISTORY_DAYS - 1)),
    end,
    accounts,
    txns: sim.txns,
    checkingStartCents: sim.checkingStartCents,
    endBalances,
    sim,
    demo,
  };
}

// The JSON handed to Plaid Sandbox as a custom user, one per Item.
// Plaid treats positive amounts as money leaving the account, the opposite of Stabl.
export function plaidCustomUser(gp: GeneratedPersona, itemKey: string, ownerName = gp.persona.legalName) {
  const item = gp.persona.items.find((i) => i.key === itemKey);
  if (!item) throw new Error(`Unknown item ${itemKey}`);
  return {
    seed: `stabl-${gp.persona.key}-${itemKey}`,
    // The generator already ends history on the right day; do not shift it.
    roll_dates_forward: false,
    override_accounts: item.accounts.map((a) => ({
      type: a.type,
      subtype: a.subtype,
      starting_balance: gp.endBalances[a.key] / 100,
      currency: "USD",
      meta: { name: a.name, official_name: a.officialName, mask: a.mask },
      identity: {
        names: [ownerName],
        emails: [{ data: gp.persona.email, primary: true, type: "primary" }],
        phone_numbers: [{ data: "3185550142", primary: true, type: "mobile" }],
        addresses: [
          {
            primary: true,
            data: { street: "403 Main Street", city: "Grambling", region: "LA", postal_code: "71245", country: "US" },
          },
        ],
      },
      transactions: gp.txns
        .filter((t) => t.accountId === a.key)
        .map((t) => ({
          date_transacted: t.date,
          date_posted: t.date,
          amount: -t.amountCents / 100,
          description: t.name,
          currency: "USD",
        })),
    })),
  };
}
