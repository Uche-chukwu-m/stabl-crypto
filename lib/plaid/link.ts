import { and, count, eq } from "drizzle-orm";
import { CountryCode, Products, type LinkTokenCreateRequest } from "plaid";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { accessToken, plaid, TRIAL_ITEM_CAP } from "./client";

export class LinkCapError extends Error {}

// A Link token for a new connection, or for update mode when `itemRowId` names a
// connection that needs the user to log in again.
export async function createLinkToken(userId: string, itemRowId?: string): Promise<string> {
  const request: LinkTokenCreateRequest = {
    user: { client_user_id: userId },
    client_name: "Stabl",
    country_codes: [CountryCode.Us, CountryCode.Ca],
    language: "en",
    webhook: process.env.PLAID_WEBHOOK_URL || `${env.appUrl}/api/plaid/webhook`,
  };

  if (itemRowId) {
    const [item] = await db.select().from(plaidItems).where(and(eq(plaidItems.id, itemRowId), eq(plaidItems.userId, userId)));
    if (!item) throw new Error("No such connection");
    request.access_token = accessToken(item);
  } else {
    if (env.plaidMode === "production") {
      const [{ n }] = await db.select({ n: count() }).from(plaidItems).where(eq(plaidItems.env, "production"));
      if (n >= TRIAL_ITEM_CAP) throw new LinkCapError("The Plaid Trial plan is out of connections.");
    }
    request.products = [Products.Transactions];
    request.required_if_supported_products = [Products.Auth, Products.Identity];
    request.transactions = { days_requested: 180 };
  }

  const { data } = await plaid().linkTokenCreate(request);
  return data.link_token;
}
