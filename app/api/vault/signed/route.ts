import { z } from "zod";
import { route } from "@/lib/api";
import { chain } from "@/lib/chain/config";
import { confirmSigned, PasskeyError } from "@/lib/chain/passkey";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

export const maxDuration = 60;

const Body = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  moveId: z.uuid().optional(),
  unfreeze: z.boolean().optional(),
});

// The browser reports a transaction it signed with the person's passkey. Stabl
// reads it from Arc and applies the vault's own events; it never trusts the
// report alone. The QuickNode Stream delivers the same events, harmlessly.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!chain.enabled) throw new HttpError(404, "Not available.");
  if (!(await rateLimit(`signed:${user.id}`, 30, 600))) throw new HttpError(429, "Too many tries. Wait a few minutes.");
  const body = Body.parse(await request.json());
  try {
    return await confirmSigned(user.id, body.txHash as `0x${string}`, { moveId: body.moveId, unfreeze: body.unfreeze });
  } catch (error) {
    if (error instanceof PasskeyError) throw new HttpError(409, error.message);
    throw error;
  }
});
