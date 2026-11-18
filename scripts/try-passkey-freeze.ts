// npx tsx scripts/try-passkey-freeze.ts <user email>
// Freeze and unfreeze for a vault owned by a passkey wallet, with an ordinary
// test key standing in for the passkey. Local development only.
//   Freeze: Stabl's operator freezes on the owner's behalf (no owner signature).
//   Unfreeze: needs the code AND the owner's own signature; Stabl cannot do it.
import "./env";
import { desc, eq } from "drizzle-orm";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet, readVault } from "@/lib/chain/arc";
import { execute, waitForTx } from "@/lib/chain/circle";
import { ARC, chain, txUrl } from "@/lib/chain/config";
import { confirmSigned, linkPasskeyWallet, passkeyChallenge, unfreezeSignRequest } from "@/lib/chain/passkey";
import { db, pool } from "@/lib/db";
import { messages, users, vaultAccounts } from "@/lib/db/schema";
import { confirmUnfreeze, freeze, requestUnfreeze } from "@/lib/security";
import { vault } from "@/lib/vault";

const [user] = await db.select().from(users).where(eq(users.email, process.argv[2] ?? ""));
if (!user) throw new Error("Pass a local user email.");
const appStatus = async () => (await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, user.id)))[0].status;
const owner = privateKeyToAccount(generatePrivateKey());

const { message } = await passkeyChallenge(user.id);
await linkPasskeyWallet(user.id, owner.address, message, await owner.signMessage({ message }));
console.log(`vault now owned by stand-in passkey wallet ${owner.address}`);

await freeze(user.id);
for (let i = 0; i < 20 && !(await readVault(owner.address)).frozen; i++) await new Promise((r) => setTimeout(r, 1000));
console.log(`freeze: app ${await appStatus()}, contract frozen=${(await readVault(owner.address)).frozen} (sent by Stabl's operator on the owner's behalf)`);

// Stabl on its own cannot unfreeze a passkey vault.
const direct = await vault.unfreeze((await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, user.id)))[0].id).then(() => "ran");
console.log(`server-side unfreeze without the owner: ${direct}; contract frozen=${(await readVault(owner.address)).frozen} (must still be true)`);
await db.update(vaultAccounts).set({ status: "frozen" }).where(eq(vaultAccounts.userId, user.id));

// From Telegram, the person is pointed to the app.
await requestUnfreeze(user.id, "app");
const [codeMsg] = await db.select().from(messages).where(eq(messages.userId, user.id)).orderBy(desc(messages.createdAt)).limit(1);
const code = codeMsg.body.match(/\b(\d{6})\b/)![1];
await confirmUnfreeze(user.id, code);
const [hint] = await db.select().from(messages).where(eq(messages.userId, user.id)).orderBy(desc(messages.createdAt)).limit(1);
console.log(`Telegram-style UNFREEZE: "${hint.body}"`);

// In the app: the code, then the owner's signature.
const sign = await unfreezeSignRequest(user.id, code);
const gas = await execute({
  walletId: chain.operatorWalletId!,
  contractAddress: ARC.usdc,
  call: { abiFunctionSignature: "transfer(address,uint256)", abiParameters: [owner.address, "20000"] },
  key: ["passkey-freeze-gas", owner.address],
});
await waitForTx(gas, 60_000);
const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(chain.rpcUrl) });
const txHash = await wallet.sendTransaction({ to: sign!.to, data: sign!.data, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
await arc().waitForTransactionReceipt({ hash: txHash });
console.log(`owner signed the unfreeze: ${txUrl(txHash)}`);
console.log(`confirm: ${JSON.stringify(await confirmSigned(user.id, txHash, { unfreeze: true }))}`);
console.log(`after: app ${await appStatus()}, contract frozen=${(await readVault(owner.address)).frozen}`);
await pool.end();
