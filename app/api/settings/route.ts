import { eq } from "drizzle-orm";
import { z } from "zod";
import { ENGINE } from "@/engine/config";
import { addMonths } from "@/engine/dates";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { channels, engineProfiles, users } from "@/lib/db/schema";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({
  dailyLimitCents: z.number().int().min(0).optional(),
  pauseBuffering: z.boolean().optional(),
  quietHours: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
});

export const POST = route(async (request) => {
  const user = await apiUser();
  const body = Body.parse(await request.json());

  if (body.dailyLimitCents !== undefined) {
    // The limit can only go down from the build's maximum.
    if (body.dailyLimitCents > ENGINE.dailyLimitCents) throw new HttpError(400, "The daily limit can be at most $2,500.00.");
    await db.update(users).set({ dailyLimitCents: body.dailyLimitCents }).where(eq(users.id, user.id));
  }
  if (body.pauseBuffering !== undefined) {
    const ctx = await loadContext(user.id);
    const until = body.pauseBuffering ? addMonths(ctx.today, ENGINE.pauseMonths) : null;
    await db.update(engineProfiles).set({ pausedUntil: until }).where(eq(engineProfiles.userId, user.id));
  }
  const ch: Partial<typeof channels.$inferInsert> = {};
  if (body.quietHours !== undefined) ch.quietHours = body.quietHours;
  if (body.emailEnabled !== undefined) ch.emailEnabled = body.emailEnabled;
  if (Object.keys(ch).length) {
    await db.insert(channels).values({ userId: user.id, ...ch }).onConflictDoUpdate({ target: channels.userId, set: ch });
  }
  await audit(user.id, "user", "settings_changed", body);
  return { ok: true };
});
