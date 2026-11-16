# StablVault

The contract that holds Stabl's vaults on Arc. It is one file: [src/StablVault.sol](src/StablVault.sol).

**Deployed on Arc Testnet:** [`0xD70f1e4973458D2b2E440b17600c53A4ca78d90f`](https://explorer.testnet.arc.io/address/0xD70f1e4973458D2b2E440b17600c53A4ca78d90f)
(details in [deployments/arc-testnet.json](deployments/arc-testnet.json))

## What it guarantees

Stabl sets money aside in good weeks and gives it back in slow ones. The contract makes the promise behind that enforceable, whatever Stabl's servers do:

1. **Closed loop.** Every way out of a vault pays that vault's owner. No function sends an owner's money to any other address.
2. **A limited operator.** Stabl's operator can add money to a vault and send it back to its owner. It cannot redirect, borrow or sweep anything.
3. **Freeze.** An owner can freeze their vault. While frozen, nothing moves in or out. Only the owner can unfreeze. The operator may freeze on an owner's behalf, because stopping is always safe, but can never unfreeze.
4. **Emergency unlock.** An owner's wallet can take its own money out without the operator. In the app those wallets are Circle developer-controlled, so this is not yet an exit that works without Stabl.
5. **Once only.** Every move carries the app's move id as a reference. A reference settles once, so a retried request never moves money twice.

There is no admin, no pause switch, no fee and no upgrade path. The operator and the token are fixed at deployment.

## Arc specifics

- USDC is Arc's native asset. The vault uses its ERC-20 interface at `0x3600000000000000000000000000000000000000` (6 decimals), which reads and moves the same balance.
- The vault never touches native value directly: it has no payable function, no `receive`, and no `SELFDESTRUCT`, so the only way USDC leaves is through the functions above.
- It does not rely on `PREVRANDAO`, block timestamps or confirmations. Arc finalizes a transaction when it is included.

## Events

The app builds its ledger from these, delivered by a QuickNode Stream.

| Event | When |
| --- | --- |
| `Deposited(owner, amount, ref, balance)` | Money set aside |
| `Released(owner, amount, ref, balance)` | Money given back by the operator |
| `EmergencyUnlocked(owner, amount, ref, balance)` | Money taken out by the owner |
| `Frozen(owner, by)` / `Unfrozen(owner)` | Freeze state changed |

## Build and test

```bash
cd contracts
npm install
npm test          # 22 tests, including two fuzz tests
npm run build
npm run export-abi   # copies the interface into ../lib/chain/vault-abi.ts
```

Tests are Solidity files that use forge-std, run by Hardhat 3. The same files run under [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry) with `arc-forge test --network arc`, using the `foundry.toml` here.

## Deploy

From the repo root, with Circle keys in `.env.local`:

```bash
npm run chain:setup     # wallet set and operator wallet on Circle
npm run chain:deploy    # deploys through Arc's CREATE2 factory
```

The deploy is sent from a Circle smart contract account, so Circle's Gas Station pays the fee and no private key is handled. Because the vault has no owner, it does not matter who deploys it.
