import { ENGINE } from "./config";
import { dayNumber } from "./dates";
import { isVaultTransfer, looksLikeCardPayment, looksLikeNotIncome, looksLikePayout, sourceKey } from "./sources";
import type { Decision, EngineAccount, SourceTag, Txn, TxnClass, UserState } from "./types";

type Classified = Pick<Decision, "classes" | "sourceKeys" | "engineTags" | "mysteryCredits">;

export function classify(
  txns: Txn[],
  accounts: EngineAccount[],
  state: Pick<UserState, "sourceTags" | "promptedSources">,
): Classified {
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  const classes: Record<string, TxnClass> = {};
  const sourceKeys: Record<string, string> = {};

  for (const t of txns) {
    sourceKeys[t.id] = sourceKey(t.name);
    if (isVaultTransfer(t.name)) classes[t.id] = "vault";
    else if (kindOf.get(t.accountId) === "credit" && t.amountCents > 0) classes[t.id] = "internal";
    else if (t.amountCents < 0 && looksLikeCardPayment(t.name)) classes[t.id] = "internal";
  }

  matchTransfers(txns, classes);

  // How many times each credit source shows up, to spot steady payers.
  const creditCounts = new Map<string, number>();
  for (const t of txns) {
    if (classes[t.id] || t.amountCents <= 0) continue;
    const key = sourceKeys[t.id];
    creditCounts.set(key, (creditCounts.get(key) ?? 0) + 1);
  }

  const prompted = new Set(state.promptedSources);
  const engineTags = new Map<string, SourceTag>();
  const mysteryCredits: Classified["mysteryCredits"] = [];

  for (const t of txns) {
    if (classes[t.id]) continue;
    if (t.amountCents < 0) {
      classes[t.id] = "expense";
      continue;
    }
    const key = sourceKeys[t.id];
    const tag = state.sourceTags[key] ?? engineTags.get(key) ?? learnTag(t.name, key, creditCounts, prompted);
    if (tag && !state.sourceTags[key]) engineTags.set(key, tag);
    if (tag === "income") classes[t.id] = "income";
    else if (tag === "not_income") classes[t.id] = "not_income";
    else {
      classes[t.id] = "mystery";
      mysteryCredits.push({ txnId: t.id, sourceKey: key, amountCents: t.amountCents, name: t.name, date: t.date });
    }
  }

  return {
    classes,
    sourceKeys,
    engineTags: [...engineTags].map(([key, tag]) => ({ sourceKey: key, tag })),
    mysteryCredits,
  };
}

function learnTag(
  name: string,
  key: string,
  creditCounts: Map<string, number>,
  prompted: Set<string>,
): SourceTag | null {
  // Once the user has been asked, only their answer can tag the source.
  if (prompted.has(key)) return null;
  if (looksLikeNotIncome(name)) return "not_income";
  if (looksLikePayout(name)) return "income";
  if ((creditCounts.get(key) ?? 0) >= 2) return "income";
  return null;
}

// Money moving between two of the user's own accounts: same amount, opposite sign,
// different accounts, within a few days. Both sides are ignored.
function matchTransfers(txns: Txn[], classes: Record<string, TxnClass>) {
  const open = txns.filter((t) => !classes[t.id]).sort((a, b) => a.date.localeCompare(b.date));
  const creditsByAmount = new Map<number, Txn[]>();
  for (const t of open) {
    if (t.amountCents > 0) creditsByAmount.set(t.amountCents, [...(creditsByAmount.get(t.amountCents) ?? []), t]);
  }
  const used = new Set<string>();
  for (const out of open) {
    if (out.amountCents >= 0 || used.has(out.id)) continue;
    const match = creditsByAmount.get(-out.amountCents)?.find(
      (t) =>
        !used.has(t.id) &&
        t.accountId !== out.accountId &&
        !looksLikePayout(t.name) &&
        Math.abs(dayNumber(t.date) - dayNumber(out.date)) <= ENGINE.transferMatchDays,
    );
    if (!match) continue;
    used.add(out.id);
    used.add(match.id);
    classes[out.id] = "internal";
    classes[match.id] = "internal";
  }
}
