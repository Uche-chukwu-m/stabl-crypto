import { z } from "zod";
import { route } from "@/lib/api";
import { chain } from "@/lib/chain/config";
import { emergencySignRequest } from "@/lib/chain/passkey";
import { walletFor } from "@/lib/vault/arc";
import { rateLimit } from "@/lib/rate-limit";
import { confirmEmergency, startEmergency } from "@/lib/security";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), code: z.string().regex(/^\d{6}$/), amountCents: z.number().int().positive() }),
]);

const REASONS = {
  code: "That code did not match or has expired.",
  not_yet: "This unlock opens 24 hours after you asked. Freezing still works any time.",
  amount: "Choose an amount up to what is in your vault.",
  frozen: "Your vault is frozen. Unfreeze it first.",
};

// Emergency unlock: start (code goes to a second channel), then confirm with the
// code and an amount. The release settles the same day.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!(await rateLimit(`emergency:${user.id}`, 10, 600))) throw new HttpError(429, "Too many tries. Wait a few minutes.");
  const body = Body.parse(await request.json());
  if (body.action === "start") return { result: await startEmergency(user.id, "app") };
  const result = await confirmEmergency(user.id, body.code, body.amountCents);
  if (!result.ok) throw new HttpError(409, REASONS[result.reason]);
  // A passkey vault: the unlock waits for the person's own signature.
  if (chain.enabled && (await walletFor(user.id)).kind === "passkey") {
    return { ok: true, moveId: result.moveId, sign: await emergencySignRequest(user.id, result.moveId) };
  }
  return result;
});
