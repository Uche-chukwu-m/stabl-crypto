import { VAULT } from "./config";

// Payout processors collapse to one source no matter which client is named after
// them, so "STRIPE TRANSFER ACME STUDIO" and "STRIPE TRANSFER" are the same source.
const PROCESSORS: [RegExp, string][] = [
  [/^STRIPE\b/, "STRIPE"],
  [/^(SQUARE|SQ)\b/, "SQUARE"],
  [/^PAYPAL\b/, "PAYPAL"],
  [/^VENMO\b/, "VENMO"],
  [/^CASH APP\b/, "CASH APP"],
  [/^UPWORK\b/, "UPWORK"],
  [/^FIVERR\b/, "FIVERR"],
  [/^GUSTO\b/, "GUSTO"],
  [/^ETSY\b/, "ETSY"],
  [/^SHOPIFY\b/, "SHOPIFY"],
  [/^TOAST\b/, "TOAST"],
  [/^CLOVER\b/, "CLOVER"],
  [/^DOORDASH\b/, "DOORDASH"],
  [/^UBER\b/, "UBER"],
  [/^LYFT\b/, "LYFT"],
  [/^INSTACART\b/, "INSTACART"],
];

// Names that look like a paycheck or a platform payout. A new source with one of
// these names counts as income without asking.
const PAYOUT = /\b(PAYROLL|DIRECT DEP|DIR DEP|SALARY|STRIPE|SQUARE|GUSTO|ADP|PAYCHEX|UPWORK|FIVERR|PAYPAL TRANSFER|SHOPIFY|ETSY|TOAST|CLOVER|DOORDASH|UBER|LYFT|INSTACART)\b/;

const NOT_INCOME = /\b(REFUND|RETURN|REVERSAL|INTEREST|CASHBACK|CASH BACK|REWARDS?|ADJUSTMENT|DISPUTE)\b/;

const CARD_PAYMENT =
  /\b(CREDIT CARD|CARD) (PAYMENT|PMT)\b|\bAUTOPAY\b.*\b(CARD|AMEX|CHASE|CAPITAL ONE|DISCOVER|CITI)\b|\bPAYMENT THANK YOU\b|\b(AMEX|CHASE CARD|CAPITAL ONE|DISCOVER) (EPAYMENT|ONLINE PMT|MOBILE PMT)\b/;

export function cleanName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[#*]\S*/g, " ")
    .replace(/\b\d[\d-]*\b/g, " ")
    .replace(/[^A-Z&' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceKey(name: string): string {
  const clean = cleanName(name);
  for (const [pattern, key] of PROCESSORS) {
    if (pattern.test(clean)) return key;
  }
  return clean.split(" ").slice(0, 4).join(" ") || "UNKNOWN";
}

export function looksLikePayout(name: string): boolean {
  return PAYOUT.test(cleanName(name));
}

export function looksLikeNotIncome(name: string): boolean {
  return NOT_INCOME.test(cleanName(name));
}

export function looksLikeCardPayment(name: string): boolean {
  return CARD_PAYMENT.test(cleanName(name));
}

export function isVaultTransfer(name: string): boolean {
  return cleanName(name).startsWith(VAULT.vaultTransferName);
}
