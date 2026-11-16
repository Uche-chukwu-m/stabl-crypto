import { createHash } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { ARC, chain, type Address, type Hex } from "./config";

// Circle developer-controlled wallets. Stabl never holds a private key: Circle
// signs, and for the smart contract accounts people get, Circle's Gas Station
// pays the network fee. Server only.

type Circle = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
const globalForCircle = globalThis as unknown as { stablCircle?: Circle };

export function circle(): Circle {
  if (globalForCircle.stablCircle) return globalForCircle.stablCircle;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are not set");
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  globalForCircle.stablCircle = client;
  return client;
}

// Circle wants a UUID for every idempotency key. Deriving it from our own ids
// means a retried request is recognised as the same request, not a second move.
export function idempotencyKey(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type ChainWallet = { id: string; address: Address };

// One smart contract account per person, found again by our own user id.
export async function ensureUserWallet(userId: string, label: string): Promise<ChainWallet> {
  return ensureWallet(`user:${userId}`, label, "SCA");
}

export async function ensureWallet(refId: string, name: string, accountType: "SCA" | "EOA"): Promise<ChainWallet> {
  const walletSetId = chain.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set");
  const found = (await circle().listWallets({ walletSetId, refId, blockchain: ARC.blockchain })).data?.wallets ?? [];
  const wallet =
    found[0] ??
    (
      await circle().createWallets({
        walletSetId,
        blockchains: [ARC.blockchain],
        count: 1,
        accountType,
        metadata: [{ name, refId }],
        idempotencyKey: idempotencyKey("wallet", refId),
      })
    ).data?.wallets?.[0];
  if (!wallet) throw new Error("Circle did not return a wallet");
  return { id: wallet.id, address: wallet.address as Address };
}

export type Call =
  | { abiFunctionSignature: string; abiParameters: (string | number | boolean)[] }
  | { callData: Hex };

// Ask a Circle wallet to call a contract. Returns Circle's transaction id at
// once; the transaction itself lands on Arc a moment later.
export async function execute(input: {
  walletId: string;
  contractAddress: Address;
  call: Call;
  // Parts of the idempotency key, for example ["move", moveId].
  key: string[];
  refId?: string;
}): Promise<string> {
  const res = await circle().createContractExecutionTransaction({
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    ...input.call,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: idempotencyKey(...input.key),
    refId: input.refId,
  } as Parameters<Circle["createContractExecutionTransaction"]>[0]);
  const id = res.data?.id;
  if (!id) throw new Error("Circle did not return a transaction id");
  return id;
}

export type TxStatus = {
  id: string;
  state: string;
  txHash: Hex | null;
  blockHeight: number | null;
  error: string | null;
  // True once the transaction can no longer succeed.
  failed: boolean;
  // True once it is in a block.
  landed: boolean;
};

const LANDED = new Set(["CONFIRMED", "COMPLETE"]);
const FAILED = new Set(["FAILED", "DENIED", "CANCELLED"]);

export async function txStatus(id: string): Promise<TxStatus> {
  const tx = (await circle().getTransaction({ id })).data?.transaction;
  if (!tx) throw new Error("Circle did not return the transaction");
  return {
    id,
    state: tx.state,
    txHash: (tx.txHash as Hex | undefined) ?? null,
    blockHeight: tx.blockHeight ?? null,
    error: tx.errorReason ?? tx.errorDetails ?? null,
    failed: FAILED.has(tx.state),
    landed: LANDED.has(tx.state),
  };
}

// For scripts and the fallback path: wait until a transaction lands or fails.
export async function waitForTx(id: string, timeoutMs = 60_000): Promise<TxStatus> {
  const started = Date.now();
  for (;;) {
    const status = await txStatus(id);
    if (status.landed || status.failed) return status;
    if (Date.now() - started > timeoutMs) return status;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
