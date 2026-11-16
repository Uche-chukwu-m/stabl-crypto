// npx tsx scripts/plaid-sign-check.ts
// Confirms Plaid's sign convention with one test transaction before trusting the
// generated personas: a $12.34 purchase must come back as money leaving the account.
import "./env";
import { Products } from "plaid";
import { plaid, SANDBOX_INSTITUTION, toStablCents } from "@/lib/plaid/client";

const config = {
  override_accounts: [
    {
      type: "depository",
      subtype: "checking",
      starting_balance: 500,
      meta: { name: "Sign Check", mask: "0001" },
      transactions: [{ date_transacted: new Date().toISOString().slice(0, 10), date_posted: new Date().toISOString().slice(0, 10), amount: 12.34, description: "SIGN CHECK PURCHASE", currency: "USD" }],
    },
  ],
};
const { data: pub } = await plaid().sandboxPublicTokenCreate({
  institution_id: SANDBOX_INSTITUTION,
  initial_products: [Products.Transactions],
  options: { override_username: "user_custom", override_password: JSON.stringify(config) },
});
const { data: ex } = await plaid().itemPublicTokenExchange({ public_token: pub.public_token });
for (let i = 0; i < 15; i++) {
  const { data } = await plaid().transactionsSync({ access_token: ex.access_token });
  const t = data.added.find((x) => (x.original_description ?? x.name).includes("SIGN CHECK"));
  if (t) {
    const cents = toStablCents(t.amount);
    console.log(`Plaid amount ${t.amount} -> Stabl ${cents} cents: ${cents < 0 ? "correct, a purchase is money out" : "WRONG SIGN"}`);
    await plaid().itemRemove({ access_token: ex.access_token });
    process.exit(cents < 0 ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("No transaction came back in time; try again.");
process.exit(1);
