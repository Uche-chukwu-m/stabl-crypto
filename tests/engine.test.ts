import { beforeAll, describe, expect, it } from "vitest";
import { ENGINE } from "@/engine/config";
import { addDays, addMonths, daysBetween } from "@/engine/dates";
import { decide } from "@/engine/decide";
import { billsDueCents } from "@/engine/learn";
import { formatCents, formatDollars } from "@/engine/money";
import type { Simulator } from "@/engine/simulate";
import { sourceKey } from "@/engine/sources";
import type { EngineAccount, Txn, UserState } from "@/engine/types";
import { DEMO_EVENTS, eventTxns, type DemoEventKey } from "@/personas/demo-events";
import { generatePersona, replayHistory, type GeneratedPersona, type PersonaKey } from "@/personas";

const TODAY = "2026-10-21";
const gp = {} as Record<PersonaKey, GeneratedPersona>;

beforeAll(() => {
  for (const key of ["jemaya", "jordan", "ada", "tee"] as PersonaKey[]) gp[key] = generatePersona(key, TODAY);
}, 120_000);

function inject(sim: Simulator, event: DemoEventKey) {
  sim.inject(eventTxns(event, sim.state(), sim.txns, sim.today).map((t) => ({ ...t, accountId: sim.homeBaseId })));
  return sim.run({ forceFast: true, forceFeast: DEMO_EVENTS[event].forceFeast });
}

describe("money and sources", () => {
  it("formats receipts with cents and charts in whole dollars", () => {
    expect(formatCents(64_000)).toBe("$640.00");
    expect(formatCents(1_210_533)).toBe("$12,105.33");
    expect(formatDollars(285_049)).toBe("$2,850");
  });

  it("collapses payout processors to one source and strips store numbers", () => {
    expect(sourceKey("STRIPE TRANSFER ACME STUDIO")).toBe("STRIPE");
    expect(sourceKey("STRIPE TRANSFER ST 40417")).toBe("STRIPE");
    expect(sourceKey("SQUARE INC DEP")).toBe("SQUARE");
    expect(sourceKey("KROGER #412")).toBe("KROGER");
    expect(sourceKey("SHELL OIL 5741")).toBe("SHELL OIL");
    expect(sourceKey("ZELLE FROM K JONES")).toBe("ZELLE FROM K JONES");
  });
});

describe("what counts as what", () => {
  it("ignores transfers between the user's own accounts, card payments, and vault moves", () => {
    const d = gp.jemaya.sim.lastDecision!;
    const byName = (name: string) => gp.jemaya.txns.filter((t) => t.name === name).map((t) => d.classes[t.id]);
    expect(new Set(byName("ONLINE TRANSFER FROM SAV 7781"))).toEqual(new Set(["internal"]));
    expect(new Set(byName("ONLINE TRANSFER TO CHK 4321"))).toEqual(new Set(["internal"]));
    expect(new Set(byName("STABL VAULT TRANSFER"))).toEqual(new Set(["vault"]));

    const jd = gp.jordan.sim.lastDecision!;
    const jordanPayments = gp.jordan.txns.filter((t) => t.name === "CAPITAL ONE MOBILE PMT" || t.name === "PAYMENT THANK YOU");
    expect(jordanPayments.length).toBeGreaterThan(4);
    expect(new Set(jordanPayments.map((t) => jd.classes[t.id]))).toEqual(new Set(["internal"]));
  });

  it("counts debits on checking, savings, and cards as expenses", () => {
    const jd = gp.jordan.sim.lastDecision!;
    const kroger = gp.jordan.txns.find((t) => t.accountId === "card" && t.name.startsWith("KROGER"))!;
    expect(jd.classes[kroger.id]).toBe("expense");
  });

  it("learns income sources and leaves one off credits as mystery credits", () => {
    const ad = gp.ada.sim.lastDecision!;
    expect(gp.ada.sim.sourceTags.SQUARE).toBe("income");
    expect(ad.mysteryCredits.map((m) => m.name).sort()).toEqual(["MOBILE DEPOSIT CHECK 1042", "VENMO CASHOUT", "ZELLE FROM T OKAFOR"]);
    expect(gp.jemaya.sim.sourceTags["INTEREST PAYMENT"]).toBe("not_income");
  });
});

describe("what the engine learns", () => {
  // Monthly spending for each whole calendar month of history.
  function monthTotals(g: GeneratedPersona): number[] {
    const d = g.sim.lastDecision!;
    const totals = new Map<string, number>();
    for (const t of g.txns) {
      if (d.classes[t.id] !== "expense") continue;
      totals.set(t.date.slice(0, 7), (totals.get(t.date.slice(0, 7)) ?? 0) - t.amountCents);
    }
    const first = g.start.slice(0, 7);
    const last = g.end.slice(0, 7);
    return [...totals].filter(([m]) => m !== first && m !== last).map(([, v]) => v);
  }

  it.each(["jemaya", "jordan"] as const)("gives %s an expense range that brackets real months", (key) => {
    const p = gp[key].sim.lastDecision!.profile;
    expect(p.expenseLowCents).toBeLessThan(p.expenseHighCents);
    const months = monthTotals(gp[key]);
    const inside = months.filter((m) => m >= p.expenseLowCents * 0.85 && m <= p.expenseHighCents * 1.15);
    expect(inside.length / months.length).toBeGreaterThanOrEqual(0.6);
  });

  it("puts the personas in their spending ranges from the PRD", () => {
    const jemaya = gp.jemaya.sim.lastDecision!.profile;
    const jordan = gp.jordan.sim.lastDecision!.profile;
    const ada = gp.ada.sim.lastDecision!.profile;
    expect(jemaya.expenseLowCents).toBeGreaterThan(2_300_00);
    expect(jemaya.expenseHighCents).toBeLessThan(3_000_00);
    expect(jordan.expenseLowCents).toBeGreaterThan(2_600_00);
    expect(jordan.expenseHighCents).toBeLessThan(3_400_00);
    expect(ada.expenseLowCents).toBeGreaterThan(3_000_00);
    expect(ada.expenseHighCents).toBeLessThan(3_900_00);
  });

  it("detects rent with its due day for Jemaya and Jordan", () => {
    const jemayaRent = gp.jemaya.sim.lastDecision!.profile.bills.find((b) => b.payee === "PARKSIDE APTS RENT");
    const jordanRent = gp.jordan.sim.lastDecision!.profile.bills.find((b) => b.payee === "WESTWOOD LOFTS RENT");
    expect(jemayaRent).toMatchObject({ amountCents: 1_150_00, dayOfMonth: 1, kind: "expense" });
    expect(jordanRent).toMatchObject({ amountCents: 1_400_00, dayOfMonth: 1, kind: "expense" });
  });

  it("treats a card payment from checking as a cash bill, not spending", () => {
    const p = gp.jordan.sim.lastDecision!.profile;
    const card = p.bills.find((b) => b.kind === "card_payment");
    expect(card?.payee).toBe("CAPITAL ONE MOBILE PMT");
    const expenseBills = p.bills.filter((b) => b.kind === "expense").reduce((s, b) => s + b.amountCents, 0);
    expect(p.monthlyBillsCents).toBe(expenseBills);
  });

  it("learns a weekly rhythm that sums to one month", () => {
    for (const key of ["jemaya", "jordan", "ada", "tee"] as const) {
      const sum = gp[key].sim.lastDecision!.profile.rhythm.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

describe("persona stories", () => {
  it("Jemaya starts the pitch Steady, with history that shows both clocks working", () => {
    expect(gp.jemaya.sim.lastDecision!.status).toBe("steady");
    expect(gp.jemaya.sim.moves.some((m) => m.direction === "buffer" && m.state === "settled")).toBe(true);
    expect(gp.jemaya.sim.moves.some((m) => m.direction === "release")).toBe(true);
    expect(gp.jemaya.sim.vaultCents).toBeGreaterThan(0);
  });

  it.each(["2026-10-21", "2026-11-05", "2026-12-14"])("never releases in Jordan's rent week (history ending %s)", (today) => {
    const g = today === TODAY ? gp.jordan : generatePersona("jordan", today);
    const rentDays = g.sim.lastDecision!.profile.bills.filter((b) => b.payee === "WESTWOOD LOFTS RENT");
    expect(rentDays).toHaveLength(1);
    const releases = g.sim.moves.filter((m) => m.direction === "release");
    expect(releases).toEqual([]);
  });

  it("Jordan's rent week alone does not trigger a release", () => {
    // Run the fast check on every day of the week before rent, on Jordan's real balance.
    const g = generatePersona("jordan", "2026-11-28");
    const sim = replayHistory(g);
    for (let i = 0; i < 4; i++) {
      sim.advance(1);
      expect(sim.lastDecision!.actions.filter((a) => a.type === "release")).toEqual([]);
    }
    expect(billsDueCents(sim.lastDecision!.profile.bills, sim.today, 7)).toBeGreaterThanOrEqual(1_400_00);
  });

  it("Tee gets no buffers and a plain explanation", () => {
    expect(gp.tee.sim.moves.filter((m) => m.direction === "buffer")).toEqual([]);
    const sim = replayHistory(gp.tee);
    const d = sim.run({ forceFast: true, forceFeast: true });
    expect(d.profile.hasMargin).toBe(false);
    expect(d.actions.some((a) => a.type === "no_margin")).toBe(true);
    expect(d.actions.some((a) => a.type === "buffer")).toBe(false);
  });
});

describe("the four demo events", () => {
  it("Big client pays: the feast check plans a buffer and asks nothing", () => {
    const sim = replayHistory(gp.jemaya);
    const d = inject(sim, "big_client");
    const buffer = d.actions.find((a) => a.type === "buffer");
    // The payment is sized from her spending so the pitch shows exactly $650.00.
    expect(buffer).toMatchObject({ amountCents: 650_00, limitedBy: "surplus" });
    expect(d.actions.some((a) => a.type === "jump_prompt")).toBe(false);
    expect(d.status).toBe("feast");

    // It is only announced today and settles tomorrow.
    const vaultBefore = sim.vaultCents;
    expect(sim.moves.at(-1)!.state).toBe("announced");
    sim.advance(1);
    expect(sim.moves.find((m) => m.amountCents === buffer!.amountCents && m.direction === "buffer")!.state).toBe("settled");
    expect(sim.vaultCents).toBe(vaultBefore + buffer!.amountCents);
  });

  it("STOP cancels the announced buffer", () => {
    const sim = replayHistory(gp.jemaya);
    inject(sim, "big_client");
    const move = sim.moves.at(-1)!;
    const vaultBefore = sim.vaultCents;
    sim.stop(move.id);
    sim.advance(1);
    expect(move.state).toBe("cancelled");
    expect(sim.vaultCents).toBe(vaultBefore);
  });

  it("Slow week: releases right away and never leaves checking under bills plus the floor", () => {
    const sim = replayHistory(gp.jemaya);
    inject(sim, "big_client");
    sim.advance(1);
    inject(sim, "slow_week");
    const days = sim.advance(7);
    const releaseDay = days.findIndex((d) => d.actions.some((a) => a.type === "release"));
    expect(releaseDay).toBeGreaterThanOrEqual(0);
    const release = days[releaseDay].actions.find((a) => a.type === "release")!;
    expect(release.amountCents).toBeGreaterThanOrEqual(100_00);
    // Released money is in checking the same day, and covers this week.
    const day = addDays(sim.today, releaseDay - 6);
    const bills7 = billsDueCents(days[releaseDay].profile.bills, day, 7);
    expect(sim.checkingOn(day)).toBeGreaterThanOrEqual(bills7 + ENGINE.floorCents);
    expect(sim.moves.find((m) => m.direction === "release" && m.date === day)!.state).toBe("settled");
  });

  it("New source: asks once, and the answer sticks for later credits", () => {
    const sim = replayHistory(gp.jemaya);
    const first = inject(sim, "new_source");
    const prompts = first.actions.filter((a) => a.type === "mystery_prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ sourceKey: "ZELLE FROM K JONES", amountCents: 300_00 });

    // Asking again on the next run would be a second prompt. There is none.
    expect(sim.run({ forceFast: true }).actions.some((a) => a.type === "mystery_prompt")).toBe(false);

    sim.answer(sim.prompts.at(-1)!.id, "YES");
    sim.advance(3);
    inject(sim, "new_source");
    const d = sim.lastDecision!;
    const later = sim.txns.filter((t) => t.name === "ZELLE FROM K JONES");
    expect(later).toHaveLength(2);
    for (const t of later) expect(d.classes[t.id]).toBe("income");
    expect(d.actions.some((a) => a.type === "mystery_prompt")).toBe(false);
  });

  it("Huge jump: buffers only a typical amount and asks PAUSE or KEEP", () => {
    const sim = replayHistory(gp.jemaya);
    const d = inject(sim, "huge_jump");
    const buffer = d.actions.find((a) => a.type === "buffer");
    const prompt = d.actions.find((a) => a.type === "jump_prompt");
    const p = d.profile;
    const typicalFeast = p.feast3wIncomeCents - Math.round((3 / ENGINE.weeksPerMonth) * p.expenseHighCents);
    expect(buffer).toBeDefined();
    expect(buffer!.amountCents).toBeLessThanOrEqual(typicalFeast);
    expect(prompt).toMatchObject({ depositCents: 12_000_00 });
    expect(prompt!.heldCents).toBeGreaterThan(0);
    // While the prompt is open the feast check waits.
    expect(sim.run({ forceFeast: true }).ran.feast).toBe(false);
  });

  it("Huge jump: no answer in 48 hours keeps buffering at the typical size", () => {
    const sim = replayHistory(gp.jemaya);
    inject(sim, "huge_jump");
    sim.advance(2);
    const prompt = sim.prompts.find((p) => p.kind === "jump")!;
    expect(prompt.answer).toBe("DEFAULT");
    expect(sim.pausedUntil).toBeNull();
    expect(sim.moves.filter((m) => m.reason === "jump_keep")).toEqual([]);
  });

  it("Huge jump: PAUSE stops buffering for 3 months, releases still run", () => {
    const sim = replayHistory(gp.jemaya);
    inject(sim, "huge_jump");
    sim.answer(sim.prompts.at(-1)!.id, "PAUSE");
    expect(sim.pausedUntil).toBe(addMonths(sim.today, 3));
    sim.advance(1);
    sim.inject([{ accountId: sim.homeBaseId, date: sim.today, amountCents: 5_000_00, name: "STRIPE TRANSFER ACME STUDIO" }]);
    const d = sim.run({ forceFeast: true });
    expect(d.actions).toContainEqual(expect.objectContaining({ type: "buffer_skipped", reason: "paused" }));
  });

  it("Huge jump: KEEP buffers the held part too", () => {
    const sim = replayHistory(gp.jemaya);
    const d = inject(sim, "huge_jump");
    const held = d.actions.find((a) => a.type === "jump_prompt")!.heldCents;
    sim.answer(sim.prompts.at(-1)!.id, "KEEP");
    expect(sim.moves.at(-1)).toMatchObject({ direction: "buffer", amountCents: held, state: "announced", reason: "jump_keep" });
  });
});

// A plain synthetic user for the money rules: weekly pay, steady spending, rent.
function synthetic(opts: { weeklyPayCents: number; checkingCents: number; days?: number }) {
  const today = "2026-06-15";
  const accounts: EngineAccount[] = [{ id: "chk", kind: "checking", isHomeBase: true }];
  const txns: Txn[] = [];
  const days = opts.days ?? 120;
  let n = 0;
  for (let i = days; i >= 0; i--) {
    const date = addDays(today, -i);
    if (i % 7 === 0) txns.push({ id: `t${n++}`, accountId: "chk", date, amountCents: opts.weeklyPayCents, name: "PAYROLL ACME CO", pending: false });
    if (i % 2 === 0) txns.push({ id: `t${n++}`, accountId: "chk", date, amountCents: -40_00, name: "KROGER #1", pending: false });
    if (date.endsWith("-01")) txns.push({ id: `t${n++}`, accountId: "chk", date, amountCents: -1_000_00, name: "OAK RENT", pending: false });
  }
  const state: UserState = {
    accounts,
    sourceTags: {},
    promptedSources: [],
    promptAfter: today,
    vaultBalanceCents: 1_000_00,
    frozen: false,
    pausedUntil: null,
    homeBasePendingUntil: null,
    lastFastCheck: addDays(today, -1),
    lastFeastCheck: addDays(today, -21),
    dailyLimitCents: ENGINE.dailyLimitCents,
    bufferedTodayCents: 0,
    recentMoves: [],
    openJumpPrompt: false,
  };
  return { state, txns, today, balances: { checkingCents: opts.checkingCents } };
}

describe("money rules", () => {
  it("buffers the surplus when checking is healthy", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 6_000_00 });
    const d = decide(s.state, s.txns, s.balances, s.today);
    const buffer = d.actions.find((a) => a.type === "buffer");
    expect(buffer).toMatchObject({ limitedBy: "surplus", shrunk: false });
  });

  it("shrinks a buffer that would break the safety rule", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 1_900_00 });
    const d = decide(s.state, s.txns, s.balances, s.today);
    const buffer = d.actions.find((a) => a.type === "buffer");
    expect(buffer).toMatchObject({ shrunk: true, limitedBy: "safety" });
    const bills = billsDueCents(d.profile.bills, s.today, ENGINE.safetyWindowDays);
    expect(s.balances.checkingCents - buffer!.amountCents).toBeGreaterThanOrEqual(bills + ENGINE.floorCents);
  });

  it("skips a buffer when checking cannot spare it, and says why", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 1_150_00 });
    const d = decide(s.state, s.txns, s.balances, s.today);
    expect(d.actions).toContainEqual(expect.objectContaining({ type: "buffer_skipped", reason: "safety" }));
  });

  it("respects the daily limit, including what already moved today", () => {
    const s = synthetic({ weeklyPayCents: 3_000_00, checkingCents: 20_000_00 });
    s.state.bufferedTodayCents = 2_000_00;
    const d = decide(s.state, s.txns, s.balances, s.today);
    const buffer = d.actions.find((a) => a.type === "buffer");
    expect(buffer!.amountCents).toBeLessThanOrEqual(500_00);
  });

  it("releases everything when the vault is short and says how short", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 50_00 });
    s.state.vaultBalanceCents = 100_00;
    const d = decide(s.state, s.txns, s.balances, s.today, { forceFast: true });
    const release = d.actions.find((a) => a.type === "release");
    expect(release).toMatchObject({ amountCents: 100_00 });
    expect(release!.shortByCents).toBeGreaterThan(0);
  });

  it("freeze stops moves in both directions", () => {
    const low = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 50_00 });
    low.state.frozen = true;
    const d1 = decide(low.state, low.txns, low.balances, low.today, { forceFast: true });
    expect(d1.actions.map((a) => a.type)).toEqual(["release_blocked"]);

    const high = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 6_000_00 });
    high.state.frozen = true;
    const d2 = decide(high.state, high.txns, high.balances, high.today);
    expect(d2.actions).toContainEqual(expect.objectContaining({ type: "buffer_skipped", reason: "frozen" }));
  });

  it("a pending home base change blocks buffers but not releases", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 6_000_00 });
    s.state.homeBasePendingUntil = addDays(s.today, 2);
    const d = decide(s.state, s.txns, s.balances, s.today);
    expect(d.actions).toContainEqual(expect.objectContaining({ type: "buffer_skipped", reason: "home_base_pending" }));
  });

  it("never reads the same income twice", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 6_000_00 });
    const first = decide(s.state, s.txns, s.balances, s.today, { forceFeast: true });
    expect(first.actions.some((a) => a.type === "buffer")).toBe(true);
    s.state.lastFeastCheck = s.today;
    const again = decide(s.state, s.txns, s.balances, s.today, { forceFeast: true });
    expect(again.actions.some((a) => a.type === "buffer")).toBe(false);
  });

  it("learn only mode plans nothing", () => {
    const s = synthetic({ weeklyPayCents: 1_100_00, checkingCents: 50_00 });
    const d = decide(s.state, s.txns, s.balances, s.today, { learnOnly: true, forceFast: true, forceFeast: true });
    expect(d.actions).toEqual([]);
    expect(d.profile.ready).toBe(true);
  });

  it("a buffer cancels at settle if the safety rule fails by then", () => {
    const sim = replayHistory(gp.jemaya);
    inject(sim, "big_client");
    const move = sim.moves.at(-1)!;
    sim.inject([{ accountId: sim.homeBaseId, date: addDays(sim.today, 1), amountCents: -4_000_00, name: "MIDAS AUTO 2231" }]);
    sim.advance(1);
    expect(move.state).toBe("cancelled");
    expect(daysBetween(move.date, sim.today)).toBe(1);
  });
});

describe("home base name match", async () => {
  const { namesMatch } = await import("@/lib/names");
  it("matches across case, middle names, and punctuation", () => {
    expect(namesMatch("Jemaya Brooks", ["JEMAYA A BROOKS"])).toBe(true);
    expect(namesMatch("Ada Okafor", ["Okafor, Ada N."])).toBe(true);
    expect(namesMatch("Jemaya Brooks", ["Jordan Ellis", "jemaya brooks"])).toBe(true);
  });
  it("blocks a different person", () => {
    expect(namesMatch("Jemaya Brooks", ["Jordan Ellis"])).toBe(false);
    expect(namesMatch("Jemaya Brooks", ["Jemaya Ellis"])).toBe(false);
    expect(namesMatch("", ["Jemaya Brooks"])).toBe(false);
    expect(namesMatch("Jemaya Brooks", [])).toBe(false);
  });
});
