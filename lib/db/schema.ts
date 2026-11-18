import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Money is always integer cents. Every table has created_at. Dates that follow
// the demo clock are plain `date` columns; real wall clock moments are timestamps.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const day = (name: string) => date(name, { mode: "string" });
const stamp = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Auth.js columns
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: stamp("email_verified"),
  image: text("image"),
  // Stabl
  legalName: text("legal_name"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  kycStatus: text("kyc_status", { enum: ["none", "verified_mock"] }).notNull().default("none"),
  earnType: text("earn_type", { enum: ["freelance", "commission", "own_business", "mix"] }),
  payFrequency: text("pay_frequency"),
  isDemo: boolean("is_demo").notNull().default(false),
  personaKey: text("persona_key"),
  rulesSignedAt: stamp("rules_signed_at"),
  rulesSignedName: text("rules_signed_name"),
  rulesVersion: text("rules_version"),
  onboardingStep: integer("onboarding_step").notNull().default(2),
  // Demo clock: days added to real time for this user. Only the admin moves it.
  clockOffsetDays: integer("clock_offset_days").notNull().default(0),
  dailyLimitCents: integer("daily_limit_cents").notNull().default(2_500_00),
  // New mystery credits dated on or after this day get a prompt.
  promptAfter: day("prompt_after"),
  homeBasePendingAccountId: uuid("home_base_pending_account_id"),
  homeBasePendingUntil: stamp("home_base_pending_until"),
  createdAt: createdAt(),
});

export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().unique(),
  // Null only for local demo Items, which never talk to Plaid.
  accessTokenEnc: text("access_token_enc"),
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull(),
  status: text("status", { enum: ["active", "login_required", "pending_disconnect", "revoked"] })
    .notNull()
    .default("active"),
  syncCursor: text("sync_cursor"),
  env: text("env", { enum: ["sandbox", "production", "local"] }).notNull(),
  lastSyncedAt: stamp("last_synced_at"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => plaidItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plaidAccountId: text("plaid_account_id").notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    // Last 4 only. Full account numbers are never stored.
    mask: text("mask"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    ownerNames: jsonb("owner_names").$type<string[]>().notNull().default([]),
    isHomeBase: boolean("is_home_base").notNull().default(false),
    // Balance anchor: the bank's balance on `balance_as_of`. Later transactions in
    // Stabl adjust it (see lib/balances).
    balanceCents: integer("balance_cents"),
    balanceAsOf: day("balance_as_of"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("accounts_item_plaid_unique").on(t.itemId, t.plaidAccountId),
    unique("accounts_id_user_unique").on(t.id, t.userId),
    uniqueIndex("accounts_one_home_base").on(t.userId).where(sql`${t.isHomeBase}`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plaidTxnId: text("plaid_txn_id").unique(),
    date: day("date").notNull(),
    // Stabl sign: positive is money in.
    amountCents: integer("amount_cents").notNull(),
    name: text("name").notNull(),
    merchant: text("merchant"),
    pending: boolean("pending").notNull().default(false),
    sourceKey: text("source_key").notNull(),
    class: text("class", { enum: ["income", "expense", "internal", "vault", "mystery", "not_income"] }),
    // Where the row came from: a Plaid sync, a demo injection, the mirror of a
    // vault move, or a local seed without Plaid.
    origin: text("origin", { enum: ["plaid", "demo_inject", "vault_mirror", "local_seed"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("transactions_user_date").on(t.userId, t.date)],
);

export const sourceTags = pgTable(
  "source_tags",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    tag: text("tag", { enum: ["income", "not_income"] }).notNull(),
    setBy: text("set_by", { enum: ["user", "engine"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceKey] })],
);

export const bills = pgTable("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  payee: text("payee").notNull(),
  amountCents: integer("amount_cents").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  lastSeen: day("last_seen").notNull(),
  nextDue: day("next_due").notNull(),
  cadence: text("cadence").notNull().default("monthly"),
  kind: text("kind", { enum: ["expense", "card_payment"] }).notNull().default("expense"),
  source: text("source", { enum: ["engine", "plaid_recurring"] }).notNull().default("engine"),
  createdAt: createdAt(),
});

export const engineProfiles = pgTable("engine_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  ready: boolean("ready").notNull().default(false),
  expenseLowCents: integer("expense_low_cents").notNull().default(0),
  expenseHighCents: integer("expense_high_cents").notNull().default(0),
  rhythmJson: jsonb("rhythm_json").$type<[number, number, number, number]>(),
  typical3wIncomeCents: integer("typical_3w_income_cents").notNull().default(0),
  feast3wIncomeCents: integer("feast_3w_income_cents").notNull().default(0),
  avgMonthlyIncomeCents: integer("avg_monthly_income_cents").notNull().default(0),
  monthlyBillsCents: integer("monthly_bills_cents").notNull().default(0),
  checkingShare: real("checking_share").notNull().default(1),
  hasMargin: boolean("has_margin").notNull().default(true),
  status: text("status", { enum: ["feast", "steady", "fast"] }).notNull().default("steady"),
  needCents: integer("need_cents").notNull().default(0),
  lastFastCheck: day("last_fast_check"),
  lastFeastCheck: day("last_feast_check"),
  pausedUntil: day("paused_until"),
  noMarginNotifiedAt: stamp("no_margin_notified_at"),
  learnedAt: stamp("learned_at"),
  createdAt: createdAt(),
});

export const vaultAccounts = pgTable(
  "vault_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    partnerLabel: text("partner_label").notNull(),
    mask: text("mask").notNull(),
    status: text("status", { enum: ["locked", "frozen"] }).notNull().default("locked"),
    openedAt: stamp("opened_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("vault_accounts_id_user_unique").on(t.id, t.userId)],
);

export const moves = pgTable(
  "moves",
  {
    // The moveId. Every vault call carries it, so a retry never moves money twice.
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id").notNull(),
    homeBaseAccountId: uuid("home_base_account_id").notNull(),
    direction: text("direction", { enum: ["buffer", "release", "emergency"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    // "settling" is the Arc build only: the transaction is sent and the move
    // waits for the vault contract's event before the ledger is written.
    state: text("state", { enum: ["planned", "announced", "settling", "settled", "cancelled"] }).notNull(),
    reason: text("reason").notNull(),
    cancelReason: text("cancel_reason"),
    // Demo clock dates
    plannedFor: day("planned_for").notNull(),
    settleOn: day("settle_on").notNull(),
    settledAt: stamp("settled_at"),
    // On Arc: Circle's id for the transaction, then where it landed and what
    // told us (the QuickNode Stream, or the fallback that reads Arc directly).
    chainTxId: text("chain_tx_id"),
    submittedAt: stamp("submitted_at"),
    txHash: text("tx_hash"),
    chainBlock: bigint("chain_block", { mode: "number" }),
    confirmedBy: text("confirmed_by", { enum: ["stream", "backfill", "reconcile"] }),
    // Details the receipt needs once the move settles.
    metaJson: jsonb("meta_json").$type<{ shortByCents?: number }>(),
    // What follows a settled move, one step at a time, so a step that fails is
    // retried later instead of lost: the bank side, the receipt, and on Arc the
    // USDC going back to the bank side after a release.
    followUpsJson: jsonb("follow_ups_json").$type<{ mirror?: boolean; receipt?: boolean; offramp?: boolean }>(),
    followUpsClaimedAt: stamp("follow_ups_claimed_at"),
    followUpsDoneAt: stamp("follow_ups_done_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("moves_amount_positive", sql`${t.amountCents} > 0`),
    // The closed loop: the vault and the home base account must both belong to
    // the user on the move. Enforced by the database, not only the server.
    foreignKey({
      name: "moves_vault_same_user",
      columns: [t.vaultId, t.userId],
      foreignColumns: [vaultAccounts.id, vaultAccounts.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "moves_home_base_same_user",
      columns: [t.homeBaseAccountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
    index("moves_user_state").on(t.userId, t.state),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaultAccounts.id, { onDelete: "cascade" }),
    // One entry per move: the unique key is what makes vault calls idempotent.
    moveId: uuid("move_id")
      .unique()
      .references(() => moves.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["buffer", "release", "emergency", "interest"] }).notNull(),
    // Signed: into the vault is positive.
    amountCents: integer("amount_cents").notNull(),
    entryDate: day("entry_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ledger_interest_once_a_day").on(t.vaultId, t.entryDate).where(sql`${t.kind} = 'interest'`),
    check("ledger_move_or_interest", sql`(${t.kind} = 'interest') = (${t.moveId} is null)`),
  ],
);

// Balance is never stored; it is the sum of the ledger. Created in a custom
// migration alongside the insert only trigger.
export const vaultBalances = pgView("vault_balances", {
  vaultId: uuid("vault_id").notNull(),
  balanceCents: integer("balance_cents").notNull(),
}).existing();

// Arc build: the wallet that owns each person's vault on chain.
//   circle   a Circle developer-controlled smart account. Stabl signs for it.
//   passkey  a Circle modular smart account whose only signer is a passkey on
//            the person's device. Stabl cannot sign for it at all.
export const chainWallets = pgTable("chain_wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["circle", "passkey"] }).notNull().default("circle"),
  // Set for circle wallets only.
  circleWalletId: text("circle_wallet_id").unique(),
  // The Stabl-managed wallet a passkey wallet replaced, kept for the record.
  previousAddress: text("previous_address"),
  previousCircleWalletId: text("previous_circle_wallet_id"),
  passkeyAt: stamp("passkey_at"),
  // Lower case, so lookups by event owner are exact.
  address: text("address").notNull().unique(),
  blockchain: text("blockchain").notNull(),
  createdAt: createdAt(),
});

// Every vault contract event the app has acted on, once. The unique key is what
// makes a repeated webhook delivery harmless.
export const chainEvents = pgTable(
  "chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    name: text("name", { enum: ["Deposited", "Released", "EmergencyUnlocked", "Frozen", "Unfrozen"] }).notNull(),
    owner: text("owner").notNull(),
    // USDC's smallest unit, as text because it can exceed a JS integer.
    units: text("units"),
    ref: text("ref"),
    balanceUnits: text("balance_units"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    moveId: uuid("move_id").references(() => moves.id, { onDelete: "set null" }),
    // stream: the live QuickNode Stream. backfill: a QuickNode Stream replaying
    // history. reconcile: the fallback that reads Arc directly.
    source: text("source", { enum: ["stream", "backfill", "reconcile"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("chain_events_tx_log_unique").on(t.txHash, t.logIndex), index("chain_events_user").on(t.userId, t.createdAt)],
);

// On chain work that is not a move: carrying an opening balance onto Arc,
// freezing, unfreezing, and sending released USDC back to the bank side.
export const chainOps = pgTable(
  "chain_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["opening", "freeze", "unfreeze", "offramp", "close", "passkey_out", "passkey_return", "passkey_in"] }).notNull(),
    // For offramp: the move whose release is being sent back.
    moveId: uuid("move_id").references(() => moves.id, { onDelete: "cascade" }),
    units: text("units"),
    chainTxId: text("chain_tx_id"),
    txHash: text("tx_hash"),
    state: text("state", { enum: ["sent", "landed", "failed"] }).notNull().default("sent"),
    createdAt: createdAt(),
  },
  (t) => [index("chain_ops_user").on(t.userId, t.createdAt)],
);

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["mystery", "jump"] }).notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  answer: text("answer"),
  answeredAt: stamp("answered_at"),
  expiresAt: stamp("expires_at"),
  createdAt: createdAt(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    template: text("template").notNull(),
    body: text("body").notNull(),
    channelsSent: jsonb("channels_sent").$type<string[]>().notNull().default([]),
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    moveId: uuid("move_id").references(() => moves.id, { onDelete: "set null" }),
    // Who wrote it: Stabl, or the user typing a command in the thread.
    fromUser: boolean("from_user").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("messages_user_created").on(t.userId, t.createdAt)],
);

export const channels = pgTable("channels", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pushSubscriptionJson: jsonb("push_subscription_json").$type<PushSubscriptionJSON | null>(),
  telegramChatId: text("telegram_chat_id"),
  telegramLinkToken: text("telegram_link_token"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  quietHours: boolean("quiet_hours").notNull().default(true),
  // A new phone or Telegram account locks emergency unlocks for 72 hours.
  emergencyLockedUntil: stamp("emergency_locked_until"),
  createdAt: createdAt(),
});

export type PushSubscriptionJSON = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };

export const codes = pgTable("codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["emergency", "unfreeze", "demo_login", "passkey"] }).notNull(),
  codeHash: text("code_hash").notNull(),
  // Where the code was sent, so it never goes back to the channel that asked.
  sentTo: jsonb("sent_to").$type<string[]>().notNull().default([]),
  notBefore: stamp("not_before"),
  expiresAt: stamp("expires_at").notNull(),
  usedAt: stamp("used_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor", { enum: ["user", "engine", "admin"] }).notNull(),
    action: text("action").notNull(),
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_user_created").on(t.userId, t.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: stamp("window_start").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: createdAt(),
});
