import { chain } from "@/lib/chain/config";
import { ArcVaultProvider } from "./arc";
import { MockVaultProvider, accrueInterest as accrueSimulatedInterest, interestEarned } from "./mock";
import type { VaultProvider } from "./provider";

// Where the vault lives. With Circle and the contract configured it is the
// StablVault contract on Arc; otherwise it is the simulated ledger, which is
// what the test suite runs against. Set VAULT_PROVIDER=mock to force the latter.
export const vault: VaultProvider = chain.enabled ? new ArcVaultProvider() : new MockVaultProvider();

// Interest was simulated in the ledger. On Arc every ledger entry has to match a
// contract event, and nothing pays yield on chain yet, so none accrues there.
export async function accrueInterest(vaultId: string, through: string) {
  if (chain.enabled) return;
  await accrueSimulatedInterest(vaultId, through);
}

export { interestEarned };
