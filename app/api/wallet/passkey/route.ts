import { z } from "zod";
import { route } from "@/lib/api";
import { chain } from "@/lib/chain/config";
import { linkPasskeyWallet, passkeyChallenge, PasskeyError } from "@/lib/chain/passkey";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";
import { walletFor } from "@/lib/vault/arc";

export const maxDuration = 300;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("challenge") }),
  z.object({
    action: z.literal("link"),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    message: z.string().max(200),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  }),
]);

// Which wallet owns this person's vault.
export const GET = route(async () => {
  const user = await apiUser();
  if (!chain.enabled) return { kind: null };
  const wallet = await walletFor(user.id);
  return { kind: wallet.kind, address: wallet.address };
});

// Linking a passkey wallet: get a challenge, sign it with the new wallet, and
// send the signature back. Stabl then moves the vault to that wallet.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!chain.enabled) throw new HttpError(404, "Not available.");
  if (user.isDemo) throw new HttpError(409, "The presenter account keeps its Stabl-managed key.");
  if (!(await rateLimit(`passkey:${user.id}`, 10, 600))) throw new HttpError(429, "Too many tries. Wait a few minutes.");
  const body = Body.parse(await request.json());
  if (body.action === "challenge") return passkeyChallenge(user.id);
  try {
    const { moved } = await linkPasskeyWallet(user.id, body.address as `0x${string}`, body.message, body.signature as `0x${string}`);
    return { ok: true, moved: moved.toString() };
  } catch (error) {
    if (error instanceof PasskeyError) throw new HttpError(409, error.message);
    throw error;
  }
});
