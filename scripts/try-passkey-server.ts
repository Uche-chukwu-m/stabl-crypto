// npx tsx scripts/try-passkey-server.ts <user email>
// Tests the server side of passkey wallets on Arc, with an ordinary test key
// standing in for the passkey (a browser is needed for a real one). Local
// development only: it changes who owns that user's vault on chain.
//   1. Link: sign Stabl's challenge, then move the vault to the new owner.
//   2. Emergency unlock signed by the owner, confirmed through /api/vault/signed's code path.
import "./env";
import { eq } from "drizzle-orm";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet, readVault } from "@/lib/chain/arc";
import { execute, waitForTx } from "@/lib/chain/circle";
import { ARC, chain, txUrl, unitsToCents } from "@/lib/chain/config";
import { confirmSigned, emergencySignRequest, linkPasskeyWallet, passkeyChallenge } from "@/lib/chain/passkey";
import { db, pool } from "@/lib/db";
import { chainWallets, messages, moves, users, vaultAccounts, vaultBalances } from "@/lib/db/schema";
import { confirmEmergency, startEmergency } from "@/lib/security";
import { desc } from "drizzle-orm";

const email = process.argv[2];
if (!email) throw new Error("Pass a user email from the local database.");
const [user] = await db.select().from(users).where(eq(users.email, email));
if (!user) throw new Error("No such user locally.");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const appBalance = async () => {
  const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, user.id));
  const [b] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, v.id));
  return b.balanceCents;
};

const owner = privateKeyToAccount(generatePrivateKey());
console.log(`stand-in passkey wallet ${owner.address}`);

// 1. Link
const [before] = await db.select().from(chainWallets).where(eq(chainWallets.userId, user.id));
console.log(`before: ${before.kind} wallet ${before.address}, contract holds ${money(unitsToCents((await readVault(before.address as `0x${string}`)).units))}, app shows ${money(await appBalance())}`);
const { message } = await passkeyChallenge(user.id);
const signature = await owner.signMessage({ message });
let t = Date.now();
await linkPasskeyWallet(user.id, owner.address, message, signature);
const [after] = await db.select().from(chainWallets).where(eq(chainWallets.userId, user.id));
const onNew = await readVault(after.address as `0x${string}`);
const onOld = await readVault(before.address as `0x${string}`);
console.log(`linked in ${((Date.now() - t) / 1000).toFixed(1)}s: now ${after.kind} wallet ${after.address}`);
console.log(`  contract: new owner ${money(unitsToCents(onNew.units))}, old owner ${money(unitsToCents(onOld.units))}; app shows ${money(await appBalance())}`);
const replay = await linkPasskeyWallet(user.id, owner.address, message, signature).then(() => "accepted (BAD)").catch((e) => `refused: ${e.message}`);
console.log(`  same signature again: ${replay}`);

// 2. Emergency unlock signed by the owner. The stand-in key pays its own gas, so give it a little.
const gas = await execute({
  walletId: chain.operatorWalletId!,
  contractAddress: ARC.usdc,
  call: { abiFunctionSignature: "transfer(address,uint256)", abiParameters: [owner.address, "20000"] },
  key: ["passkey-test-gas", owner.address],
});
await waitForTx(gas, 60_000);
console.log(`start: ${await startEmergency(user.id, "app")}`);
const [codeMsg] = await db.select().from(messages).where(eq(messages.userId, user.id)).orderBy(desc(messages.createdAt)).limit(1);
const code = codeMsg.body.match(/\b(\d{6})\b/)?.[1];
const result = await confirmEmergency(user.id, code!, 25_00);
if (!result.ok) throw new Error(`confirm failed: ${result.reason}`);
const [waiting] = await db.select().from(moves).where(eq(moves.id, result.moveId));
console.log(`move waiting for the owner's signature: ${waiting.state}, Circle tx ${waiting.chainTxId ?? "none (correct)"}`);
const sign = await emergencySignRequest(user.id, result.moveId);
const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(chain.rpcUrl) });
t = Date.now();
const txHash = await wallet.sendTransaction({ to: sign.to, data: sign.data, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
await arc().waitForTransactionReceipt({ hash: txHash });
console.log(`owner signed and sent: ${txUrl(txHash)}`);
console.log(`confirm: ${JSON.stringify(await confirmSigned(user.id, txHash, { moveId: result.moveId }))}`);
const [settled] = await db.select().from(moves).where(eq(moves.id, result.moveId));
console.log(`move: ${settled.state}, confirmed by ${settled.confirmedBy} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
const finalChain = unitsToCents((await readVault(owner.address)).units);
const finalApp = await appBalance();
console.log(`final: contract ${money(finalChain)}, app ${money(finalApp)} ${finalChain === finalApp ? "- they agree" : "- THEY DIFFER"}`);
await pool.end();
