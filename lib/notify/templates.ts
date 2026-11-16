import { formatCents } from "@/engine/money";

// Every message Stabl sends. Copy rules: plain words, short sentences, no emojis,
// no dashes as punctuation. Money always shows cents. tests/copy.test.ts checks
// all of this against every template.

type Rendered = {
  body: string;
  // Releases and security alerts break through quiet hours.
  urgent?: boolean;
  // Settled moves, security alerts, and summaries also go by email.
  email?: { subject: string };
  // Reply buttons in the thread and in Telegram. Each maps to a command.
  replies?: string[];
};

const money = formatCents;

const SKIP_REASONS = {
  safety: "moving money now would leave too little for bills due soon",
  daily_limit: "you already reached today's limit",
  frozen: "your vault is frozen",
  home_base_pending: "your home base change is still waiting",
  paused: "buffering is paused",
  stopped: "you asked us to stop",
  settle_failed: "checking dropped since yesterday and your bills come first",
  not_completed: "the transfer did not go through",
} as const;

export type SkipReason = keyof typeof SKIP_REASONS;

export const templates = {
  buffer_announced: (d: { amountCents: number; account: string; shrunk: boolean }): Rendered => ({
    body: d.shrunk
      ? `Stabl: Good stretch. Tomorrow we will move ${money(d.amountCents)} from ${d.account} to your vault. We kept it smaller so your bills stay covered. Reply STOP to skip it.`
      : `Stabl: Good stretch. Tomorrow we will move ${money(d.amountCents)} from ${d.account} to your vault. Your bills stay covered. Reply STOP to skip it.`,
    replies: ["STOP"],
  }),

  buffer_settled: (d: { amountCents: number; vaultCents: number; checkingCents: number }): Rendered => ({
    body: `Stabl: Moved ${money(d.amountCents)} to your vault. Vault ${money(d.vaultCents)}. Checking ${money(d.checkingCents)}.`,
    email: { subject: `Moved ${money(d.amountCents)} to your vault` },
  }),

  buffer_skipped: (d: { reason: SkipReason; amountCents?: number }): Rendered => ({
    body:
      d.amountCents && (d.reason === "stopped" || d.reason === "settle_failed" || d.reason === "not_completed")
        ? `Stabl: Skipped: ${SKIP_REASONS[d.reason]}, so the ${money(d.amountCents)} stays in checking.`
        : `Stabl: Skipped: ${SKIP_REASONS[d.reason]}. Nothing moved.`,
  }),

  release: (d: { amountCents: number; account: string; vaultCents: number; unusual: boolean }): Rendered => ({
    body: d.unusual
      ? `Stabl: Income came in well under normal this week, so we sent ${money(d.amountCents)} from your vault to ${d.account}. It is there now. Vault ${money(d.vaultCents)}.`
      : `Stabl: Slow week, so we sent ${money(d.amountCents)} from your vault to ${d.account}. It is there now. Vault ${money(d.vaultCents)}.`,
    urgent: true,
    email: { subject: `Sent ${money(d.amountCents)} to checking` },
  }),

  release_short: (d: { amountCents: number; shortByCents: number }): Rendered => ({
    body: `Stabl: We sent everything in your vault, ${money(d.amountCents)}. Checking is still about ${money(d.shortByCents)} short for this week's bills.`,
    urgent: true,
    email: { subject: `Sent ${money(d.amountCents)} to checking` },
  }),

  move_failed: (d: { amountCents: number }): Rendered => ({
    body: `Stabl: We could not send ${money(d.amountCents)} from your vault just now. Nothing left your vault. Try again in a moment.`,
    urgent: true,
  }),

  release_blocked: (d: { gapCents: number; reason: "frozen" | "vault_empty" }): Rendered => ({
    body:
      d.reason === "frozen"
        ? `Stabl: Checking looks about ${money(d.gapCents)} short this week, but your vault is frozen. Reply UNFREEZE to get a code.`
        : `Stabl: Checking looks about ${money(d.gapCents)} short this week, and your vault is empty, so there is nothing to send yet.`,
    urgent: true,
  }),

  mystery_credit: (d: { amountCents: number; name: string }): Rendered => ({
    body: `Stabl: ${money(d.amountCents)} came in from ${d.name}. Is this income? Reply YES or NO.`,
    replies: ["YES", "NO"],
  }),

  mystery_answered: (d: { name: string; income: boolean }): Rendered => ({
    body: d.income
      ? `Stabl: Thanks. Money from ${d.name} now counts as income.`
      : `Stabl: Thanks. Money from ${d.name} will not count as income.`,
  }),

  unusual_jump: (d: { depositCents: number; bufferCents: number }): Rendered => ({
    body:
      d.bufferCents > 0
        ? `Stabl: ${money(d.depositCents)} is much more than usual. We moved a normal amount, ${money(d.bufferCents)}. Pause buffering for 3 months while we relearn, or keep going? Reply PAUSE or KEEP.`
        : `Stabl: ${money(d.depositCents)} is much more than usual, so we have not moved any of it. Pause buffering for 3 months while we relearn, or keep going? Reply PAUSE or KEEP.`,
    replies: ["PAUSE", "KEEP"],
  }),

  jump_paused: (d: { until: string }): Rendered => ({
    body: `Stabl: Done. Buffering is paused until ${d.until}. If a week runs short, releases still go out.`,
  }),

  jump_kept: (d: { amountCents: number; account: string }): Rendered => ({
    body:
      d.amountCents > 0
        ? `Stabl: Got it. Tomorrow we will move ${money(d.amountCents)} more from ${d.account} to your vault. Reply STOP to skip it.`
        : "Stabl: Got it. We will keep buffering as usual.",
    replies: d.amountCents > 0 ? ["STOP"] : undefined,
  }),

  jump_default: (): Rendered => ({
    body: "Stabl: No answer, so we kept buffering at the usual size. The rest stays in checking.",
  }),

  no_margin: (): Rendered => ({
    body: "Stabl: Stabl works when your income covers your spending on average. Right now it does not, so we will not move money.",
  }),

  emergency_code: (d: { code: string; minutes: number; left: number }): Rendered => ({
    body: `Stabl: Emergency unlock requested. Your code is ${d.code} and it expires in ${d.minutes} minutes. You have ${d.left} emergency unlock${d.left === 1 ? "" : "s"} left this quarter.`,
    urgent: true,
    email: { subject: "Your emergency unlock code" },
  }),

  emergency_code_sent: (d: { where: string }): Rendered => ({
    body: `Stabl: Emergency unlock started. Your code is in ${d.where}. Enter it in the app with the amount you need.`,
    urgent: true,
  }),

  emergency_wait: (d: { opensAt: string }): Rendered => ({
    body: `Stabl: You have used 2 emergency unlocks in the last 90 days, so this one opens in 24 hours, at ${d.opensAt}. Freezing still works any time.`,
    urgent: true,
    email: { subject: "Emergency unlock opens in 24 hours" },
  }),

  emergency_locked: (d: { until: string }): Rendered => ({
    body: `Stabl: Emergency unlocks are paused until ${d.until} because a new phone or Telegram account was linked. Freezing still works any time.`,
    urgent: true,
    email: { subject: "Emergency unlocks are paused" },
  }),

  emergency_settled: (d: { amountCents: number; account: string; vaultCents: number }): Rendered => ({
    body: `Stabl: Emergency unlock done. We sent ${money(d.amountCents)} from your vault to ${d.account}. It is there now. Vault ${money(d.vaultCents)}.`,
    urgent: true,
    email: { subject: `Emergency unlock: sent ${money(d.amountCents)}` },
  }),

  frozen: (): Rendered => ({
    body: "Stabl: Everything is frozen. No money moves in or out of your vault until you unfreeze. Reply UNFREEZE to get a code.",
    urgent: true,
    email: { subject: "Your vault is frozen" },
  }),

  unfreeze_code: (d: { code: string; minutes: number }): Rendered => ({
    body: `Stabl: Your unfreeze code is ${d.code}. It expires in ${d.minutes} minutes.`,
    urgent: true,
    email: { subject: "Your unfreeze code" },
  }),

  unfreeze_code_sent: (d: { where: string }): Rendered => ({
    body: `Stabl: We sent an unfreeze code to ${d.where}. Reply UNFREEZE and the code, or enter it in the app.`,
    urgent: true,
  }),

  unfrozen: (): Rendered => ({
    body: "Stabl: Unfrozen. Stabl is watching your money again.",
    urgent: true,
    email: { subject: "Your vault is unfrozen" },
  }),

  home_base_change: (): Rendered => ({
    body: "Stabl: A request to change your home base was made. It takes effect in 72 hours. Not you? Reply FREEZE.",
    urgent: true,
    email: { subject: "Your home base is changing" },
    replies: ["FREEZE"],
  }),

  home_base_active: (d: { account: string }): Rendered => ({
    body: `Stabl: ${d.account} is your home base now.`,
    email: { subject: "Your home base changed" },
  }),

  connection_broken: (d: { institution: string }): Rendered => ({
    body: `Stabl: We lost access to ${d.institution}. Open the app to reconnect. Your vault is safe.`,
    urgent: true,
    email: { subject: `Reconnect ${d.institution}` },
  }),

  permission_revoked: (d: { institution: string }): Rendered => ({
    body: `Stabl: ${d.institution} stopped sharing data with Stabl, so we stopped using it. Your vault is safe.`,
    urgent: true,
    email: { subject: `${d.institution} disconnected` },
  }),

  balance: (d: { vaultCents: number; account: string; checkingCents: number }): Rendered => ({
    body: `Stabl: Vault ${money(d.vaultCents)}. ${d.account} ${money(d.checkingCents)}.`,
  }),

  help: (): Rendered => ({
    body: [
      "Stabl commands:",
      "BALANCE shows your vault and checking.",
      "STOP skips the move we told you about.",
      "YES or NO labels new money.",
      "PAUSE or KEEP answers an unusual jump.",
      "FREEZE stops every move at once.",
      "UNFREEZE sends a code to start again.",
      "EMERGENCY sends a code to unlock your vault today.",
    ].join("\n"),
  }),

  nothing_to_do: (d: { what: "stop" | "mystery" | "jump" | "frozen" }): Rendered => ({
    body: {
      stop: "Stabl: There is no move waiting, so there is nothing to stop.",
      mystery: "Stabl: There is no new money waiting for a label.",
      jump: "Stabl: There is no question waiting for PAUSE or KEEP.",
      frozen: "Stabl: Your vault is not frozen.",
    }[d.what],
  }),

  code_wrong: (): Rendered => ({ body: "Stabl: That code did not match or has expired. Ask for a new one." }),

  unknown: (): Rendered => ({ body: "Stabl: Sorry, we did not catch that. Reply HELP for the list." }),

  vault_ready: (d: { mask: string }): Rendered => ({
    body: `Stabl: Your vault ending in ${d.mask} is open. Every move will show up here first, and nothing happens without a message.`,
  }),

  telegram_linked: (): Rendered => ({
    body: "Stabl: Telegram is linked. You will get every receipt here too. Reply HELP for commands.",
  }),

  weekly_summary: (d: { incomeCents: number; spendCents: number; vaultCents: number; moves: number }): Rendered => ({
    body: `Stabl: Last week ${money(d.incomeCents)} came in and ${money(d.spendCents)} went out. Vault ${money(d.vaultCents)}. ${d.moves === 0 ? "No moves." : `${d.moves} move${d.moves === 1 ? "" : "s"}.`}`,
    email: { subject: "Your week with Stabl" },
  }),
} satisfies Record<string, (d: never) => Rendered>;

export type TemplateName = keyof typeof templates;
export type TemplateData<T extends TemplateName> =
  Parameters<(typeof templates)[T]> extends [] ? Record<string, never> : Parameters<(typeof templates)[T]>[0];

export function render<T extends TemplateName>(name: T, data: TemplateData<T>): Rendered {
  return (templates[name] as (d: TemplateData<T>) => Rendered)(data);
}
