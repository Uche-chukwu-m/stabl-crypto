import { eq } from "drizzle-orm";
import { addDays, type ISODate } from "@/engine/dates";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

type ClockUser = { timezone: string; clockOffsetDays: number };

// The user's local calendar date for a moment in time.
export function localDate(at: Date, timezone: string): ISODate {
  return at.toLocaleDateString("en-CA", { timeZone: timezone });
}

// Every engine call reads "today" from here. Real time, unless the admin moved
// this demo user's clock forward so judges can watch weeks pass in a minute.
export function clockFor(user: ClockUser, at = new Date()) {
  const now = new Date(at.getTime() + user.clockOffsetDays * 86_400_000);
  return { now, today: localDate(now, user.timezone) };
}

export async function now(userId: string): Promise<Date> {
  return (await clockOf(userId)).now;
}

export async function today(userId: string): Promise<ISODate> {
  return (await clockOf(userId)).today;
}

async function clockOf(userId: string) {
  const [user] = await db
    .select({ timezone: users.timezone, clockOffsetDays: users.clockOffsetDays })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error("No such user");
  return clockFor(user);
}

// The real calendar date, for calls to Plaid, which refuses future dates.
export function realToday(timezone = "America/Chicago"): ISODate {
  return localDate(new Date(), timezone);
}

export function clampToReal(date: ISODate, timezone?: string): ISODate {
  const real = realToday(timezone);
  return date > real ? real : date;
}

export { addDays };
