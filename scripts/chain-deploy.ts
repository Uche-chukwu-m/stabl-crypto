// npm run chain:deploy
// Deploys StablVault to Arc Testnet and records where it went.
//
// The deploy is sent from a Circle smart contract account through Arc's CREATE2
// factory, so Circle's Gas Station pays the fee and no private key is involved.
// The vault has no owner and no admin, so who deploys it does not matter: the
// operator and the token are fixed by the constructor arguments below.
// Build the contract first: (cd contracts && npm run build).
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { concatHex, encodeAbiParameters, getContractAddress, keccak256, stringToHex } from "viem";
import { arc } from "@/lib/chain/arc";
import { ensureWallet, execute, waitForTx } from "@/lib/chain/circle";
import { ARC, addressUrl, chain, txUrl, type Hex } from "@/lib/chain/config";
import { vaultAbi } from "@/lib/chain/vault-abi";

const operator = chain.operatorAddress;
if (!operator) throw new Error("Set STABL_OPERATOR_ADDRESS first (npm run chain:setup prints it).");

const artifact = JSON.parse(readFileSync("contracts/artifacts/src/StablVault.sol/StablVault.json", "utf8")) as { bytecode: Hex };

const args = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ARC.usdc, operator]);
const initCode = concatHex([artifact.bytecode, args]);
const salt = keccak256(stringToHex("stabl-vault:v1"));
const address = getContractAddress({ opcode: "CREATE2", from: ARC.create2Factory, salt, bytecode: initCode });
console.log(`Vault address will be ${address}`);

let txHash: Hex | null = null;
let blockNumber: number | null = null;
const existing = await arc().getCode({ address });
if (existing && existing !== "0x") {
  console.log("Already deployed. Checking it.");
} else {
  const deployer = await ensureWallet("stabl-deployer", "Stabl deployer", "SCA");
  console.log(`Deploying from Circle wallet ${deployer.address} (fee sponsored by Gas Station)`);
  const id = await execute({
    walletId: deployer.id,
    contractAddress: ARC.create2Factory,
    // The factory takes the salt followed by the contract's creation code.
    call: { callData: concatHex([salt, initCode]) },
    key: ["deploy", address],
    refId: "deploy StablVault",
  });
  const status = await waitForTx(id, 120_000);
  if (!status.landed) throw new Error(`Deploy did not land: ${status.state} ${status.error ?? ""}`);
  txHash = status.txHash;
  blockNumber = status.blockHeight;
  console.log(`Landed in ${txHash}`);
}

const code = await arc().getCode({ address });
if (!code || code === "0x") throw new Error("No contract code at the expected address.");
const [onChainOperator, onChainUsdc] = await Promise.all([
  arc().readContract({ address, abi: vaultAbi, functionName: "operator" }),
  arc().readContract({ address, abi: vaultAbi, functionName: "usdc" }),
]);
if (onChainOperator.toLowerCase() !== operator.toLowerCase()) throw new Error("Deployed operator does not match.");
if (onChainUsdc.toLowerCase() !== ARC.usdc.toLowerCase()) throw new Error("Deployed token does not match.");

const file = "contracts/deployments/arc-testnet.json";
let previous: Record<string, unknown> = {};
try {
  previous = JSON.parse(readFileSync(file, "utf8"));
} catch {}
const record = {
  network: ARC.name,
  chainId: ARC.chainId,
  contract: "StablVault",
  address,
  operator: onChainOperator,
  usdc: onChainUsdc,
  txHash: txHash ?? previous.txHash ?? null,
  blockNumber: blockNumber ?? previous.blockNumber ?? null,
  deployedVia: `CREATE2 factory ${ARC.create2Factory}`,
  salt,
  compiler: { solc: "0.8.30", optimizerRuns: 200, evmVersion: "prague" },
  explorer: addressUrl(address),
};
writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

console.log(`\nVerified on Arc: operator ${onChainOperator}, token ${onChainUsdc}`);
console.log(`Explorer: ${addressUrl(address)}`);
if (txHash) console.log(`Deploy transaction: ${txUrl(txHash)}`);
console.log(`\nPut this in .env.local and in Vercel:\nARC_VAULT_ADDRESS=${address}`);
