import { ENGINE, VAULT } from "./config";
import { addDays, addMonths, daysBetween, type ISODate } from "./dates";
import { decide } from "./decide";
import { settleCheck } from "./settle";
import type { Action, DecideOptions, Decision, EngineAccount, MoveSummary, SourceTag, Txn, UserState } from "./types";

export type SimMove = MoveSummary & { id: string; settledOn: ISODate | null; reason: string };

export type SimPrompt = {
  id: string;
  kind: "jump" | "mystery";
  createdOn: ISODate;
  expiresOn: ISODate | null;
  sourceKey?: string;
  heldCents: number;
  answer: "PAUSE" | "KEEP" | "YES" | "NO" | "DEFAULT" | null;
};

// Runs the engine day by day against an in memory bank and vault. The persona
// generator uses it to give demo users a believable history, and the tests use it
// to replay the pitch script without a database.
export class Simulator {
  txns: Txn[];
  moves: SimMove[] = [];
  prompts: SimPrompt[] = [];
  vaultCents = 0;
  sourceTags: Record<string, SourceTag> = {};
  lastFastCheck: ISODate | null = null;
  lastFeastCheck: ISODate | null = null;
  pausedUntil: ISODate | null = null;
  frozen = false;
  promptAfter: ISODate | null;
  lastDecision: Decision | null = null;
  private seq = 0;

  constructor(
    public accounts: EngineAccount[],
    txns: Txn[],
    // Home base balance before the first transaction in `txns`.
    public checkingStartCents: number,
    public today: ISODate,
  ) {
    this.txns = [...txns];
    this.promptAfter = today;
  }

  get homeBaseId(): string {
    const home = this.accounts.find((a) => a.isHomeBase);
    if (!home) throw new Error("Simulator needs a home base account");
    return home.id;
  }

  checkingOn(day: ISODate): number {
    return this.txns
      .filter((t) => t.accountId === this.homeBaseId && t.date <= day && !t.pending)
      .reduce((sum, t) => sum + t.amountCents, this.checkingStartCents);
  }

  inject(txns: Omit<Txn, "id" | "pending">[]) {
    for (const t of txns) this.txns.push({ ...t, id: `inj_${++this.seq}`, pending: false });
  }

  state(): UserState {
    const windowStart = addDays(this.today, -(ENGINE.feastWindowDays - 1));
    return {
      accounts: this.accounts,
      sourceTags: this.sourceTags,
      promptedSources: this.prompts.filter((p) => p.sourceKey).map((p) => p.sourceKey!),
      promptAfter: this.promptAfter,
      vaultBalanceCents: this.vaultCents,
      frozen: this.frozen,
      pausedUntil: this.pausedUntil,
      homeBasePendingUntil: null,
      lastFastCheck: this.lastFastCheck,
      lastFeastCheck: this.lastFeastCheck,
      dailyLimitCents: ENGINE.dailyLimitCents,
      bufferedTodayCents: this.moves
        .filter((m) => m.direction === "buffer" && m.date === this.today && m.state !== "cancelled")
        .reduce((sum, m) => sum + m.amountCents, 0),
      recentMoves: this.moves.filter((m) => m.date >= windowStart),
      openJumpPrompt: this.prompts.some((p) => p.kind === "jump" && p.answer === null),
    };
  }

  run(opts: DecideOptions = {}): Decision {
    const decision = decide(this.state(), this.txns, { checkingCents: this.checkingOn(this.today) }, this.today, opts);
    for (const tag of decision.engineTags) this.sourceTags[tag.sourceKey] ??= tag.tag;
    for (const action of decision.actions) this.apply(action);
    if (decision.ran.fast) this.lastFastCheck = this.today;
    if (decision.ran.feast) this.lastFeastCheck = this.today;
    this.lastDecision = decision;
    return decision;
  }

  // One calendar day: settle yesterday's buffers, expire prompts, run the engine.
  advance(days = 1): Decision[] {
    const out: Decision[] = [];
    for (let i = 0; i < days; i++) {
      this.today = addDays(this.today, 1);
      this.settleDue();
      this.expirePrompts();
      out.push(this.run());
    }
    return out;
  }

  answer(promptId: string, answer: "PAUSE" | "KEEP" | "YES" | "NO") {
    const prompt = this.prompts.find((p) => p.id === promptId);
    if (!prompt || prompt.answer) return;
    prompt.answer = answer;
    if (answer === "PAUSE") this.pausedUntil = addMonths(this.today, ENGINE.pauseMonths);
    if (answer === "KEEP" && prompt.heldCents >= ENGINE.minBufferCents) {
      this.moves.push(this.newMove("buffer", prompt.heldCents, "announced", "jump_keep"));
    }
    if (prompt.sourceKey && (answer === "YES" || answer === "NO")) {
      this.sourceTags[prompt.sourceKey] = answer === "YES" ? "income" : "not_income";
    }
  }

  stop(moveId: string) {
    const move = this.moves.find((m) => m.id === moveId && m.state === "announced");
    if (move) move.state = "cancelled";
  }

  private apply(action: Action) {
    if (action.type === "release") {
      this.vaultCents -= action.amountCents;
      const move = this.newMove("release", action.amountCents, "settled", action.reason);
      move.settledOn = this.today;
      this.moves.push(move);
      this.postTransfer(action.amountCents);
    } else if (action.type === "buffer") {
      this.moves.push(this.newMove("buffer", action.amountCents, "announced", action.limitedBy));
    } else if (action.type === "jump_prompt") {
      this.prompts.push({
        id: `p_${++this.seq}`,
        kind: "jump",
        createdOn: this.today,
        expiresOn: addDays(this.today, Math.ceil(ENGINE.jumpAnswerHours / 24)),
        heldCents: action.heldCents,
        answer: null,
      });
    } else if (action.type === "mystery_prompt") {
      this.prompts.push({
        id: `p_${++this.seq}`,
        kind: "mystery",
        createdOn: this.today,
        expiresOn: null,
        sourceKey: action.sourceKey,
        heldCents: 0,
        answer: null,
      });
    }
  }

  private settleDue() {
    const due = this.moves.filter((m) => m.direction === "buffer" && m.state === "announced" && daysBetween(m.date, this.today) >= 1);
    if (due.length === 0) return;
    // Bills learned from today's feed, so a bill that just posted is not still due.
    const bills = decide(this.state(), this.txns, { checkingCents: this.checkingOn(this.today) }, this.today, { learnOnly: true }).profile.bills;
    for (const move of due) {
      const check = settleCheck(move.amountCents, this.checkingOn(this.today), bills, this.today);
      if (!check.ok || this.frozen) {
        move.state = "cancelled";
        continue;
      }
      move.state = "settled";
      move.settledOn = this.today;
      this.vaultCents += move.amountCents;
      this.postTransfer(-move.amountCents);
    }
  }

  private expirePrompts() {
    for (const prompt of this.prompts) {
      if (prompt.kind === "jump" && prompt.answer === null && prompt.expiresOn && prompt.expiresOn <= this.today) {
        // No answer means keep buffering at the typical size: no pause, and the
        // held part stays in checking.
        prompt.answer = "DEFAULT";
      }
    }
  }

  private postTransfer(amountCents: number) {
    this.txns.push({
      id: `vault_${++this.seq}`,
      accountId: this.homeBaseId,
      date: this.today,
      amountCents,
      name: VAULT.vaultTransferName,
      pending: false,
    });
  }

  private newMove(direction: SimMove["direction"], amountCents: number, state: SimMove["state"], reason: string): SimMove {
    return { id: `m_${++this.seq}`, direction, amountCents, state, date: this.today, settledOn: null, reason };
  }
}
