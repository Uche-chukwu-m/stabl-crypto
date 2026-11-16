import { createPublicClient, defineChain, http, parseEventLogs, type Log, type PublicClient } from "viem";
import { ARC, chain, type Address, type Hex } from "./config";
import { vaultAbi } from "./vault-abi";

// Reading Arc directly. Writes go through Circle (lib/chain/circle.ts); this
// file only ever reads, so it needs no key.

export const arcTestnet = defineChain({
  id: ARC.chainId,
  name: ARC.name,
  // The native asset is USDC. Native amounts use 18 decimals; the ERC-20
  // interface the vault uses has 6.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: ARC.explorer } },
  testnet: true,
});

const globalForArc = globalThis as unknown as { stablArc?: PublicClient };

export function arc(): PublicClient {
  if (!globalForArc.stablArc) {
    globalForArc.stablArc = createPublicClient({ chain: arcTestnet, transport: http(chain.rpcUrl) }) as PublicClient;
  }
  return globalForArc.stablArc;
}

function requireVault(): Address {
  const address = chain.vaultAddress;
  if (!address) throw new Error("ARC_VAULT_ADDRESS is not set");
  return address;
}

// What the contract itself says about one person's vault.
export async function readVault(owner: Address): Promise<{ units: bigint; frozen: boolean }> {
  const [units, frozen] = await arc().readContract({
    address: requireVault(),
    abi: vaultAbi,
    functionName: "vaultOf",
    args: [owner],
  });
  return { units, frozen };
}

export async function usdcBalance(owner: Address): Promise<bigint> {
  return arc().readContract({
    address: ARC.usdc,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [owner],
  });
}

export type VaultEvent = {
  name: "Deposited" | "Released" | "EmergencyUnlocked" | "Frozen" | "Unfrozen";
  owner: Address;
  // Present on the three money events.
  units: bigint | null;
  ref: Hex | null;
  balanceUnits: bigint | null;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
};

// A log as it arrives from either source: viem's own shape from a receipt, or
// the JSON a QuickNode Stream delivers, where numbers are hex strings.
export type RawLog = {
  address?: string | null;
  topics?: readonly string[] | null;
  data?: string | null;
  transactionHash?: string | null;
  logIndex?: string | number | null;
  blockNumber?: string | number | bigint | null;
  removed?: boolean;
};

// Turn raw logs into vault events. Logs from any other contract are ignored, so
// a webhook cannot be fed events from a look-alike contract.
export function decodeVaultLogs(logs: RawLog[]): VaultEvent[] {
  const vault = requireVault().toLowerCase();
  const ours = logs.filter(
    (l) => l.address?.toLowerCase() === vault && !l.removed && l.transactionHash && l.logIndex != null && l.blockNumber != null && l.topics?.length,
  );
  const events: VaultEvent[] = [];
  for (const raw of ours) {
    let parsed;
    try {
      [parsed] = parseEventLogs({
        abi: vaultAbi,
        logs: [{ address: raw.address, topics: raw.topics, data: raw.data ?? "0x" } as unknown as Log],
        strict: true,
      });
    } catch {
      continue;
    }
    if (!parsed) continue;
    const base = { txHash: raw.transactionHash as Hex, logIndex: Number(raw.logIndex), blockNumber: BigInt(raw.blockNumber as string | number | bigint) };
    if (parsed.eventName === "Deposited" || parsed.eventName === "Released" || parsed.eventName === "EmergencyUnlocked") {
      events.push({ ...base, name: parsed.eventName, owner: parsed.args.owner, units: parsed.args.amount, ref: parsed.args.ref, balanceUnits: parsed.args.balance });
    } else if (parsed.eventName === "Frozen" || parsed.eventName === "Unfrozen") {
      events.push({ ...base, name: parsed.eventName, owner: parsed.args.owner, units: null, ref: null, balanceUnits: null });
    }
  }
  return events;
}

// The vault's events in one transaction, read straight from Arc. This is the
// fallback when the QuickNode Stream has not delivered them yet.
export async function vaultEventsInTx(txHash: Hex): Promise<VaultEvent[]> {
  const receipt = await arc().getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return [];
  return decodeVaultLogs(receipt.logs);
}
