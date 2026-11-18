import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { audit } from "@/lib/audit";
import { arc, readVault, type VaultEvent } from "@/lib/chain/arc";
import { execute, waitForTx } from "@/lib/chain/circle";
import { ARC, centsToUnits, chain, moveRef, type Address, type Hex } from "@/lib/chain/config";
import { applyTx } from "@/lib/chain/settle";
import { vaultAbi } from "@/lib/chain/vault-abi";
import { checkCode, issueCode } from "@/lib/codes";
import { db } from "@/lib/db";
import { chainOps, chainWallets, moves, vaultAccounts } from "@/lib/db/schema";
import { withUserLock } from "@/lib/engine-runner";
import { notify } from "@/lib/notify";
import { walletFor } from "@/lib/vault/arc";

// Passkey wallets: a Circle modular smart account whose only signer is a passkey
// on the person's device. Once a vault belongs to one, Stabl cannot unfreeze it
// or take money out of it; only the person can, by approving with Face ID or a
// fingerprint. Set-asides and releases stay automatic, because the contract lets
// Stabl's operator do those, but only ever back to the owner.

export type SignRequest = { to: Address; data: Hex; label: string };

const message = (nonce: string) => `Stabl: use this passkey wallet as the owner of my vault. ${nonce}`;

// Step 1 of linking: a one-time challenge the new wallet signs, proving the
// person holds the passkey behind the address they send.
export async function passkeyChallenge(userId: string): Promise<{ message: string }> {
  const nonce = randomBytes(12).toString("hex");
  await issueCode(userId, "passkey", { code: nonce, sentTo: ["browser"], ttlMinutes: 10 });
  return { message: message(nonce) };
}

// Step 2: check the signature, then move the vault from the Stabl-managed wallet
// to the passkey wallet. The balance moves on chain, in three transactions: the
// operator releases it to the old wallet, the old wallet hands the USDC back,
// and the operator deposits it for the new owner. The app's ledger does not
// change, because it is the same person's money throughout.
export async function linkPasskeyWallet(userId: string, address: Address, signedMessage: string, signature: Hex) {
  const nonce = signedMessage.match(/ ([0-9a-f]{24})$/)?.[1];
  if (!nonce || signedMessage !== message(nonce)) throw new PasskeyError("That is not the message Stabl asked you to sign.");
  if (!(await checkCode(userId, "passkey", nonce)).ok) throw new PasskeyError("That request expired. Try again.");
  const valid = await arc().verifyMessage({ address, message: signedMessage, signature });
  if (!valid) throw new PasskeyError("The passkey signature did not check out.");

  return withUserLock(userId, async () => {
    const old = await walletFor(userId);
    const to = address.toLowerCase() as Address;
    if (old.kind === "passkey") {
      if (old.address === to) return { moved: 0n };
      throw new PasskeyError("Your vault already belongs to a passkey wallet.");
    }
    const [busy] = await db.select({ id: moves.id }).from(moves).where(and(eq(moves.userId, userId), eq(moves.state, "settling")));
    if (busy) throw new PasskeyError("A move is on its way. Try again in a minute.");

    const vault = chain.vaultAddress!;
    const operatorWalletId = chain.operatorWalletId!;
    const before = await readVault(old.address);
    // One on-chain step, recorded as a chain op. `call` gets the op's own
    // reference, which the vault contract records with the move.
    const step = async (
      kind: "passkey_out" | "passkey_return" | "passkey_in",
      walletId: string,
      contractAddress: Address,
      call: (ref: Hex) => { abiFunctionSignature: string; abiParameters: string[] },
    ) => {
      const [op] = await db.insert(chainOps).values({ userId, kind, units: before.units.toString() }).returning();
      const id = await execute({ walletId, contractAddress, call: call(moveRef(op.id)), key: ["op", op.id], refId: kind });
      const status = await waitForTx(id, 90_000);
      await db.update(chainOps).set({ chainTxId: id, state: status.landed ? "landed" : "failed", txHash: status.txHash }).where(eq(chainOps.id, op.id));
      if (!status.landed) throw new Error(`${kind} did not land: ${status.state} ${status.error ?? ""}`.trim());
    };

    if (before.frozen) {
      // The old wallet unfreezes itself first, so its balance can move. The new
      // wallet is frozen again below if the vault was frozen in the app.
      await step("passkey_out", old.id, vault, () => ({ abiFunctionSignature: "unfreeze()", abiParameters: [] }));
    }
    if (before.units > 0n) {
      const units = before.units.toString();
      await step("passkey_out", operatorWalletId, vault, (ref) => ({ abiFunctionSignature: "release(address,uint256,bytes32)", abiParameters: [old.address, units, ref] }));
      await step("passkey_return", old.id, ARC.usdc, () => ({ abiFunctionSignature: "transfer(address,uint256)", abiParameters: [chain.operatorAddress!, units] }));
      await step("passkey_in", operatorWalletId, vault, (ref) => ({ abiFunctionSignature: "deposit(address,uint256,bytes32)", abiParameters: [to, units, ref] }));
    }

    await db
      .update(chainWallets)
      .set({ kind: "passkey", address: to, circleWalletId: null, previousAddress: old.address, previousCircleWalletId: old.id, passkeyAt: new Date() })
      .where(eq(chainWallets.userId, userId));

    const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
    if (v?.status === "frozen") {
      const id = await execute({
        walletId: operatorWalletId,
        contractAddress: vault,
        call: { abiFunctionSignature: "freezeFor(address)", abiParameters: [to] },
        key: ["passkey-freeze", userId, to],
      });
      await waitForTx(id, 60_000);
    }

    const after = await readVault(to);
    await audit(userId, "user", "passkey_linked", { address: to, from: old.address, units: before.units.toString() });
    await notify(userId, "passkey_linked", {});
    return { moved: after.units };
  });
}

// What the person's passkey has to sign for an emergency unlock that is waiting
// on it. The move already exists, settling; this is its transaction.
export async function emergencySignRequest(userId: string, moveId: string): Promise<SignRequest> {
  const [move] = await db.select().from(moves).where(and(eq(moves.id, moveId), eq(moves.userId, userId)));
  if (!move || move.direction !== "emergency" || move.state !== "settling") throw new PasskeyError("There is no unlock waiting for your passkey.");
  return {
    to: chain.vaultAddress!,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "emergencyUnlock", args: [centsToUnits(move.amountCents), moveRef(move.id)] }),
    label: "emergency",
  };
}

// Unfreezing a passkey vault: the code proves it is the person asking, and the
// passkey proves it is their device. Stabl cannot do either on its own.
export async function unfreezeSignRequest(userId: string, code: string): Promise<SignRequest | null> {
  const wallet = await walletFor(userId);
  if (wallet.kind !== "passkey") return null;
  const check = await checkCode(userId, "unfreeze", code);
  if (!check.ok) throw new PasskeyError("That code did not match or has expired.");
  return { to: chain.vaultAddress!, data: encodeFunctionData({ abi: vaultAbi, functionName: "unfreeze" }), label: "unfreeze" };
}

// After the browser sends a signed transaction: read it from Arc and apply its
// vault events, so the move settles (or the vault unfreezes) without waiting for
// the Stream. Only events for this person's own wallet are accepted.
export async function confirmSigned(userId: string, txHash: Hex, opts: { moveId?: string; unfreeze?: boolean }) {
  const wallet = await walletFor(userId);
  if (wallet.kind !== "passkey") throw new PasskeyError("This vault does not use a passkey.");
  if (opts.moveId) {
    await db
      .update(moves)
      .set({ txHash })
      .where(and(eq(moves.id, opts.moveId), eq(moves.userId, userId), eq(moves.state, "settling")));
  }
  let events: VaultEvent[] = [];
  for (let attempt = 0; attempt < 10 && events.length === 0; attempt++) {
    events = (await applyTx(txHash)).filter((e) => e.owner.toLowerCase() === wallet.address);
    if (events.length === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  if (opts.unfreeze && events.some((e) => e.name === "Unfrozen")) {
    const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
    if (v) await db.update(vaultAccounts).set({ status: "locked" }).where(eq(vaultAccounts.id, v.id));
    await audit(userId, "user", "unfrozen", { txHash, by: "passkey" });
    await notify(userId, "unfrozen", {});
  }
  return { events: events.map((e) => e.name) };
}

export class PasskeyError extends Error {}
