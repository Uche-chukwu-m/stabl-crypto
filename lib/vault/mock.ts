import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { addDays } from "@/engine/dates";
import { VAULT } from "@/engine/config";
import { db } from "@/lib/db";
import { ledgerEntries, moves, users, vaultAccounts, vaultBalances } from "@/lib/db/schema";
import { VaultError, type LedgerEntry, type Move, type VaultAccount, type VaultProvider } from "./provider";

// The sponsor bank, simulated: a double entry style ledger in Postgres. The
// balance is never stored; it is the sum of entries (the vault_balances view).
// Every call takes a moveId, and ledger_entries.move_id is unique, so a retried
// call returns the first result instead of moving money twice.
export class MockVaultProvider implements VaultProvider {
  async openAccount(userId: string, legalName: string): Promise<VaultAccount> {
    const [existing] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
    if (existing) return existing;
    const mask = String(1000 + Math.floor(Math.random() * 9000));
    const [created] = await db
      .insert(vaultAccounts)
      .values({ userId, legalName, partnerLabel: "Partner Bank (simulated)", mask })
      .onConflictDoNothing()
      .returning();
    return created ?? (await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId)))[0];
  }

  async getBalance(vaultId: string): Promise<number> {
    const [row] = await db.select().from(vaultBalances).where(eq(vaultBalances.vaultId, vaultId));
    if (!row) throw new VaultError("not_found", "No such vault");
    return row.balanceCents;
  }

  buffer(vaultId: string, cents: number, moveId: string): Promise<Move> {
    return this.post(vaultId, cents, moveId, "buffer");
  }

  release(vaultId: string, cents: number, moveId: string): Promise<Move> {
    return this.post(vaultId, cents, moveId, "release");
  }

  async freeze(vaultId: string): Promise<void> {
    await db.update(vaultAccounts).set({ status: "frozen" }).where(eq(vaultAccounts.id, vaultId));
  }

  async unfreeze(vaultId: string): Promise<void> {
    await db.update(vaultAccounts).set({ status: "locked" }).where(eq(vaultAccounts.id, vaultId));
  }

  async entries(vaultId: string): Promise<LedgerEntry[]> {
    return db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.vaultId, vaultId))
      .orderBy(desc(ledgerEntries.entryDate), desc(ledgerEntries.createdAt));
  }

  private async post(vaultId: string, cents: number, moveId: string, side: "buffer" | "release"): Promise<Move> {
    return db.transaction(async (tx) => {
      const [move] = await tx.select().from(moves).where(eq(moves.id, moveId)).for("update");
      if (!move || move.vaultId !== vaultId) throw new VaultError("bad_move", "Move does not belong to this vault");

      // Idempotent: the entry for this move already exists, so this is a retry.
      const [done] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.moveId, moveId));
      if (done) return move;

      const isBuffer = move.direction === "buffer";
      if (isBuffer !== (side === "buffer") || move.amountCents !== cents) {
        throw new VaultError("bad_move", "Move does not match the request");
      }
      if (move.state === "cancelled" || move.state === "settled") throw new VaultError("bad_move", `Move is ${move.state}`);

      const [vault] = await tx.select().from(vaultAccounts).where(eq(vaultAccounts.id, vaultId)).for("update");
      if (vault.status === "frozen") throw new VaultError("frozen", "Vault is frozen");

      if (isBuffer) {
        // Daily cap, enforced here as well as in the engine.
        const [user] = await tx.select({ limit: users.dailyLimitCents }).from(users).where(eq(users.id, move.userId));
        const [{ today }] = await tx
          .select({ today: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.vaultId, vaultId), eq(ledgerEntries.kind, "buffer"), eq(ledgerEntries.entryDate, move.settleOn)));
        if (today + cents > user.limit) throw new VaultError("daily_limit", "Daily limit reached");
      } else {
        const [{ balance }] = await tx
          .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.vaultId, vaultId));
        if (balance < cents) throw new VaultError("insufficient", "Not enough in the vault");
      }

      await tx.insert(ledgerEntries).values({
        vaultId,
        moveId,
        kind: move.direction,
        amountCents: isBuffer ? cents : -cents,
        entryDate: move.settleOn,
      });
      const [settled] = await tx
        .update(moves)
        .set({ state: "settled", settledAt: new Date() })
        .where(eq(moves.id, moveId))
        .returning();
      return settled;
    });
  }
}

// Simulated interest, accrued once per demo day at VAULT_APY. A sponsor bank does
// this itself, so it lives outside the provider interface.
export async function accrueInterest(vaultId: string, through: string) {
  const [last] = await db
    .select({ day: ledgerEntries.entryDate })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.vaultId, vaultId), eq(ledgerEntries.kind, "interest")))
    .orderBy(desc(ledgerEntries.entryDate))
    .limit(1);
  // Catch up every day since the last accrual, or start today for a new vault.
  for (let day = last ? addDays(last.day, 1) : through; day <= through; day = addDays(day, 1)) {
    const [{ balance }] = await db
      .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.vaultId, vaultId), lte(ledgerEntries.entryDate, day)));
    const cents = Math.floor((balance * VAULT.apyPercent) / 100 / 365);
    if (cents <= 0) continue;
    await db.insert(ledgerEntries).values({ vaultId, kind: "interest", amountCents: cents, entryDate: day }).onConflictDoNothing();
  }
}

export async function interestEarned(vaultId: string, since?: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.vaultId, vaultId), eq(ledgerEntries.kind, "interest"), since ? gte(ledgerEntries.entryDate, since) : undefined));
  return total;
}

export const vault: VaultProvider = new MockVaultProvider();
