// npm run chain:setup
// One time setup on Circle for the Arc build. Safe to run again: it finds what
// already exists instead of creating it twice.
//   1. A wallet set named "Stabl" that every wallet lives in.
//   2. The operator wallet: the only address the vault contract lets deposit and
//      release. It also holds the test USDC that stands in for the bank side.
// Prints the ids to put in .env.local and Vercel. Pass "fund" to also ask
// Circle's faucet for test USDC.
import "./env";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const BLOCKCHAIN = "ARC-TESTNET" as const;
const SET_NAME = "Stabl";
const OPERATOR_REF = "stabl-operator";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
if (!apiKey || !entitySecret) throw new Error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env.local first.");
const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

const sets = ((await circle.listWalletSets({})).data?.walletSets ?? []) as { id: string; name?: string }[];
let walletSetId = process.env.CIRCLE_WALLET_SET_ID || sets.find((s) => s.name === SET_NAME)?.id;
if (!walletSetId) {
  walletSetId = (await circle.createWalletSet({ name: SET_NAME })).data?.walletSet?.id;
  if (!walletSetId) throw new Error("Circle did not return a wallet set id.");
  console.log("Created wallet set.");
}

const existing = (await circle.listWallets({ walletSetId, refId: OPERATOR_REF, blockchain: BLOCKCHAIN })).data?.wallets ?? [];
let operator: { id: string; address: string } | undefined = existing[0];
if (!operator) {
  // An ordinary account that pays its own fees. On Arc those fees are USDC, the
  // same asset it already holds, so it needs no second token.
  const created = await circle.createWallets({
    walletSetId,
    blockchains: [BLOCKCHAIN],
    count: 1,
    accountType: "EOA",
    metadata: [{ name: "Stabl operator", refId: OPERATOR_REF }],
  });
  operator = created.data?.wallets?.[0];
  console.log("Created operator wallet.");
}
if (!operator) throw new Error("Circle did not return the operator wallet.");

if (process.argv.includes("fund")) {
  try {
    await circle.requestTestnetTokens({ address: operator.address, blockchain: BLOCKCHAIN, usdc: true, native: true });
    console.log("Asked the faucet for test USDC. It can take a minute to arrive.");
  } catch (error) {
    // Print Circle's answer only. The full error carries the request headers.
    const res = (error as { response?: { status?: number; data?: unknown } }).response;
    console.log(`The faucet refused (${res?.status ?? "no status"}): ${JSON.stringify(res?.data ?? String(error))}`);
    console.log(`Use https://faucet.circle.com instead: pick Arc Testnet and paste ${operator.address}`);
  }
}

const balances = (await circle.getWalletTokenBalance({ id: operator.id })).data?.tokenBalances ?? [];
console.log("\nOperator balances:");
for (const b of balances) console.log(`  ${b.amount} ${b.token.symbol}${b.token.isNative ? " (native)" : ""}`);
if (balances.length === 0) console.log("  none yet");

console.log("\nPut these in .env.local and in Vercel:");
console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
console.log(`STABL_OPERATOR_WALLET_ID=${operator.id}`);
console.log(`STABL_OPERATOR_ADDRESS=${operator.address}`);
