// Money is integer cents everywhere. These helpers are the only place cents turn
// into text.

const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Receipts and ledgers: always with cents.
export function formatCents(cents: number): string {
  return withCents.format(cents / 100);
}

// Charts and summaries: whole dollars.
export function formatDollars(cents: number): string {
  return wholeDollars.format(Math.round(cents / 100));
}

// Slow to take: buffers round down to a whole dollar.
export function floorDollar(cents: number): number {
  return Math.floor(cents / 100) * 100;
}

// Fast to give back: releases round up to a whole dollar.
export function ceilDollar(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo));
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}
