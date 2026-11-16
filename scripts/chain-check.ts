// npm run chain:check
// A smoke test of the Arc path that needs no USDC: a throwaway Circle smart
// contract account freezes and then unfreezes its own (empty) vault. Circle's Gas
// Station pays both fees. It shows that wallets, sponsorship, the contract and
// event decoding all work, and gives the QuickNode Stream two events to deliver.
import "./env";
import { readVault, vaultEventsInTx } from "@/lib/chain/arc";
import { ensureWallet, execute, waitForTx } from "@/lib/chain/circle";
import { chain, txUrl } from "@/lib/chain/config";

const vault = chain.vaultAddress;
if (!vault) throw new Error("Set ARC_VAULT_ADDRESS first.");

const wallet = await ensureWallet("stabl-smoke-test", "Stabl smoke test", "SCA");
console.log(`Test wallet ${wallet.address}`);

for (const fn of ["freeze", "unfreeze"] as const) {
  const started = Date.now();
  const id = await execute({
    walletId: wallet.id,
    contractAddress: vault,
    call: { abiFunctionSignature: `${fn}()`, abiParameters: [] },
    key: ["smoke", fn, String(started)],
    refId: `smoke ${fn}`,
  });
  const status = await waitForTx(id, 90_000);
  if (!status.landed || !status.txHash) throw new Error(`${fn} did not land: ${status.state} ${status.error ?? ""}`);
  const events = await vaultEventsInTx(status.txHash);
  const state = await readVault(wallet.address);
  console.log(`${fn}: landed in ${((Date.now() - started) / 1000).toFixed(1)}s, event ${events.map((e) => e.name).join(", ") || "none"}, contract says frozen=${state.frozen}`);
  console.log(`  ${txUrl(status.txHash)}`);
}
