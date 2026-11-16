import { and, asc, desc, eq, lte } from "drizzle-orm";
import { addDays } from "@/engine/dates";
import { decide } from "@/engine/decide";
import { settleCheck } from "@/engine/settle";
import { audit } from "@/lib/audit";
import { checkingBalance } from "@/lib/balances";
import { mirrorVaultMove } from "@/lib/bank-mirror";
import { accountLabel, loadContext, type UserContext } from "@/lib/context";
import { db } from "@/lib/db";
import { moves } from "@/lib/db/schema";
import { loadEngineInputs } from "@/lib/engine-inputs";
import { notify } from "@/lib/notify";
import { refreshLiveBalance } from "@/lib/plaid/items";
import { vault } from "@/lib/vault/mock";
import { VaultError } from "@/lib/vault/provider";

// How a move behaves:
//   planned    the engine decided; checks run
//   announced  buffers only: the user is told, and it settles tomorrow (STOP works)
//   settled    the ledger is written; receipt sent
//   cancelled  the user tapped STOP, or the safety rule failed at settle time
// Releases go planned to settled at once: fast to give back.

function requireLoop(ctx: UserContext) {
  if (!ctx.homeBase || !ctx.vault) throw new Error("No home base or vault yet");
  return { home: ctx.homeBase, vaultRow: ctx.vault };
}

export async function announceBuffer(
  ctx: UserContext,
  amountCents: number,
  reason: string,
  opts: { shrunk?: boolean; silent?: boolean } = {},
) {
  const { home, vaultRow } = requireLoop(ctx);
  const [move] = await db
    .insert(moves)
    .values({
      userId: ctx.user.id,
      vaultId: vaultRow.id,
      homeBaseAccountId: home.id,
      direction: "buffer",
      amountCents,
      state: "planned",
      reason,
      plannedFor: ctx.today,
      settleOn: addDays(ctx.today, 1),
    })
    .returning();
  await db.update(moves).set({ state: "announced" }).where(eq(moves.id, move.id));
  await audit(ctx.user.id, "engine", "buffer_announced", { moveId: move.id, amountCents, reason });
  if (!opts.silent) {
    await notify(
      ctx.user.id,
      "buffer_announced",
      { amountCents, account: accountLabel(home), shrunk: Boolean(opts.shrunk) },
      { moveId: move.id },
    );
  }
  return move;
}

export async function releaseNow(
  ctx: UserContext,
  amountCents: number,
  direction: "release" | "emergency",
  reason: string,
  extra: { shortByCents?: number } = {},
) {
  const { home, vaultRow } = requireLoop(ctx);
  const [move] = await db
    .insert(moves)
    .values({
      userId: ctx.user.id,
      vaultId: vaultRow.id,
      homeBaseAccountId: home.id,
      direction,
      amountCents,
      state: "planned",
      reason,
      plannedFor: ctx.today,
      settleOn: ctx.today,
    })
    .returning();

  try {
    await vault.release(vaultRow.id, amountCents, move.id);
  } catch (error) {
    const why = error instanceof VaultError ? error.code : "error";
    await db.update(moves).set({ state: "cancelled", cancelReason: why }).where(eq(moves.id, move.id));
    await audit(ctx.user.id, "engine", `${direction}_failed`, { moveId: move.id, why });
    throw error;
  }

  await mirrorVaultMove(home, ctx.today, amountCents);
  const vaultCents = await vault.getBalance(vaultRow.id);
  await audit(ctx.user.id, direction === "emergency" ? "user" : "engine", `${direction}_settled`, {
    moveId: move.id,
    amountCents,
    reason,
  });

  const label = accountLabel(home);
  if (direction === "emergency") {
    await notify(ctx.user.id, "emergency_settled", { amountCents, account: label, vaultCents }, { moveId: move.id });
  } else if (extra.shortByCents && extra.shortByCents > 0 && vaultCents === 0) {
    await notify(ctx.user.id, "release_short", { amountCents, shortByCents: extra.shortByCents }, { moveId: move.id });
  } else {
    await notify(
      ctx.user.id,
      "release",
      { amountCents, account: label, vaultCents, unusual: reason === "unusual_drop" },
      { moveId: move.id },
    );
  }
  return move;
}

// STOP: cancel an announced buffer before it settles.
export async function stopBuffer(userId: string, moveId?: string): Promise<boolean> {
  const where = moveId
    ? and(eq(moves.userId, userId), eq(moves.id, moveId), eq(moves.state, "announced"))
    : and(eq(moves.userId, userId), eq(moves.state, "announced"), eq(moves.direction, "buffer"));
  const [move] = await db.select().from(moves).where(where).orderBy(desc(moves.createdAt)).limit(1);
  if (!move) return false;
  const [cancelled] = await db
    .update(moves)
    .set({ state: "cancelled", cancelReason: "stopped" })
    .where(and(eq(moves.id, move.id), eq(moves.state, "announced")))
    .returning();
  if (!cancelled) return false;
  await audit(userId, "user", "buffer_stopped", { moveId: move.id });
  await notify(userId, "buffer_skipped", { reason: "stopped", amountCents: move.amountCents }, { moveId: move.id });
  return true;
}

// Settle buffers announced yesterday (or earlier), re running the safety rule
// with a fresh balance. A buffer that would now leave bills short is cancelled.
export async function settleDueBuffers(userId: string) {
  let ctx = await loadContext(userId);
  if (!ctx.homeBase || !ctx.vault) return;
  const due = await db
    .select()
    .from(moves)
    .where(and(eq(moves.userId, userId), eq(moves.state, "announced"), eq(moves.direction, "buffer"), lte(moves.settleOn, ctx.today)))
    .orderBy(asc(moves.createdAt));
  if (due.length === 0) return;

  await refreshLiveBalance(ctx.homeBase.id);
  ctx = await loadContext(userId);
  const { home, vaultRow } = requireLoop(ctx);

  for (const move of due) {
    // Fresh bills and balance from today's feed, including buffers settled above.
    const inputs = await loadEngineInputs(ctx);
    const profile = decide(inputs.state, inputs.txns, inputs.balances, ctx.today, { learnOnly: true }).profile;
    const check = settleCheck(move.amountCents, inputs.balances.checkingCents, profile.bills, ctx.today);

    const cancel = async (why: "settle_failed" | "frozen") => {
      await db.update(moves).set({ state: "cancelled", cancelReason: why }).where(eq(moves.id, move.id));
      await audit(userId, "engine", "buffer_cancelled", { moveId: move.id, why, ...check });
      await notify(userId, "buffer_skipped", { reason: why, amountCents: move.amountCents }, { moveId: move.id });
    };

    if (vaultRow.status === "frozen") {
      await cancel("frozen");
      continue;
    }
    if (!check.ok) {
      await cancel("settle_failed");
      continue;
    }
    try {
      await vault.buffer(vaultRow.id, move.amountCents, move.id);
    } catch (error) {
      if (error instanceof VaultError && (error.code === "frozen" || error.code === "daily_limit")) {
        await cancel(error.code === "frozen" ? "frozen" : "settle_failed");
        continue;
      }
      throw error;
    }
    await mirrorVaultMove(home, ctx.today, -move.amountCents);
    const vaultCents = await vault.getBalance(vaultRow.id);
    const checkingCents = await checkingBalance(home, ctx.today, vaultRow.id);
    await audit(userId, "engine", "buffer_settled", { moveId: move.id, amountCents: move.amountCents });
    await notify(userId, "buffer_settled", { amountCents: move.amountCents, vaultCents, checkingCents }, { moveId: move.id });
  }
}
