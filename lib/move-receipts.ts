import { and, eq, isNull, lt, or } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { checkingBalance } from "@/lib/balances";
import { mirrorVaultMove } from "@/lib/bank-mirror";
import { accountLabel, loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { moves } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { vault } from "@/lib/vault";

type Step = "mirror" | "receipt" | "offramp";
const CLAIM_MS = 2 * 60_000;

// What follows a move once it has settled: the bank side of it, the audit trail,
// the receipt, and on Arc the USDC going back to the bank side after a release.
//
// Each step is recorded as it finishes. A step that throws leaves the move with
// follow-ups still to do, and finishFollowUps() picks it up again later. A claim
// on the row stops two callers (the Stream's webhook and the fallback) from
// running the same steps at once.
export async function afterMoveSettled(moveId: string, opts: { offramp?: (move: typeof moves.$inferSelect) => Promise<void> } = {}) {
  const now = new Date();
  const [move] = await db
    .update(moves)
    .set({ followUpsClaimedAt: now })
    .where(
      and(
        eq(moves.id, moveId),
        eq(moves.state, "settled"),
        isNull(moves.followUpsDoneAt),
        or(isNull(moves.followUpsClaimedAt), lt(moves.followUpsClaimedAt, new Date(now.getTime() - CLAIM_MS))),
      ),
    )
    .returning();
  if (!move) return;

  const done = { ...(move.followUpsJson ?? {}) };
  const mark = async (step: Step) => {
    done[step] = true;
    await db.update(moves).set({ followUpsJson: done }).where(eq(moves.id, moveId));
  };

  try {
    const ctx = await loadContext(move.userId);
    if (!ctx.homeBase || !ctx.vault) {
      await db.update(moves).set({ followUpsClaimedAt: null }).where(eq(moves.id, moveId));
      return;
    }
    const home = ctx.homeBase;
    const userId = move.userId;
    const amountCents = move.amountCents;
    const isBuffer = move.direction === "buffer";
    const proof = move.txHash ? { txHash: move.txHash, confirmedBy: move.confirmedBy } : {};

    if (!done.mirror) {
      await mirrorVaultMove(home, ctx.today, isBuffer ? -amountCents : amountCents);
      await mark("mirror");
    }

    if (!done.receipt) {
      const vaultCents = await vault.getBalance(ctx.vault.id);
      if (isBuffer) {
        const checkingCents = await checkingBalance(home, ctx.today, ctx.vault.id);
        await audit(userId, "engine", "buffer_settled", { moveId, amountCents, ...proof });
        await notify(userId, "buffer_settled", { amountCents, vaultCents, checkingCents }, { moveId });
      } else {
        await audit(userId, move.direction === "emergency" ? "user" : "engine", `${move.direction}_settled`, { moveId, amountCents, reason: move.reason, ...proof });
        const label = accountLabel(home);
        const shortByCents = move.metaJson?.shortByCents ?? 0;
        if (move.direction === "emergency") {
          await notify(userId, "emergency_settled", { amountCents, account: label, vaultCents }, { moveId });
        } else if (shortByCents > 0 && vaultCents === 0) {
          await notify(userId, "release_short", { amountCents, shortByCents }, { moveId });
        } else {
          await notify(userId, "release", { amountCents, account: label, vaultCents, unusual: move.reason === "unusual_drop" }, { moveId });
        }
      }
      await mark("receipt");
    }

    // Only a move that went through Arc has USDC to send back.
    if (!isBuffer && move.chainTxId && opts.offramp && !done.offramp) {
      await opts.offramp(move);
      await mark("offramp");
    }

    await db.update(moves).set({ followUpsDoneAt: new Date(), followUpsClaimedAt: null }).where(eq(moves.id, moveId));
  } catch (error) {
    // Let the next caller try again straight away rather than after the claim expires.
    await db.update(moves).set({ followUpsClaimedAt: null }).where(eq(moves.id, moveId));
    throw error;
  }
}

// Settled moves whose follow-ups did not all finish. Run by the daily job, by
// the fallback, and whenever the Stream redelivers an event already recorded.
export async function unfinishedFollowUps(userId?: string) {
  return db
    .select({ id: moves.id })
    .from(moves)
    .where(
      and(
        eq(moves.state, "settled"),
        isNull(moves.followUpsDoneAt),
        lt(moves.settledAt, new Date(Date.now() - 5_000)),
        userId ? eq(moves.userId, userId) : undefined,
      ),
    );
}
