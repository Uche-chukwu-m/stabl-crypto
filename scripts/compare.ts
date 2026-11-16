// npx tsx scripts/compare.ts [people]
// Does Stabl help? A simulation, not a study. It writes docs/simulation.md.
//
// It builds synthetic freelancers who are not the app's presenter personas:
// random income levels, random client payment timing, lean stretches, rent and
// bills, and everyday spending. Each gets six months of history for Stabl to
// learn from, then six months where Stabl runs day by day through the real
// engine (engine/simulate.ts), the same code the app uses.
//
// The same person is run twice on the same bank feed: once with Stabl and once
// without. Two questions, kept apart because they rest on different assumptions:
//
//   1. Harm. With spending fixed, does Stabl ever leave checking short on a day
//      it would otherwise have been fine? This needs no assumption about behavior.
//      (With spending fixed Stabl cannot reduce shortfalls: money in the vault is
//      money that would otherwise have sat in checking.)
//   2. Benefit. Stabl's case is that money you can see gets spent. Here part of
//      any balance above a month of bills is spent each week, at a stated rate.
//      The vault keeps that part out of sight. Rates of 0, 10, 20 and 30 percent
//      are reported so the result can be read at whatever rate you believe.
import { mkdirSync, writeFileSync } from "node:fs";
import { ENGINE } from "@/engine/config";
import { addDays, daysBetween, type ISODate } from "@/engine/dates";
import { Simulator } from "@/engine/simulate";
import type { EngineAccount, Txn } from "@/engine/types";
import { everyday } from "@/personas/everyday";
import { Gen, rng } from "@/personas/gen";

const PEOPLE = Number(process.argv[2] ?? 60);
const HISTORY = 182;
const ACTIVE = 182;
const END: ISODate = "2026-11-15";
const START = addDays(END, -(HISTORY + ACTIVE - 1));
const ACTIVE_START = addDays(START, HISTORY);
const RATES = [0, 0.1, 0.2, 0.3];
const ACCOUNTS: EngineAccount[] = [{ id: "checking", kind: "checking", isHomeBase: true }];

type Person = { id: number; monthlyIncome: number; spendRatio: number; feed: Txn[]; startCents: number; billsCents: number };

// One synthetic freelancer. Income arrives as client payments at random gaps,
// with one or two lean stretches a year. Spending is set as a share of income.
function makePerson(id: number): Person {
  const r = rng(9000 + id);
  const pick = (a: number, b: number) => a + r() * (b - a);
  const monthlyIncome = Math.round(pick(2500, 6500));
  // Most earn more than they spend; a few do not, to see that Stabl stays out.
  const spendRatio = id % 10 === 9 ? pick(1.02, 1.1) : pick(0.82, 0.97);
  const g = new Gen(START, END, 9000 + id);
  const days = HISTORY + ACTIVE;

  const leans: [number, number][] = [];
  for (let i = 0; i < 1 + (r() < 0.6 ? 1 : 0); i++) {
    const at = Math.floor(pick(20, days - 60));
    leans.push([at, at + Math.floor(pick(21, 45))]);
  }
  const payments: { offset: number; weight: number }[] = [];
  for (let d = Math.floor(pick(0, 5)); d < days; d += Math.floor(pick(3, 12))) {
    if (!leans.some(([a, b]) => d >= a && d < b)) payments.push({ offset: d - (days - 1), weight: 0.4 + r() * 1.6 });
  }
  const total = monthlyIncome * (days / 30.44) * 100;
  const weight = payments.reduce((s, p) => s + p.weight, 0);
  for (const p of payments) g.add("checking", g.day(p.offset), Math.round((total * p.weight) / weight / 100) * 100, `CLIENT PAYMENT ${1000 + Math.floor(r() * 9000)}`);

  const spend = monthlyIncome * spendRatio;
  const rent = Math.round(spend * pick(0.3, 0.4) * 100);
  const car = r() < 0.6 ? Math.round(pick(250, 450) * 100) : 0;
  const fixed = [
    { day: 1, cents: rent, name: "RENT PAYMENT" },
    { day: 3, cents: car, name: "AUTO LOAN" },
    { day: 8, cents: Math.round(pick(60, 90) * 100), name: "INTERNET" },
    { day: 12, cents: Math.round(pick(50, 95) * 100), name: "PHONE BILL" },
    { day: 18, cents: Math.round(pick(80, 160) * 100), name: "ELECTRIC CO" },
    { day: 22, cents: Math.round(pick(15, 60) * 100), name: "SUBSCRIPTION" },
  ].filter((b) => b.cents > 0);
  for (const b of fixed) g.monthly(b.day, (d) => g.spend("checking", d, b.cents, b.name));
  const billsCents = fixed.reduce((s, b) => s + b.cents, 0);

  // Everyday spending fills the rest of the budget.
  const weekly = Math.max(60, (spend * 100 - billsCents) / 100 / 4.35);
  everyday(g, "checking", {
    grocers: ["KROGER", "ALDI", "PUBLIX"],
    groceryDollars: [weekly * 0.3, weekly * 0.45],
    fuel: ["SHELL OIL", "EXXON"],
    fuelDollars: [weekly * 0.1, weekly * 0.16],
    dining: ["CHIPOTLE 220", "STARBUCKS 91", "LOCAL DINER"],
    diningPerWeek: 2,
    diningDollars: [weekly * 0.05, weekly * 0.1],
    shops: ["AMAZON MKTP US", "TARGET T 14", "WALMART 55"],
    shopsPerMonth: 3,
    shopDollars: [weekly * 0.2, weekly * 0.45],
  });

  const feed = g.txns
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map((t, i) => ({ id: `p${id}_${i}`, accountId: t.account, date: t.date, amountCents: t.amountCents, name: t.name, pending: false }));
  // Start with about two weeks of spending in checking.
  return { id, monthlyIncome, spendRatio, feed, startCents: Math.round((spend / 2) * 100), billsCents };
}

type Run = { shortDays: number; overdraftDays: number; lowest: number; harmDays: number; buffers: number; releases: number; vaultEnd: number; extraSpent: number };

// Spending that follows what is visible: once a week, `rate` of anything above
// a month of bills plus two weeks of spending goes on extras.
function cushion(p: Person) {
  return p.billsCents + Math.round(((p.monthlyIncome * p.spendRatio) / 2) * 100);
}

function runWith(p: Person, rate: number): { run: Run; daily: number[] } {
  const sim = new Simulator(ACCOUNTS, p.feed, p.startCents, ACTIVE_START);
  sim.promptAfter = null;
  let extraSpent = 0;
  const daily: number[] = [];
  sim.run();
  for (let i = 0; i < ACTIVE; i++) {
    if (rate > 0 && new Date(`${sim.today}T00:00:00Z`).getUTCDay() === 6) {
      const extra = Math.floor(Math.max(0, sim.checkingOn(sim.today) - cushion(p)) * rate);
      if (extra > 0) {
        sim.inject([{ accountId: "checking", date: sim.today, amountCents: -extra, name: "EXTRAS" }]);
        extraSpent += extra;
      }
    }
    // Stabl's answer to an unusual jump: no answer, which keeps the usual size.
    daily.push(sim.checkingOn(sim.today));
    if (i < ACTIVE - 1) sim.advance(1);
  }
  const settled = sim.moves.filter((m) => m.state === "settled");
  return {
    daily,
    run: {
      shortDays: 0,
      overdraftDays: daily.filter((c) => c < 0).length,
      lowest: Math.min(...daily),
      harmDays: 0,
      buffers: settled.filter((m) => m.direction === "buffer").length,
      releases: settled.filter((m) => m.direction === "release").length,
      vaultEnd: sim.vaultCents,
      extraSpent,
    },
  };
}

function runWithout(p: Person, rate: number): { run: Run; daily: number[] } {
  const base = p.feed.filter((t) => t.date < ACTIVE_START).reduce((s, t) => s + t.amountCents, p.startCents);
  const byDay = new Map<ISODate, number>();
  for (const t of p.feed) if (t.date >= ACTIVE_START) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amountCents);
  let checking = base;
  let extraSpent = 0;
  const daily: number[] = [];
  for (let i = 0; i < ACTIVE; i++) {
    const day = addDays(ACTIVE_START, i);
    checking += byDay.get(day) ?? 0;
    if (rate > 0 && new Date(`${day}T00:00:00Z`).getUTCDay() === 6) {
      const extra = Math.floor(Math.max(0, checking - cushion(p)) * rate);
      checking -= extra;
      extraSpent += extra;
    }
    daily.push(checking);
  }
  return {
    daily,
    run: { shortDays: 0, overdraftDays: daily.filter((c) => c < 0).length, lowest: Math.min(...daily), harmDays: 0, buffers: 0, releases: 0, vaultEnd: 0, extraSpent },
  };
}

const money = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;
const t0 = Date.now();
const people = Array.from({ length: PEOPLE }, (_, i) => makePerson(i));
const target = people.filter((p) => p.spendRatio < 1);
const over = people.filter((p) => p.spendRatio >= 1);

type Row = { rate: number; withOd: number; withoutOd: number; peopleBetter: number; peopleWorse: number; harmDays: number; withLowest: number; withoutLowest: number; buffers: number; releases: number; vault: number; extrasWith: number; extrasWithout: number };
const rows: Row[] = [];
let overBuffers = 0;
let overHarm = 0;
let overReleases = 0;
for (const rate of RATES) {
  const row: Row = { rate, withOd: 0, withoutOd: 0, peopleBetter: 0, peopleWorse: 0, harmDays: 0, withLowest: 0, withoutLowest: 0, buffers: 0, releases: 0, vault: 0, extrasWith: 0, extrasWithout: 0 };
  for (const p of target) {
    const w = runWith(p, rate);
    const wo = runWithout(p, rate);
    row.withOd += w.run.overdraftDays;
    row.withoutOd += wo.run.overdraftDays;
    if (w.run.overdraftDays < wo.run.overdraftDays) row.peopleBetter++;
    if (w.run.overdraftDays > wo.run.overdraftDays) row.peopleWorse++;
    // A day Stabl made worse: overdrawn with Stabl, not overdrawn without it.
    row.harmDays += w.daily.filter((c, i) => c < 0 && wo.daily[i] >= 0).length;
    row.withLowest += w.run.lowest;
    row.withoutLowest += wo.run.lowest;
    row.buffers += w.run.buffers;
    row.releases += w.run.releases;
    row.vault += w.run.vaultEnd;
    row.extrasWith += w.run.extraSpent;
    row.extrasWithout += wo.run.extraSpent;
  }
  rows.push(row);
  if (rate === 0) {
    for (const p of over) {
      const w = runWith(p, 0);
      const wo = runWithout(p, 0);
      overBuffers += w.run.buffers;
      overReleases += w.run.releases;
      overHarm += w.daily.filter((c, i) => c < 0 && wo.daily[i] >= 0).length;
    }
  }
  console.log(`rate ${rate * 100}%: overdraft days with Stabl ${row.withOd}, without ${row.withoutOd} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const n = target.length;
const avg = (x: number) => x / n;
const lines = [
  "# Does Stabl help? A simulation",
  "",
  `Generated by \`npx tsx scripts/compare.ts ${PEOPLE}\`. A simulation with synthetic people, not a study of real users.`,
  "",
  "## Setup",
  "",
  `- **${PEOPLE} synthetic freelancers**, none of them the app's presenter personas. Income of $2,500 to $6,500 a month, paid by clients at random gaps of 3 to 12 days, with one or two lean stretches of 3 to 6 weeks. Rent, bills and everyday spending.`,
  `- **${n} of them earn more than they spend** over the year (spending 82% to 97% of income): the people Stabl is for. **${over.length} spend more than they earn**, to check that Stabl stays out of the way.`,
  `- Six months of history for Stabl to learn from, then **six months where the real engine runs day by day** (\`engine/simulate.ts\`, the same code the app uses).`,
  "- Each person is run twice on the identical bank feed: **with Stabl, and without**.",
  "- An **overdraft day** is a day checking ends below zero.",
  "",
  "## 1. Does Stabl ever make things worse?",
  "",
  "With spending fixed (the 0% row below), money in the vault is money that would otherwise have sat in checking, so Stabl cannot reduce overdrafts. The question is only whether it causes any.",
  "",
  `- **Days Stabl made worse** (overdrawn with Stabl, fine without): **${rows[0].harmDays}** across ${n} people and ${ACTIVE} days each.`,
  `- **People with more overdraft days with Stabl than without:** ${rows[0].peopleWorse} of ${n}.`,
  `- **The ${over.length} people who spend more than they earn:** ${overBuffers} set-asides and ${overReleases} releases between them, and **${overHarm}** days Stabl made worse. Stabl judges margin from the last six months, so someone who had a good half year can still get a set-aside; the safety rules are what keep it from leaving them short.`,
  "",
  "## 2. Does it help when visible money gets spent?",
  "",
  "Stabl's case rests on a behavioral assumption: money you can see in checking tends to get spent. Here, once a week, a share of anything above a month of bills plus two weeks of spending goes on extras. The vault keeps set-aside money out of that pool. Read the table at whatever rate you find believable.",
  "",
  "| Share of spare checking spent each week | Overdraft days without Stabl | With Stabl | People better off | People worse off | Average lowest balance, without / with | Extras spent per person, without / with |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.rate * 100}% | ${r.withoutOd} | ${r.withOd} | ${r.peopleBetter} | ${r.peopleWorse} | ${money(avg(r.withoutLowest))} / ${money(avg(r.withLowest))} | ${money(avg(r.extrasWithout))} / ${money(avg(r.extrasWith))} |`,
  ),
  "",
  `Per person over the six months at 0%: ${(rows[0].buffers / n).toFixed(1)} set-asides, ${(rows[0].releases / n).toFixed(1)} releases, and ${money(avg(rows[0].vault))} left in the vault at the end.`,
  "",
  "## What this does not show",
  "",
  "- It does not show that real people spend the way the 10% to 30% rows assume. That needs real users.",
  "- It does not show that people would allow automatic transfers. That needs asking them.",
  "- The histories are synthetic. Real bank feeds are messier, and the engine has not been run against real accounts.",
  "",
];
mkdirSync("docs", { recursive: true });
writeFileSync("docs/simulation.md", lines.join("\n"));
console.log(`\nWrote docs/simulation.md in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(lines.slice(lines.indexOf("## 1. Does Stabl ever make things worse?"), lines.indexOf("## What this does not show")).join("\n"));
