import { z } from "zod";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { confirmUnfreeze, freeze, requestUnfreeze } from "@/lib/security";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("freeze") }),
  z.object({ action: z.literal("unfreeze_request") }),
  z.object({ action: z.literal("unfreeze_confirm"), code: z.string().regex(/^\d{6}$/) }),
]);

// Freeze needs no code; stopping is always safe. Unfreezing needs one.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!(await rateLimit(`freeze:${user.id}`, 20, 600))) throw new HttpError(429, "Too many tries. Wait a few minutes.");
  const body = Body.parse(await request.json());
  if (body.action === "freeze") await freeze(user.id);
  else if (body.action === "unfreeze_request") await requestUnfreeze(user.id, "app");
  else if (!(await confirmUnfreeze(user.id, body.code))) throw new HttpError(409, "That code did not match or has expired.");
  return { ok: true };
});
