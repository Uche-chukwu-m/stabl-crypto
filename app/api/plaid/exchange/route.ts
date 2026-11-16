import { z } from "zod";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { runEngine } from "@/lib/engine-runner";
import { connectItem } from "@/lib/plaid/items";
import { refreshRecurringBills } from "@/lib/plaid/recurring";
import { connectTestHistory, pickedInstitution } from "@/lib/plaid/test-history";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

export const maxDuration = 120;

const Body = z.object({ publicToken: z.string().min(10).max(500).optional() });

// Finish a bank connection after Plaid's window closes. The access token is
// encrypted and stays on the server; the browser only ever sees what this returns.
//
// With real banks the connection is used as it is. With Plaid's test banks, the
// stock test user is swapped for a test history in the person's own name (see
// lib/plaid/test-history.ts).
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!(await rateLimit(`exchange:${user.id}`, 20, 3600))) throw new HttpError(429, "Too many tries. Wait a little.");
  const { publicToken } = Body.parse(await request.json().catch(() => ({})));

  let institution: string;
  if (env.plaidMode === "production") {
    if (!publicToken) throw new HttpError(400, "Connect through your bank first.");
    institution = (await connectItem(user.id, publicToken)).institutionName;
  } else {
    if (env.plaidMode === "sandbox" && !publicToken) throw new HttpError(400, "Connect through your bank first.");
    // Without Plaid keys (local development) there is no window to open.
    institution = publicToken ? await pickedInstitution(publicToken) : "First Platypus Bank";
    if (!(await connectTestHistory(user, institution))) throw new HttpError(409, "That bank is already connected.");
  }

  await refreshRecurringBills(user.id);
  await runEngine(user.id, { learnOnly: true });
  await audit(user.id, "user", "connection_added", { institution });
  return { institution };
});
