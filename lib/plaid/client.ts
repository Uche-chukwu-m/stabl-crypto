import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { decryptToken } from "@/lib/crypto";
import { env } from "@/lib/env";

let client: PlaidApi | null = null;

// The Plaid Trial plan allows 10 Items ever, and deleting one does not free the
// slot. New Links stop at 9 so one is always left for a reconnect.
export const TRIAL_ITEM_CAP = 9;
// Non OAuth sandbox bank, so custom user data is not overwritten.
export const SANDBOX_INSTITUTION = "ins_109508";

export function plaid(): PlaidApi {
  if (env.plaidMode === "local") throw new Error("Plaid is not configured");
  client ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.plaidMode === "production" ? "production" : "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
          "Plaid-Version": "2020-09-14",
        },
      },
    }),
  );
  return client;
}

export function accessToken(item: { accessTokenEnc: string | null }): string {
  if (!item.accessTokenEnc) throw new Error("Item has no access token");
  return decryptToken(item.accessTokenEnc);
}

// Sandbox only calls are refused against real banks.
export function assertSandbox() {
  if (env.plaidMode !== "sandbox") throw new Error("Sandbox only");
}

// Plaid: positive is money leaving the account. Stabl: positive is money in.
export function toStablCents(plaidAmount: number): number {
  return -Math.round(plaidAmount * 100);
}

export function toPlaidAmount(stablCents: number): number {
  return -stablCents / 100;
}

export function plaidErrorCode(error: unknown): string | null {
  return (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code ?? null;
}
