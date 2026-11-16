// The seam between Stabl and the bank that actually holds the vault. Today it is
// MockVaultProvider, a ledger in our own Postgres. A sponsor bank replaces it by
// writing one new class that implements this interface.

export type VaultAccount = {
  id: string;
  userId: string;
  legalName: string;
  partnerLabel: string;
  mask: string;
  status: "locked" | "frozen";
  openedAt: Date;
};

export type Move = {
  id: string;
  userId: string;
  vaultId: string;
  direction: "buffer" | "release" | "emergency";
  amountCents: number;
  // "settling" comes back from the Arc vault only: sent, waiting for the contract.
  state: "planned" | "announced" | "settling" | "settled" | "cancelled";
  settledAt: Date | null;
};

export type LedgerEntry = {
  id: string;
  vaultId: string;
  moveId: string | null;
  kind: "buffer" | "release" | "emergency" | "interest";
  amountCents: number;
  entryDate: string;
  createdAt: Date;
};

export interface VaultProvider {
  openAccount(userId: string, legalName: string): Promise<VaultAccount>;
  getBalance(vaultId: string): Promise<number>; // cents
  buffer(vaultId: string, cents: number, moveId: string): Promise<Move>; // home base to vault
  release(vaultId: string, cents: number, moveId: string): Promise<Move>; // vault to home base
  freeze(vaultId: string): Promise<void>;
  unfreeze(vaultId: string): Promise<void>;
  entries(vaultId: string): Promise<LedgerEntry[]>;
}

export class VaultError extends Error {
  constructor(
    public code: "frozen" | "daily_limit" | "insufficient" | "bad_move" | "not_found",
    message: string,
  ) {
    super(message);
  }
}
