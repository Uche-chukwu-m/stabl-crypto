import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { execute, ensureWallet, waitForTx } from "@/lib/chain/circle";
import { ARC, centsToUnits, chain, moveRef, type Address } from "@/lib/chain/config";
import { db } from "@/lib/db";
import { chainOps, chainWallets, ledgerEntries, moves, users, vaultAccounts } from "@/lib/db/schema";
import { MockVaultProvider } from "./mock";
import { VaultError, type Move, type VaultAccount } from "./provider";

// The vault on Arc. Money is USDC held by the StablVault contract, owned on chain
// by each person's hidden Circle wallet.
//
// The difference from the simulated vault is when a move counts as done. Here
// buffer() and release() only send the transaction and mark the move "settling".
// The ledger entry and the receipt are written when the contract's event comes
// back (lib/chain/settle.ts), so the app never says money moved before Arc does.
//
// Balances and the ledger are read the same way as before: the ledger is the
// app's copy of the contract's events, and its sum is the balance.
export class ArcVaultProvider extends MockVaultProvider {
  protected partnerLabel = "Stabl Vault";

  async openAccount(userId: string, legalName: string): Promise<VaultAccount> {
    const account = await super.openAccount(userId, legalName);
    await walletFor(userId);
    return account;
  }

  buffer(vaultId: string, cents: number, moveId: string): Promise<Move> {
    return this.send(vaultId, cents, moveId, "buffer");
  }

  release(vaultId: string, cents: number, moveId: string): Promise<Move> {
    return this.send(vaultId, cents, moveId, "release");
  }

  // Freezing takes effect in the app at once and on Arc a moment later. With a
  // Stabl-managed wallet the owner's wallet sends it. With a passkey wallet
  // Stabl cannot sign for the owner, so the operator freezes on their behalf,
  // which the contract allows because stopping is always safe.
  async freeze(vaultId: string): Promise<void> {
    await super.freeze(vaultId);
    const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.id, vaultId));
    if (!v) return;
    try {
      const wallet = await walletFor(v.userId);
      const [op] = await db.insert(chainOps).values({ userId: v.userId, kind: "freeze" }).returning();
      const id = await execute({
        walletId: wallet.kind === "passkey" ? requireOperatorWalletId() : wallet.id,
        contractAddress: requireVaultAddress(),
        call:
          wallet.kind === "passkey"
            ? { abiFunctionSignature: "freezeFor(address)", abiParameters: [wallet.address] }
            : { abiFunctionSignature: "freeze()", abiParameters: [] },
        key: ["op", op.id],
        refId: "freeze",
      });
      await db.update(chainOps).set({ chainTxId: id }).where(eq(chainOps.id, op.id));
    } catch (error) {
      // The app is already frozen, which stops every move. Arc catches up on the
      // next try; a failure here must not undo a freeze.
      console.error("freeze on Arc failed", (error as Error).message);
    }
  }

  // Unfreezing waits for Arc, so the next move cannot be refused by a vault that
  // is still frozen on chain.
  //
  // A passkey wallet has already unfrozen itself on Arc, signed in the person's
  // browser (lib/chain/passkey.ts), so only the app side is left to do.
  async unfreeze(vaultId: string): Promise<void> {
    const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.id, vaultId));
    const wallet = v ? await walletFor(v.userId) : null;
    if (v && wallet?.kind === "circle") {
      const [op] = await db.insert(chainOps).values({ userId: v.userId, kind: "unfreeze" }).returning();
      const id = await execute({
        walletId: wallet.id,
        contractAddress: requireVaultAddress(),
        call: { abiFunctionSignature: "unfreeze()", abiParameters: [] },
        key: ["op", op.id],
        refId: "unfreeze",
      });
      await db.update(chainOps).set({ chainTxId: id }).where(eq(chainOps.id, op.id));
      // The fallback in lib/chain/settle.ts records the event and marks this
      // landed, in case the Stream is not the first to report it.
      const status = await waitForTx(id, 45_000);
      await db
        .update(chainOps)
        .set({ state: status.failed ? "failed" : "sent", txHash: status.txHash })
        .where(eq(chainOps.id, op.id));
    }
    await super.unfreeze(vaultId);
  }

  private async send(vaultId: string, cents: number, moveId: string, side: "buffer" | "release"): Promise<Move> {
    const claimed = await db.transaction(async (tx) => {
      const [move] = await tx.select().from(moves).where(eq(moves.id, moveId)).for("update");
      if (!move || move.vaultId !== vaultId) throw new VaultError("bad_move", "Move does not belong to this vault");
      // Already sent or already done: a retry changes nothing.
      if (move.state === "settling" || move.state === "settled") return { move, previous: null };

      const isBuffer = move.direction === "buffer";
      if (isBuffer !== (side === "buffer") || move.amountCents !== cents) {
        throw new VaultError("bad_move", "Move does not match the request");
      }
      if (move.state === "cancelled") throw new VaultError("bad_move", "Move is cancelled");

      const [vault] = await tx.select().from(vaultAccounts).where(eq(vaultAccounts.id, vaultId)).for("update");
      if (vault.status === "frozen") throw new VaultError("frozen", "Vault is frozen");

      // Moves already on their way count, so two in flight cannot overdraw the
      // vault or pass the daily limit between them.
      const inFlight = await tx
        .select({ direction: moves.direction, amountCents: moves.amountCents, settleOn: moves.settleOn })
        .from(moves)
        .where(and(eq(moves.vaultId, vaultId), eq(moves.state, "settling"), ne(moves.id, moveId)));

      if (isBuffer) {
        const [user] = await tx.select({ limit: users.dailyLimitCents }).from(users).where(eq(users.id, move.userId));
        const [{ today }] = await tx
          .select({ today: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.vaultId, vaultId), eq(ledgerEntries.kind, "buffer"), eq(ledgerEntries.entryDate, move.settleOn)));
        const pending = inFlight.filter((m) => m.direction === "buffer" && m.settleOn === move.settleOn).reduce((s, m) => s + m.amountCents, 0);
        if (today + pending + cents > user.limit) throw new VaultError("daily_limit", "Daily limit reached");
      } else {
        const [{ balance }] = await tx
          .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.vaultId, vaultId));
        const leaving = inFlight.filter((m) => m.direction !== "buffer").reduce((s, m) => s + m.amountCents, 0);
        if (balance - leaving < cents) throw new VaultError("insufficient", "Not enough in the vault");
      }

      const [settling] = await tx
        .update(moves)
        .set({ state: "settling", submittedAt: new Date() })
        .where(eq(moves.id, moveId))
        .returning();
      return { move: settling, previous: move.state };
    });

    if (claimed.previous === null) return claimed.move;
    // An emergency unlock from a passkey wallet is signed in the person's
    // browser, not here. The move waits, settling, for that signature.
    if (claimed.move.direction === "emergency" && (await walletFor(claimed.move.userId)).kind === "passkey") return claimed.move;
    try {
      const chainTxId = await submitMove(claimed.move);
      const [sent] = await db.update(moves).set({ chainTxId }).where(eq(moves.id, moveId)).returning();
      return sent;
    } catch (error) {
      // Nothing was sent, so put the move back where it was for a later try.
      await db.update(moves).set({ state: claimed.previous, submittedAt: null }).where(and(eq(moves.id, moveId), eq(moves.state, "settling")));
      throw error;
    }
  }
}

function requireOperatorWalletId(): string {
  const id = chain.operatorWalletId;
  if (!id) throw new Error("STABL_OPERATOR_WALLET_ID is not set");
  return id;
}

function requireVaultAddress(): Address {
  const address = chain.vaultAddress;
  if (!address) throw new Error("ARC_VAULT_ADDRESS is not set");
  return address;
}

export type OwnerWallet = { kind: "circle"; id: string; address: Address } | { kind: "passkey"; id: null; address: Address };

// The wallet that owns a person's vault on chain. A Stabl-managed one is
// created the first time it is needed; a person can later replace it with a
// passkey wallet only they can sign for. A demo persona keeps one wallet across
// reseeds, so its USDC is not left behind.
export async function walletFor(userId: string): Promise<OwnerWallet> {
  const [row] = await db.select().from(chainWallets).where(eq(chainWallets.userId, userId));
  if (row?.kind === "passkey") return { kind: "passkey", id: null, address: row.address as Address };
  if (row?.circleWalletId) return { kind: "circle", id: row.circleWalletId, address: row.address as Address };
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("No such user");
  // The presenter's wallet is named per environment, so a local test run and the
  // live site never share one vault on chain.
  const place = process.env.WALLET_NAMESPACE || (process.env.VERCEL_ENV === "production" ? "live" : "dev");
  const refId = user.isDemo && user.personaKey ? `persona:${place}:${user.email}` : `user:${user.id}`;
  const wallet = await ensureWallet(refId, user.isDemo ? `Presenter ${user.personaKey}` : "Stabl member", "SCA");
  const address = wallet.address.toLowerCase();
  // A reseeded persona's old row is gone with the old user, but be safe.
  await db.delete(chainWallets).where(and(eq(chainWallets.circleWalletId, wallet.id), ne(chainWallets.userId, userId)));
  await db
    .insert(chainWallets)
    .values({ userId, circleWalletId: wallet.id, address, blockchain: ARC.blockchain })
    .onConflictDoNothing();
  return { kind: "circle", id: wallet.id, address: address as Address };
}

// Send the transaction for a move. The idempotency key is the move's id, so
// sending twice is the same transaction to Circle, never a second one.
export async function submitMove(move: { id: string; userId: string; direction: "buffer" | "release" | "emergency"; amountCents: number }): Promise<string> {
  const vaultAddress = requireVaultAddress();
  const operatorWalletId = chain.operatorWalletId;
  if (!operatorWalletId) throw new Error("STABL_OPERATOR_WALLET_ID is not set");
  const owner = await walletFor(move.userId);
  const units = centsToUnits(move.amountCents).toString();
  const ref = moveRef(move.id);

  if (move.direction === "buffer") {
    // The operator stands in for the bank side: the dollars leaving checking
    // arrive as USDC, credited to the owner.
    return execute({
      walletId: operatorWalletId,
      contractAddress: vaultAddress,
      call: { abiFunctionSignature: "deposit(address,uint256,bytes32)", abiParameters: [owner.address, units, ref] },
      key: ["move", move.id],
      refId: `buffer ${move.id}`,
    });
  }
  if (move.direction === "release") {
    return execute({
      walletId: operatorWalletId,
      contractAddress: vaultAddress,
      call: { abiFunctionSignature: "release(address,uint256,bytes32)", abiParameters: [owner.address, units, ref] },
      key: ["move", move.id],
      refId: `release ${move.id}`,
    });
  }
  // Emergency unlock is the owner's own exit: their wallet sends it, not the
  // operator. A passkey wallet signs it in the person's browser instead.
  if (owner.kind === "passkey") throw new Error("An emergency unlock from a passkey wallet is signed by its owner");
  return execute({
    walletId: owner.id,
    contractAddress: vaultAddress,
    call: { abiFunctionSignature: "emergencyUnlock(uint256,bytes32)", abiParameters: [units, ref] },
    key: ["move", move.id],
    refId: `emergency ${move.id}`,
  });
}

// After a release lands, the USDC is in the owner's wallet. Send it back to the
// operator, which stands in for turning it into dollars in checking.
export async function sendToBankSide(move: { id: string; userId: string; amountCents: number }): Promise<void> {
  const operator = chain.operatorAddress;
  if (!operator) return;
  const [already] = await db
    .select({ id: chainOps.id })
    .from(chainOps)
    .where(and(eq(chainOps.moveId, move.id), eq(chainOps.kind, "offramp"), inArray(chainOps.state, ["sent", "landed"])));
  if (already) return;
  const owner = await walletFor(move.userId);
  // A passkey wallet's USDC is the person's to move; Stabl cannot sign for it,
  // so the released money simply stays in their own wallet.
  if (owner.kind === "passkey") return;
  const units = centsToUnits(move.amountCents).toString();
  const [op] = await db.insert(chainOps).values({ userId: move.userId, kind: "offramp", moveId: move.id, units }).returning();
  try {
    const id = await execute({
      walletId: owner.id,
      contractAddress: ARC.usdc,
      call: { abiFunctionSignature: "transfer(address,uint256)", abiParameters: [operator, units] },
      key: ["offramp", move.id],
      refId: `offramp ${move.id}`,
    });
    await db.update(chainOps).set({ chainTxId: id }).where(eq(chainOps.id, op.id));
  } catch (error) {
    await db.update(chainOps).set({ state: "failed" }).where(eq(chainOps.id, op.id));
    // Thrown, so the move keeps this step open and it is tried again later.
    throw error;
  }
}
