// Display helpers safe for both server and client components.
export { formatCents, formatDollars } from "@/engine/money";

export function formatDay(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    weekday: opts.weekday ? "short" : undefined,
    year: opts.year ? "numeric" : undefined,
  });
}

export function formatTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "PARKSIDE APTS RENT" to "Parkside Apts Rent".
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
