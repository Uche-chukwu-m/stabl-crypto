import { eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { checkingBalance } from "@/lib/balances";
import { mirrorVaultMove } from "@/lib/bank-mirror";
import { accountLabel, loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { moves } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { vault } from "@/lib/vault";

// What follows a move once it has settled: the bank side of it, the audit trail,
// and the receipt. With the simulated vault this runs straight after the ledger
// is written. On Arc it runs when the contract's event arrives, which is why it
// reads everything it needs from the move itself.
export async function afterMoveSettled(moveId: string) {
  const [move] = await db.select().from(moves).where(eq(moves.id, moveId));
  if (!move || move.state !== "settled") return;
  const ctx = await loadContext(move.userId);
  if (!ctx.homeBase || !ctx.vault) return;
  const home = ctx.homeBase;
  const userId = move.userId;
  const amountCents = move.amountCents;
  const proof = move.txHash ? { txHash: move.txHash, confirmedBy: move.confirmedBy } : {};

  if (move.direction === "buffer") {
    await mirrorVaultMove(home, ctx.today, -amountCents);
    const vaultCents = await vault.getBalance(ctx.vault.id);
    const checkingCents = await checkingBalance(home, ctx.today, ctx.vault.id);
    await audit(userId, "engine", "buffer_settled", { moveId, amountCents, ...proof });
    await notify(userId, "buffer_settled", { amountCents, vaultCents, checkingCents }, { moveId });
    return;
  }

  await mirrorVaultMove(home, ctx.today, amountCents);
  const vaultCents = await vault.getBalance(ctx.vault.id);
  await audit(userId, move.direction === "emergency" ? "user" : "engine", `${move.direction}_settled`, {
    moveId,
    amountCents,
    reason: move.reason,
    ...proof,
  });

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
