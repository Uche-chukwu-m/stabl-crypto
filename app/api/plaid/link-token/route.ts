import { z } from "zod";
import { route } from "@/lib/api";
import { env } from "@/lib/env";
import { createLinkToken, LinkCapError } from "@/lib/plaid/link";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({ itemId: z.uuid().optional() });

// A Link token for a new connection, or update mode for one that needs a login.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (env.plaidMode === "local") throw new HttpError(409, "Plaid is not set up here. Use a demo bank instead.");
  if (!(await rateLimit(`link:${user.id}`, 20, 3600))) throw new HttpError(429, "Too many tries. Wait a little.");
  const { itemId } = Body.parse(await request.json().catch(() => ({})));
  try {
    return { linkToken: await createLinkToken(user.id, itemId) };
  } catch (error) {
    if (error instanceof LinkCapError) throw new HttpError(409, error.message);
    throw error;
  }
});
