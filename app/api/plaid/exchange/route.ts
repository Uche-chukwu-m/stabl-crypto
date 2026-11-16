import { z } from "zod";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { runEngine } from "@/lib/engine-runner";
import { connectItem } from "@/lib/plaid/items";
import { refreshRecurringBills } from "@/lib/plaid/recurring";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({ publicToken: z.string().min(10).max(500) });

// Exchange the public token from Link. The access token is encrypted and stays
// on the server; the browser only ever sees what this returns.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!(await rateLimit(`exchange:${user.id}`, 20, 3600))) throw new HttpError(429, "Too many tries. Wait a little.");
  const { publicToken } = Body.parse(await request.json());
  const item = await connectItem(user.id, publicToken);
  await refreshRecurringBills(user.id);
  await runEngine(user.id, { learnOnly: true });
  await audit(user.id, "user", "connection_added", { itemId: item.id, institution: item.institutionName });
  return { item: { id: item.id, institution: item.institutionName } };
});
