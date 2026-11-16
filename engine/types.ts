import type { ISODate } from "./dates";

// Sign convention inside Stabl: positive cents is money coming in, negative is
// money going out. Plaid uses the opposite sign; lib/plaid converts at the edge.
export type Txn = {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: number;
  name: string;
  pending: boolean;
};

export type AccountKind = "checking" | "savings" | "credit" | "other";

export type EngineAccount = {
  id: string;
  kind: AccountKind;
  isHomeBase: boolean;
};

export type SourceTag = "income" | "not_income";

export type TxnClass = "income" | "expense" | "internal" | "vault" | "mystery" | "not_income";

export type Bill = {
  payee: string;
  amountCents: number;
  dayOfMonth: number;
  lastSeen: ISODate;
  nextDue: ISODate;
  cadence: "monthly";
  // card_payment: paying off a connected card. Cash leaves checking, but it is
  // not spending, so it never counts toward the expense range.
  kind: "expense" | "card_payment";
};

export type MoveSummary = {
  direction: "buffer" | "release" | "emergency";
  amountCents: number;
  state: "planned" | "announced" | "settled" | "cancelled";
  date: ISODate;
};

export type UserState = {
  accounts: EngineAccount[];
  sourceTags: Record<string, SourceTag>;
  // Sources the user was already asked about, answered or not.
  promptedSources: string[];
  // Credits from new sources dated on or after this day get a prompt. Earlier
  // ones are shown on the onboarding summary instead.
  promptAfter: ISODate | null;
  vaultBalanceCents: number;
  frozen: boolean;
  pausedUntil: ISODate | null;
  homeBasePendingUntil: ISODate | null;
  lastFastCheck: ISODate | null;
  lastFeastCheck: ISODate | null;
  dailyLimitCents: number;
  // Buffers already moved today, so the daily limit holds across runs.
  bufferedTodayCents: number;
  // Recent moves: announced buffers still leave checking, and the status reads them.
  recentMoves: MoveSummary[];
  // An unusual jump prompt is waiting for PAUSE or KEEP. The feast check waits too.
  openJumpPrompt: boolean;
  // Bills Plaid already knows about (/transactions/recurring/get). They fill in
  // for payees the engine has not seen often enough to detect yet.
  externalBills?: Bill[];
};

export type Balances = {
  // Home base checking, as close to live as the caller can get.
  checkingCents: number;
};

export type LearnedProfile = {
  ready: boolean;
  historyDays: number;
  expenseLowCents: number;
  expenseHighCents: number;
  rhythm: [number, number, number, number];
  typical3wIncomeCents: number;
  feast3wIncomeCents: number;
  avgMonthlyIncomeCents: number;
  monthlyBillsCents: number;
  checkingShare: number;
  hasMargin: boolean;
  bills: Bill[];
};

export type ReleaseReason = "fast_check" | "unusual_drop" | "low_balance";

export type Action =
  | {
      type: "release";
      amountCents: number;
      gapCents: number;
      shortByCents: number;
      reason: ReleaseReason;
    }
  | { type: "release_blocked"; gapCents: number; reason: "frozen" | "vault_empty" }
  | {
      type: "buffer";
      amountCents: number;
      surplusCents: number;
      shrunk: boolean;
      limitedBy: "surplus" | "safety" | "daily_limit" | "typical_feast";
    }
  | {
      type: "buffer_skipped";
      surplusCents: number;
      reason: "safety" | "paused" | "frozen" | "home_base_pending" | "daily_limit" | "below_minimum";
    }
  | { type: "jump_prompt"; depositCents: number; incomeCents: number; bufferCents: number; heldCents: number }
  | { type: "mystery_prompt"; sourceKey: string; txnId: string; amountCents: number; name: string }
  | { type: "no_margin" };

export type Status = "feast" | "steady" | "fast";

export type DecideOptions = {
  forceFast?: boolean;
  forceFeast?: boolean;
  // Learn only: no moves and no prompts. Used by onboarding step 7.
  learnOnly?: boolean;
};

export type Decision = {
  profile: LearnedProfile;
  classes: Record<string, TxnClass>;
  sourceKeys: Record<string, string>;
  engineTags: { sourceKey: string; tag: SourceTag }[];
  mysteryCredits: { txnId: string; sourceKey: string; amountCents: number; name: string; date: ISODate }[];
  status: Status;
  ran: { fast: boolean; feast: boolean };
  needCents: number;
  actions: Action[];
};
