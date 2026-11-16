import { eq, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { postToHomeBase } from "@/lib/bank-mirror";
import { loadContext } from "@/lib/context";
import { runDailyForUser } from "@/lib/daily";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { runEngine } from "@/lib/engine-runner";
import { settleDueBuffers } from "@/lib/moves";
import { loadEngineInputs } from "@/lib/engine-inputs";
import { DEMO_EVENTS, eventTxns, type DemoEventKey } from "@/personas/demo-events";
import type { PersonaKey } from "@/personas";
import { seedPersona } from "./seed";

// Admin tools for the pitch. Every route that calls these checks ADMIN_KEY and
// refuses to run against real banks.

export async function injectEvent(userId: string, key: DemoEventKey) {
  const ctx = await loadContext(userId);
  if (!ctx.homeBase) throw new Error("This user has no home base yet");
  const event = DEMO_EVENTS[key];
  const inputs = await loadEngineInputs(ctx);
  await postToHomeBase(ctx.homeBase, eventTxns(key, inputs.state, inputs.txns, ctx.today), "demo_inject");
  await audit(userId, "admin", "demo_event", { event: key, date: ctx.today });
  // What the webhook would do: sync, then the fast check, plus the feast check
  // for income events so judges see it react right away.
  return runEngine(userId, { forceFast: true, forceFeast: event.forceFeast });
}

export async function runNow(userId: string) {
  await settleDueBuffers(userId);
  await audit(userId, "admin", "run_engine");
  return runEngine(userId, { forceFast: true, forceFeast: true });
}

// Move this user's clock forward one day at a time, running the daily job for
// each day, so buffers settle and checks fall due exactly as they would.
export async function advanceClock(userId: string, days: number) {
  for (let i = 0; i < days; i++) {
    await db.update(users).set({ clockOffsetDays: sql`${users.clockOffsetDays} + 1` }).where(eq(users.id, userId));
    await runDailyForUser(userId);
  }
  await audit(userId, "admin", "advance_clock", { days });
}

export async function resetDemoUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.isDemo || !user.personaKey) throw new Error("Only demo users can be reset");
  const { userId: fresh } = await seedPersona(user.personaKey as PersonaKey, { email: user.email });
  await audit(fresh, "admin", "demo_reset");
  return fresh;
}
