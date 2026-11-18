import { and, eq, lt, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { decodeVaultLogs, readVault, vaultEventsInTx, type RawLog, type VaultEvent } from "@/lib/chain/arc";
import { execute, txStatus, waitForTx } from "@/lib/chain/circle";
import { ARC, centsToUnits, chain, moveRef, refToMoveId, type Address, type Hex } from "@/lib/chain/config";
import { db } from "@/lib/db";
import { chainEvents, chainOps, chainWallets, ledgerEntries, moves, vaultAccounts, vaultBalances } from "@/lib/db/schema";
import { afterMoveSettled, unfinishedFollowUps } from "@/lib/move-receipts";
import { notify } from "@/lib/notify";
import { sendToBankSide, submitMove, walletFor } from "@/lib/vault/arc";

// Turning what happened on Arc into what the app shows.
//
// There is one way a move becomes "settled" on Arc: applyVaultEvent() sees the
// vault contract's own event for it. Two things feed it the same events:
//   stream     the QuickNode Stream posts each event to /api/chain/stream
//   reconcile  the fallback, which asks Circle for the transaction and reads its
//              receipt from Arc. It covers local development (no public URL for
//              a webhook) and any event the Stream is slow to deliver.
// Whichever arrives first settles the move. The other is a harmless duplicate,
// because chain_events has one row per (transaction, log).

export type EventSource = "stream" | "backfill" | "reconcile";
export type Applied = "settled" | "recorded" | "duplicate" | "mismatch";

const DIRECTION = { Deposited: "buffer", Released: "release", EmergencyUnlocked: "emergency" } as const;

export async function applyVaultEvent(ev: VaultEvent, source: EventSource): Promise<Applied> {
  const owner = ev.owner.toLowerCase();
  const [wallet] = await db.select().from(chainWallets).where(eq(chainWallets.address, owner));
  const userId = wallet?.userId ?? null;
  const refId = ev.ref ? refToMoveId(ev.ref) : null;

  const outcome = await db.transaction(async (tx) => {
    const move = refId ? (await tx.select().from(moves).where(eq(moves.id, refId)).for("update"))[0] : undefined;
    const [row] = await tx
      .insert(chainEvents)
      .values({
        txHash: ev.txHash,
        logIndex: ev.logIndex,
        blockNumber: Number(ev.blockNumber),
        name: ev.name,
        owner,
        units: ev.units?.toString() ?? null,
        ref: ev.ref,
        balanceUnits: ev.balanceUnits?.toString() ?? null,
        userId,
        moveId: move?.id ?? null,
        source,
      })
      .onConflictDoNothing()
      .returning({ id: chainEvents.id });
    if (!row) return { kind: "duplicate" as const, moveId: move?.id ?? null };

    if (ev.name === "Frozen" || ev.name === "Unfrozen") return { kind: "freeze" as const };

    if (!move) {
      // Not a move: an opening balance carried onto Arc, or a vault being closed.
      if (refId) await tx.update(chainOps).set({ state: "landed", txHash: ev.txHash }).where(eq(chainOps.id, refId));
      return { kind: "recorded" as const };
    }

    const matches = move.direction === DIRECTION[ev.name] && userId === move.userId && ev.units === centsToUnits(move.amountCents);
    if (!matches) return { kind: "mismatch" as const, moveId: move.id };
    if (move.state === "settled") return { kind: "recorded" as const };

    await tx
      .insert(ledgerEntries)
      .values({
        vaultId: move.vaultId,
        moveId: move.id,
        kind: move.direction,
        amountCents: move.direction === "buffer" ? move.amountCents : -move.amountCents,
        entryDate: move.settleOn,
      })
      .onConflictDoNothing();
    await tx
      .update(moves)
      .set({ state: "settled", settledAt: new Date(), txHash: ev.txHash, chainBlock: Number(ev.blockNumber), confirmedBy: source, cancelReason: null })
      .where(eq(moves.id, move.id));
    return { kind: "settled" as const, move };
  });

  if (outcome.kind === "duplicate") {
    // Seen before. If what followed the first delivery did not finish (say the
    // receipt failed to send), this delivery is the chance to finish it.
    if (outcome.moveId) await followUp(outcome.moveId);
    return "duplicate";
  }

  if (outcome.kind === "freeze") {
    // The contract is the record. Read its state now, so events that arrive out
    // of order still leave the app matching Arc.
    if (userId) {
      const { frozen } = await readVault(owner as Address);
      await db.update(vaultAccounts).set({ status: frozen ? "frozen" : "locked" }).where(eq(vaultAccounts.userId, userId));
      await audit(userId, "engine", ev.name === "Frozen" ? "frozen_on_arc" : "unfrozen_on_arc", { txHash: ev.txHash, source });
    }
    return "recorded";
  }

  if (outcome.kind === "mismatch") {
    await audit(userId, "engine", "chain_mismatch", { moveId: outcome.moveId, event: ev.name, txHash: ev.txHash, units: ev.units?.toString() });
    return "mismatch";
  }

  if (outcome.kind === "settled") {
    await followUp(outcome.move.id);
    return "settled";
  }
  return "recorded";
}

function followUp(moveId: string) {
  return afterMoveSettled(moveId, { offramp: sendToBankSide });
}

// Finish follow-ups left undone by an earlier failure. Each one is retried on
// its own, so one stuck move cannot hold up the rest.
export async function finishFollowUps(userId?: string): Promise<number> {
  let failed = 0;
  for (const { id } of await unfinishedFollowUps(userId)) {
    try {
      await followUp(id);
    } catch (error) {
      failed++;
      console.error("follow-up failed", id, (error as Error).message);
    }
  }
  return failed;
}

// Raw logs in, vault events applied in chain order. Used by the Stream webhook.
export async function ingestLogs(logs: RawLog[], source: EventSource) {
  const events = decodeVaultLogs(logs).sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const results: Applied[] = [];
  for (const ev of events) results.push(await applyVaultEvent(ev, source));
  return results;
}

type PendingMove = typeof moves.$inferSelect;

// The fallback for one move: ask Circle where its transaction is, and if it has
// landed, read the contract's events from the receipt.
export async function reconcileMove(move: PendingMove, waitMs: number): Promise<void> {
  let chainTxId = move.chainTxId;
  if (!chainTxId && move.txHash) {
    // Signed in the person's browser with their passkey: no Circle request to
    // ask about, so read the transaction straight from Arc.
    await applyTx(move.txHash as Hex);
    return;
  }
  if (!chainTxId) {
    if ((await walletFor(move.userId)).kind === "passkey") {
      // Waiting on the person's passkey. Give up if they never approve it.
      const waiting = Date.now() - (move.submittedAt?.getTime() ?? Date.now());
      if (waiting > 15 * 60_000) await failMove(move, "not approved with the passkey");
      return;
    }
    // The request to Circle never finished. The idempotency key is the move's
    // id, so sending again cannot create a second transaction.
    chainTxId = await submitMove(move);
    await db.update(moves).set({ chainTxId }).where(eq(moves.id, move.id));
  }
  const status = waitMs > 0 ? await waitForTx(chainTxId, waitMs) : await txStatus(chainTxId);
  if (status.failed) {
    await failMove(move, status.error ?? status.state);
    return;
  }
  if (!status.landed || !status.txHash) return;

  let events: VaultEvent[];
  try {
    events = await vaultEventsInTx(status.txHash);
  } catch {
    return; // Arc's node has not caught up with Circle yet. Next pass.
  }
  for (const ev of events) await applyVaultEvent(ev, "reconcile");
  if (!events.some((ev) => ev.ref === moveRef(move.id))) await failMove(move, "no vault event in the transaction");
}

// Apply every vault event in one transaction, read from Arc.
export async function applyTx(txHash: Hex): Promise<VaultEvent[]> {
  let events: VaultEvent[] = [];
  try {
    events = await vaultEventsInTx(txHash);
  } catch {
    return []; // Not visible on Arc's node yet. A later pass picks it up.
  }
  for (const ev of events) await applyVaultEvent(ev, "reconcile");
  return events;
}

async function failMove(move: PendingMove, why: string) {
  const [cancelled] = await db
    .update(moves)
    .set({ state: "cancelled", cancelReason: "chain_failed" })
    .where(and(eq(moves.id, move.id), eq(moves.state, "settling")))
    .returning();
  if (!cancelled) return;
  await audit(move.userId, "engine", `${move.direction}_failed`, { moveId: move.id, why, chainTxId: move.chainTxId });
  if (move.direction === "buffer") {
    await notify(move.userId, "buffer_skipped", { reason: "not_completed", amountCents: move.amountCents }, { moveId: move.id });
  } else {
    await notify(move.userId, "move_failed", { amountCents: move.amountCents }, { moveId: move.id });
  }
}

// How long to wait for the Stream before the fallback reads Arc itself. Zero
// where no Stream can reach the app, such as local development.
function streamGraceMs(): number {
  const set = process.env.STREAM_GRACE_MS;
  if (set && /^\d+$/.test(set)) return Number(set);
  return process.env.VERCEL_ENV === "production" && process.env.QUICKNODE_STREAM_TOKEN ? 10_000 : 0;
}

// Wait for everything a person has on its way to Arc. The daily job and the
// engine call this first, so they never decide on a balance that is about to
// change. Returns how many moves are still unsettled.
export async function settlePending(userId: string, opts: { waitMs?: number } = {}): Promise<number> {
  if (!chain.enabled) return 0;
  await finishFollowUps(userId);
  const unsettled = () => db.select().from(moves).where(and(eq(moves.userId, userId), eq(moves.state, "settling")));
  let pending = await unsettled();
  // Where the QuickNode Stream is running, give it the first chance: its
  // webhook settles the move in another request, and this one just watches.
  // The fallback below only steps in for whatever is left after that.
  const until = Date.now() + streamGraceMs();
  while (pending.length > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    pending = await unsettled();
  }
  for (const move of pending) {
    try {
      await reconcileMove(move, opts.waitMs ?? 45_000);
    } catch (error) {
      console.error("reconcile failed", move.id, (error as Error).message);
    }
  }
  if (pending.length === 0) return 0;
  const [{ left }] = await db
    .select({ left: sql<number>`count(*)::int` })
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.state, "settling")));
  return left;
}

// A light check while someone has the app open: a move sent more than a few
// seconds ago with no event yet gets one look from the fallback, without waiting.
export async function nudgePending(userId: string, olderThanMs = 12_000): Promise<void> {
  if (!chain.enabled) return;
  await finishFollowUps(userId);
  const before = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.state, "settling"), lt(moves.submittedAt, before)));
  for (const move of stale) {
    try {
      await reconcileMove(move, 0);
    } catch (error) {
      console.error("nudge failed", move.id, (error as Error).message);
    }
  }

  // The same for a freeze, an unfreeze, or USDC on its way back to the bank side.
  const ops = await db
    .select()
    .from(chainOps)
    .where(and(eq(chainOps.userId, userId), eq(chainOps.state, "sent"), lt(chainOps.createdAt, before)));
  for (const op of ops) {
    try {
      if (!op.chainTxId) {
        // Never reached Circle. After a few minutes there is nothing to wait for.
        if (op.createdAt < new Date(Date.now() - 5 * 60_000)) await db.update(chainOps).set({ state: "failed" }).where(eq(chainOps.id, op.id));
        continue;
      }
      const status = await txStatus(op.chainTxId);
      if (status.failed) {
        await db.update(chainOps).set({ state: "failed" }).where(eq(chainOps.id, op.id));
      } else if (status.landed && status.txHash) {
        for (const ev of await vaultEventsInTx(status.txHash)) await applyVaultEvent(ev, "reconcile");
        await db.update(chainOps).set({ state: "landed", txHash: status.txHash }).where(eq(chainOps.id, op.id));
      }
    } catch (error) {
      console.error("nudge failed", op.id, (error as Error).message);
    }
  }
}

// Make the contract hold exactly what the ledger says. Used after seeding the
// presenter account, whose history was written before it had a vault on Arc: the
// balance that history adds up to is carried over as one opening deposit.
export async function carryBalanceOntoArc(userId: string): Promise<{ txHash: string | null; units: bigint } | null> {
  if (!chain.enabled) return null;
  const vaultAddress = chain.vaultAddress!;
  const operatorWalletId = chain.operatorWalletId!;
  const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
  if (!v) return null;
  const owner = await walletFor(userId);
  if (owner.kind === "passkey") throw new Error("A passkey vault is moved by its owner, not carried over by Stabl.");
  const [bal] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, v.id));
  const want = centsToUnits(bal?.balanceCents ?? 0);
  const onChain = await readVault(owner.address);

  if (onChain.frozen) {
    // Left frozen by an earlier run of the same presenter wallet.
    const id = await execute({
      walletId: owner.id,
      contractAddress: vaultAddress,
      call: { abiFunctionSignature: "unfreeze()", abiParameters: [] },
      key: ["reseed-unfreeze", userId],
    });
    await waitForTx(id, 60_000);
  }
  if (onChain.units === want) return { txHash: null, units: want };

  const adding = want > onChain.units;
  const delta = adding ? want - onChain.units : onChain.units - want;
  const [op] = await db
    .insert(chainOps)
    .values({ userId, kind: adding ? "opening" : "close", units: delta.toString() })
    .returning();
  const id = await execute({
    walletId: operatorWalletId,
    contractAddress: vaultAddress,
    call: {
      abiFunctionSignature: adding ? "deposit(address,uint256,bytes32)" : "release(address,uint256,bytes32)",
      abiParameters: [owner.address, delta.toString(), moveRef(op.id)],
    },
    key: ["op", op.id],
    refId: `${adding ? "opening" : "close"} ${userId}`,
  });
  await db.update(chainOps).set({ chainTxId: id }).where(eq(chainOps.id, op.id));
  const status = await waitForTx(id, 90_000);
  if (!status.landed) {
    await db.update(chainOps).set({ state: "failed" }).where(eq(chainOps.id, op.id));
    throw new Error(`Could not carry the balance onto Arc: ${status.state} ${status.error ?? ""}`.trim());
  }
  await db.update(chainOps).set({ state: "landed", txHash: status.txHash }).where(eq(chainOps.id, op.id));
  if (!adding) {
    // USDC that came out goes back to the operator, the bank side.
    const back = await execute({
      walletId: owner.id,
      contractAddress: ARC.usdc,
      call: { abiFunctionSignature: "transfer(address,uint256)", abiParameters: [chain.operatorAddress!, delta.toString()] },
      key: ["op-return", op.id],
    });
    await waitForTx(back, 60_000);
  }
  return { txHash: status.txHash, units: want };
}
