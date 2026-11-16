import { z } from "zod";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { localDate } from "@/lib/clock";
import { connectPersona } from "@/lib/demo/seed";
import { env } from "@/lib/env";
import { runEngine } from "@/lib/engine-runner";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";
import { generatePersona } from "@/personas";

const Body = z.object({ persona: z.enum(["jemaya", "jordan", "ada", "tee"]) });

// Connect a demo bank: a persona's six months of history under the user's own
// name, through Plaid Sandbox (or straight into the database without Plaid keys).
// Never offered against real banks.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (env.plaidMode === "production") throw new HttpError(404, "Not available.");
  if (!(await rateLimit(`demobank:${user.id}`, 6, 3600))) throw new HttpError(429, "Too many tries. Wait a little.");
  const { persona } = Body.parse(await request.json());
  const gp = generatePersona(persona, localDate(new Date(), user.timezone), { pitch: false });
  await connectPersona(user.id, gp, () => {}, user.legalName ?? user.name ?? "");
  await runEngine(user.id, { learnOnly: true });
  await audit(user.id, "user", "demo_bank_connected", { persona });
  return { ok: true };
});
