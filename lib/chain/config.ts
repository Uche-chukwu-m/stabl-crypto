// Everything the app needs to know about Arc, in one place. Addresses and ids
// come from the environment; nothing here is secret.

export const ARC = {
  chainId: 5042002,
  name: "Arc Testnet",
  // Circle's name for the network in its Wallets API.
  blockchain: "ARC-TESTNET",
  explorer: "https://explorer.testnet.arc.io",
  // USDC is Arc's native asset. This is its ERC-20 interface, with 6 decimals.
  usdc: "0x3600000000000000000000000000000000000000",
  usdcDecimals: 6,
  // Arachnid's CREATE2 factory, present on Arc. Used once, to deploy the vault.
  create2Factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
} as const;

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

function address(name: string): Address | null {
  const value = process.env[name];
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

export const chain = {
  get rpcUrl(): string {
    return process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
  },
  get vaultAddress(): Address | null {
    return address("ARC_VAULT_ADDRESS");
  },
  get operatorAddress(): Address | null {
    return address("STABL_OPERATOR_ADDRESS");
  },
  get operatorWalletId(): string | null {
    return process.env.STABL_OPERATOR_WALLET_ID || null;
  },
  get walletSetId(): string | null {
    return process.env.CIRCLE_WALLET_SET_ID || null;
  },
  // The vault runs on Arc when Circle and the contract are both configured.
  // Without them the app falls back to the simulated ledger, which is what the
  // test suite uses.
  get enabled(): boolean {
    return Boolean(
      process.env.CIRCLE_API_KEY &&
        process.env.CIRCLE_ENTITY_SECRET &&
        chain.walletSetId &&
        chain.operatorWalletId &&
        chain.operatorAddress &&
        chain.vaultAddress,
    );
  },
  // How many of USDC's smallest units stand for one cent. One to one is 10,000
  // (a dollar is 1,000,000 units). The test network faucet gives 20 USDC at a
  // time, so the hackathon build runs at 100: one test cent per dollar.
  get unitsPerCent(): bigint {
    const raw = process.env.ARC_UNITS_PER_CENT;
    const value = raw && /^\d+$/.test(raw) ? BigInt(raw) : 10_000n;
    return value > 0n ? value : 10_000n;
  },
};

export function centsToUnits(cents: number): bigint {
  return BigInt(cents) * chain.unitsPerCent;
}

export function unitsToCents(units: bigint): number {
  return Number(units / chain.unitsPerCent);
}

// A move's id (a UUID) as the 32 byte reference the vault contract records.
export function moveRef(moveId: string): Hex {
  const hex = moveId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Not a UUID");
  return `0x${hex.padStart(64, "0")}`;
}

export function refToMoveId(ref: string): string | null {
  const hex = ref.replace(/^0x/, "").toLowerCase();
  if (!/^0{32}[0-9a-f]{32}$/.test(hex)) return null;
  const u = hex.slice(32);
  return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
}

export function txUrl(hash: string): string {
  return `${ARC.explorer}/tx/${hash}`;
}

export function addressUrl(addr: string): string {
  return `${ARC.explorer}/address/${addr}`;
}
