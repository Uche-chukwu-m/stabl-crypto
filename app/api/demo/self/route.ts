import { z } from "zod";
import { route } from "@/lib/api";
import { advanceClock, injectEvent } from "@/lib/demo/admin";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

export const maxDuration = 120;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inject"), event: z.enum(["big_client", "slow_week", "new_source", "huge_jump"]) }),
  z.object({ action: z.literal("advance"), days: z.union([z.literal(1), z.literal(7)]) }),
]);

// Judge mode: a demo user can play the pitch events on their own copy. Only demo
// accounts, only in demo mode, never against real banks.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!env.adminEnabled || !user.isDemo) throw new HttpError(404, "Not found");
  if (!(await rateLimit(`self:${user.id}`, 30, 600))) throw new HttpError(429, "Slow down a little.");
  const body = Body.parse(await request.json());
  if (body.action === "inject") await injectEvent(user.id, body.event);
  else await advanceClock(user.id, body.days);
  return { ok: true };
});
