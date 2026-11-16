// npm run chain:status
// Where things stand on Arc: the operator's USDC, its allowance to the vault, and
// what the vault contract holds in total. Pass "approve" to let the vault pull
// deposits from the operator (needed once, after the operator has USDC).
import "./env";
import { arc } from "@/lib/chain/arc";
import { execute, waitForTx } from "@/lib/chain/circle";
import { ARC, addressUrl, chain, txUrl } from "@/lib/chain/config";
import { vaultAbi } from "@/lib/chain/vault-abi";
import { formatUsdc } from "@/lib/views";

const operator = chain.operatorAddress;
const vault = chain.vaultAddress;
if (!operator || !vault || !chain.operatorWalletId) throw new Error("Run chain:setup and chain:deploy first.");

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function read() {
  const [balance, allowance, held, inVault] = await Promise.all([
    arc().readContract({ address: ARC.usdc, abi: erc20, functionName: "balanceOf", args: [operator!] }),
    arc().readContract({ address: ARC.usdc, abi: erc20, functionName: "allowance", args: [operator!, vault!] }),
    arc().readContract({ address: vault!, abi: vaultAbi, functionName: "totalHeld" }),
    arc().readContract({ address: ARC.usdc, abi: erc20, functionName: "balanceOf", args: [vault!] }),
  ]);
  return { balance, allowance, held, inVault };
}

let s = await read();
if (process.argv.includes("approve") && s.allowance < 10n ** 12n) {
  if (s.balance === 0n) throw new Error("The operator has no USDC yet, so it cannot pay the fee. Use the faucet first.");
  const id = await execute({
    walletId: chain.operatorWalletId,
    contractAddress: ARC.usdc,
    // As much as the contract may ever pull. It can only pull into a vault, and
    // only when the operator itself calls deposit.
    call: { abiFunctionSignature: "approve(address,uint256)", abiParameters: [vault, (2n ** 256n - 1n).toString()] },
    key: ["approve", vault],
    refId: "approve vault",
  });
  const status = await waitForTx(id, 90_000);
  if (!status.landed) throw new Error(`Approve did not land: ${status.state} ${status.error ?? ""}`);
  console.log(`Approved: ${txUrl(status.txHash!)}`);
  s = await read();
}

const dollars = (units: bigint) => `$${(Number(units / chain.unitsPerCent) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
console.log(`Operator  ${operator}`);
console.log(`  holds     ${formatUsdc(s.balance)} USDC (covers ${dollars(s.balance)} of deposits at this scale)`);
console.log(`  allowance ${s.allowance > 10n ** 30n ? "unlimited" : formatUsdc(s.allowance) + " USDC"}${s.allowance === 0n ? "  <- run: npm run chain:status -- approve" : ""}`);
console.log(`Vault     ${vault}`);
console.log(`  owes      ${formatUsdc(s.held)} USDC across all vaults (${dollars(s.held)})`);
console.log(`  holds     ${formatUsdc(s.inVault)} USDC  ${s.inVault >= s.held ? "(covers what it owes)" : "(LESS than it owes)"}`);
console.log(`  ${addressUrl(vault)}`);
