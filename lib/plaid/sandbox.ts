import { Products } from "plaid";
import type { ISODate } from "@/engine/dates";
import { clampToReal } from "@/lib/clock";
import { env } from "@/lib/env";
import { assertSandbox, plaid, SANDBOX_INSTITUTION, toPlaidAmount } from "./client";

// Sandbox only: a connected fake bank from a persona JSON, without opening Link.
export async function createCustomUserPublicToken(customUser: object): Promise<string> {
  assertSandbox();
  const { data } = await plaid().sandboxPublicTokenCreate({
    institution_id: SANDBOX_INSTITUTION,
    initial_products: [Products.Transactions, Products.Auth, Products.Identity],
    options: {
      override_username: "user_custom",
      override_password: JSON.stringify(customUser),
      webhook: process.env.PLAID_WEBHOOK_URL || `${env.appUrl}/api/plaid/webhook`,
      transactions: { days_requested: 180 },
    },
  });
  return data.public_token;
}

// Post transactions to a sandbox Item so the bank feed shows them like a real
// bank would. Plaid refuses future dates, so demo clock dates are clamped to
// today; Stabl keeps its own row with the demo date. Ten per call is Plaid's cap.
export async function postSandboxTransactions(
  token: string,
  plaidAccountId: string,
  txns: { date: ISODate; amountCents: number; name: string }[],
) {
  assertSandbox();
  for (let i = 0; i < txns.length; i += 10) {
    await plaid().sandboxTransactionsCreate({
      access_token: token,
      transactions: txns.slice(i, i + 10).map((t) => ({
        date_transacted: clampToReal(t.date),
        date_posted: clampToReal(t.date),
        amount: toPlaidAmount(t.amountCents),
        description: t.name,
        iso_currency_code: "USD",
        account_id: plaidAccountId,
      })),
    });
  }
}

export async function fireSandboxWebhook(token: string, code: "SYNC_UPDATES_AVAILABLE" | "DEFAULT_UPDATE" | "PENDING_DISCONNECT" | "USER_PERMISSION_REVOKED") {
  assertSandbox();
  await plaid().sandboxItemFireWebhook({ access_token: token, webhook_code: code as never });
}
