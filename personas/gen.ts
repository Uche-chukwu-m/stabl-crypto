import { addDays, addMonths, dayNumber, type ISODate } from "@/engine/dates";

export type GenTxn = { account: string; date: ISODate; amountCents: number; name: string };

export type PersonaAccount = {
  key: string;
  name: string;
  officialName: string;
  mask: string;
  type: "depository" | "credit";
  subtype: "checking" | "savings" | "credit card";
  homeBase?: boolean;
};

export type PersonaItem = {
  key: string;
  // What the app shows for this connection, such as "Second Bank".
  label: string;
  accounts: PersonaAccount[];
};

export type Persona = {
  key: "jemaya" | "jordan" | "ada" | "tee";
  legalName: string;
  email: string;
  earnType: "freelance" | "commission" | "own_business" | "mix";
  payFrequency: string;
  timezone: string;
  items: PersonaItem[];
  // Opening balances for accounts other than home base, which is calibrated.
  openingCents: Record<string, number>;
  // Home base balance the generator aims for on the last day of history.
  targetEndCheckingCents: number;
  // Pin the persona's demo clock to this day of the month (Jemaya, so the pitch
  // script lands the same way on any date).
  demoDayOfMonth?: number;
  build(g: Gen): void;
};

// Small, fast, seedable PRNG (mulberry32). The same seed always gives the same
// persona, so tests and the demo agree.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Gen {
  txns: GenTxn[] = [];
  private next: () => number;

  constructor(
    public start: ISODate,
    public end: ISODate,
    seed: number,
  ) {
    this.next = rng(seed);
  }

  add(account: string, date: ISODate, amountCents: number, name: string) {
    if (date < this.start || date > this.end || amountCents === 0) return;
    this.txns.push({ account, date, amountCents: Math.round(amountCents), name });
  }

  spend(account: string, date: ISODate, cents: number, name: string) {
    this.add(account, date, -Math.abs(cents), name);
  }

  // Day `offset` relative to the last day of history (0 is the last day).
  day(offset: number): ISODate {
    return addDays(this.end, offset);
  }

  offsetOf(date: ISODate): number {
    return dayNumber(date) - dayNumber(this.end);
  }

  random(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  cents(minDollars: number, maxDollars: number): number {
    return this.int(minDollars * 100, maxDollars * 100);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  monthly(dayOfMonth: number, fn: (date: ISODate) => void) {
    let date = addMonths(this.start, 0, dayOfMonth);
    if (date < this.start) date = addMonths(date, 1, dayOfMonth);
    while (date <= this.end) {
      fn(date);
      date = addMonths(date, 1, dayOfMonth);
    }
  }

  // Every week on the given weekday (0 Sunday to 6 Saturday), with a little jitter.
  weekly(weekday: number, fn: (date: ISODate) => void, jitterDays = 0) {
    let date = this.start;
    while (new Date(`${date}T00:00:00Z`).getUTCDay() !== weekday) date = addDays(date, 1);
    while (date <= this.end) {
      fn(addDays(date, jitterDays ? this.int(-jitterDays, jitterDays) : 0));
      date = addDays(date, 7);
    }
  }

  everyDays(minGap: number, maxGap: number, fn: (date: ISODate) => void, from = this.start, to = this.end) {
    let date = addDays(from, this.int(0, minGap));
    while (date <= to) {
      fn(date);
      date = addDays(date, this.int(minGap, maxGap));
    }
  }

  storeNumber(): string {
    return String(this.int(100, 9999));
  }
}
