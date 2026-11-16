// Every threshold the engine and the money rules use. Tune here after the pilot;
// nothing else in the codebase should hard code these numbers.

export const ENGINE = {
  // Clock 1: fast check
  fastCheckEveryDays: 7,
  fastWindowDays: 7,
  floorCents: 100_00,

  // Clock 2: feast check. Each check reads income since the last one, at most
  // this many days back, so the same income is never buffered twice.
  feastCheckEveryDays: 21,
  feastWindowDays: 21,
  minBufferCents: 50_00,
  // Safety rule before any pull: checking must still cover every bill due in
  // this many days, plus the floor. The PRD says 14; 21 reaches the next feast
  // check, so a buffer can never take money that rent at the start of next month
  // needs (Jordan's rent week). Settling re checks with the same window.
  safetyWindowDays: 21,
  dailyLimitCents: 2_500_00,

  // Asymmetric caution. A week under dropFraction of the weekly low end is an
  // unusual drop: the release goes out without asking and says so after.
  jumpMultiplier: 2,
  dropFraction: 0.5,
  jumpAnswerHours: 48,
  pauseMonths: 3,

  // What the engine learns
  historyDays: 182,
  minHistoryDays: 28,
  expenseLowPercentile: 0.2,
  expenseHighPercentile: 0.8,
  // A "typical feast" is a 3 week stretch at this percentile of 3 week income.
  feastIncomePercentile: 0.8,
  weeksPerMonth: 4.33,
  transferMatchDays: 3,

  // Bill detection: same payee, similar amount, roughly monthly.
  billMinOccurrences: 3,
  billAmountTolerance: 0.2,
  billMinGapDays: 25,
  billMaxGapDays: 35,
  // A bill this many days past its expected date with no payment still counts as due.
  billGraceDays: 3,
} as const;

export const SAFETY = {
  emergencyPerWindow: 2,
  emergencyWindowDays: 90,
  emergencyWaitHours: 24,
  codeTtlMinutes: 10,
  homeBaseWaitHours: 72,
  channelChangeLockHours: 72,
  quietHoursStart: 22,
  quietHoursEnd: 8,
} as const;

export const VAULT = {
  apyPercent: Number(process.env.VAULT_APY ?? "3.50"),
  stablSharePercent: Number(process.env.STABL_SHARE_RATE ?? "2.00"),
  vaultTransferName: "STABL VAULT TRANSFER",
} as const;
