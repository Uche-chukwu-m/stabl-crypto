# Stabl

**Steady pay for uneven income.** Stabl sets money aside in good weeks and gives it back in slow ones. In this version the vault that holds that money is a smart contract on Arc, and the person using it never has to know.

- **Live app:** https://stabl-crypto.vercel.app
- **Vault contract (Arc Testnet, verified):** [`0xD70f1e4973458D2b2E440b17600c53A4ca78d90f`](https://explorer.testnet.arc.io/address/0xD70f1e4973458D2b2E440b17600c53A4ca78d90f)
- **Built for:** University Blockchain Conference 2026 hackathon. Consumer Applications track, built on Arc, using QuickNode Streams.

## The problem

Stabl starts with freelancers who earn enough over a year but get paid at unpredictable times. Their bills arrive on fixed dates; their income does not. A good month gets spent, and a slow month means overdrafts and payday loans.

Uneven income is common, and well documented:

- A typical family's income changes by about **36% from one month to the next** ([JPMorgan Chase Institute, *Weathering Volatility 2.0*](https://www.jpmorganchase.com/institute/all-topics/financial-health-wealth-creation/report-weathering-volatility-2-a-monthly-stress-test-to-guide-saving)).
- Households in the U.S. Financial Diaries spent **about five months a year** with income more than 25% above or below their average ([Financial Health Network, U.S. Financial Diaries](https://finhealthnetwork.org/u-s-financial-diaries/)).
- **85% of freelancers** say they are paid late at least some of the time ([Remote](https://remote.com/blog/contractor-management/reversing-late-payment-culture)).
- As Jonathan Morduch, co-author of *The Financial Diaries*, put it, families "want to have the right money at the right time" ([Dawn](https://www.dawn.com/news/1327369)).

Stabl spreads money a person already earns across time. It cannot help someone whose income stays below their spending, and it tells them so instead of moving anything.

Stabl connects to a person's bank, learns their income pattern and their bills, and then does two things:

- **In a good stretch** it moves the surplus into a locked vault, after telling them a day ahead.
- **In a slow week** it sends money back to checking, right away.

Every move gets a plain message. There is nothing to configure and nothing to remember.

## Why put the vault on a blockchain

A product that moves your money on its own has one question to answer: what stops it from moving your money somewhere else?

For most apps the answer is "trust us," and that has failed before. In 2024 the fintech middleman Synapse collapsed. It kept the ledger of who was owed what; when it failed, customers could not prove their balances, and the bankruptcy trustee found a gap of tens of millions of dollars between what customers were owed and what partner banks held ([NBC News](https://www.nbcnews.com/business/business-news/synapse-bankruptcy-trustee-says-85-million-customer-savings-missing-fi-rcna156108), [American Banker](https://www.americanbanker.com/news/cfpb-to-hold-synapse-responsible-for-missing-customer-funds)). With Stabl, every vault balance sits on a public ledger anyone can check.

Here much of the answer is a contract anyone can read. The vault holds each person's money as USDC, and the contract enforces these rules whatever Stabl's servers ask for:

1. **Closed loop.** Every way out of a vault pays that vault's owner. No function sends an owner's money to any other address.
2. **A limited operator.** Stabl can add money to a vault and send it back to its owner. It cannot redirect, borrow or sweep anything.
3. **Freeze.** An owner can freeze their vault. Nothing moves in or out until they unfreeze it. Stabl can freeze on someone's behalf, because stopping is always safe, but can never unfreeze.
4. **Emergency unlock.** The owner's own wallet can take money out without the operator. The only place it can go is that wallet.
5. **Once only.** Every move carries the app's move id. A move settles once, so a retried request never moves money twice.

There is no admin key, no pause switch, no fee and no upgrade path. The contract is about 150 lines: [contracts/src/StablVault.sol](contracts/src/StablVault.sol).

The person using Stabl sees none of this. They see dollars, their bank, and a small **Proof** link on each receipt.

**What the contract does not do yet.** In this prototype each person's wallet is a Circle developer-controlled wallet, so Stabl signs for it on their behalf. The contract limits where money can go, but it does not yet give a person an exit that works if Stabl disappears. That needs the person to hold their own key: Circle user-controlled wallets with a passkey, or a recovery address only they control. It is the next thing on the list. See [Custody](#what-is-real-and-what-is-simulated).

## How it works

```mermaid
flowchart LR
  bank[Bank, through Plaid] --> engine[Smoothing engine]
  engine -->|decides a move| circle[Circle wallets]
  circle -->|deposit or release| vault[StablVault on Arc]
  vault -->|event| qn[QuickNode Stream]
  qn -->|signed webhook| app[Stabl app]
  app --> ledger[Ledger entry]
  app --> receipt[Receipt with a Proof link]
```

1. **Plaid** reads the person's accounts. Stabl never moves money at the bank in this build, so it is safe to check out the app.
2. **The engine** ([engine/](engine/)) is pure functions. It learns income and bills, then decides when to set aside and when to give back.
3. **Circle developer-controlled wallets** sign every transaction. Each person gets a hidden smart contract account that owns their vault on chain. Circle's Gas Station pays the fees, so that wallet never needs funding. Stabl holds no private keys.
4. **StablVault on Arc** holds the USDC and enforces the rules above.
5. **A QuickNode Stream** watches the contract and posts each of its events to the app.
6. **The app settles the move only then.** The ledger entry and the receipt are written when Arc says the money moved, not when the app asked for it.

### Arc

- USDC is Arc's native asset, so the vault holds the same thing fees are paid in. There is no second token to manage.
- Transactions are final in under a second, so "sent back to checking, right away" is true on chain too.
- The contract uses USDC's ERC-20 interface (6 decimals) and never touches native value directly: no payable function, no `receive`, no `SELFDESTRUCT`. See [contracts/README.md](contracts/README.md).
- It was deployed from a Circle smart contract account through Arc's CREATE2 factory, so the deploy itself was fee-sponsored and involved no private key.

### QuickNode Streams

The Stream is what turns a transaction into a receipt.

- **Setup:** one `logs` stream on `arc-testnet`, created by [scripts/chain-stream.ts](scripts/chain-stream.ts).
- **Filter:** runs on QuickNode's side and passes only the vault contract's logs ([lib/chain/stream.ts](lib/chain/stream.ts)). Blocks with nothing from the vault produce no delivery.
- **Destination:** a webhook, [app/api/chain/stream/route.ts](app/api/chain/stream/route.ts). Every delivery is checked against the stream's HMAC signature and a ten minute freshness window.
- **Exactly once:** each event is stored under a unique (transaction, log index) key before anything else happens, so a repeated delivery does nothing.
- **Fallback:** if an event has not arrived a few seconds after a move was sent, the app asks Circle for the transaction and reads its receipt from Arc directly. Whichever source is first settles the move, and each move records which one it was (`confirmed_by`). This also covers local development, where there is no public address for a webhook.

Streams bill for every block they process, and Arc makes a block about every 0.7 seconds. The script can delete and recreate the stream, so it only runs when the app is in use.

## Does it help?

A simulation, not a study: [docs/simulation.md](docs/simulation.md). 200 synthetic freelancers, none of them the app's presenter personas, run for six months through the real engine, each one with Stabl and without it on the identical bank feed.

- **Stabl never made things worse.** With spending held fixed, it caused 0 extra overdraft days across 180 people who earn more than they spend, and 0 across 20 who do not.
- **The benefit depends on how much visible money gets spent.** If a person spends 10% of any spare checking each week, overdraft days fall from 879 to 777. At 20% they fall from 1,556 to 987, and at 30% from 2,175 to 1,228. Nobody ended up worse off at any rate.
- **What it cannot show:** whether real people spend that way, or whether they would allow automatic transfers. That needs real users.

## See it on Arc

These are real transactions from the live site.

| In the app | On Arc |
| --- | --- |
| "Moved $650.00 to your vault." | [Deposited, 0.65 USDC](https://explorer.testnet.arc.io/tx/0xfcbf2fcad4711208687b122a4f1b01a6c59bf5cf99df73c45eb2060ba391a2f1) |
| "Slow week, so we sent $210.00 from your vault to Checking 4321." | [Released, 0.21 USDC](https://explorer.testnet.arc.io/tx/0x8a51a26643c1e21f7e56f584fc8cfb548186a51759f6e9e972eeb2556f24ab18) |
| "Emergency unlock done. We sent $150.00 from your vault to Checking 4321." | [EmergencyUnlocked, 0.15 USDC](https://explorer.testnet.arc.io/tx/0x2014fc95f62811642101efb17766aaaed2d1f8c2c3c2a49651474ffb5c1f3a4d), sent by the owner's wallet, not the operator |
| A vault frozen, then unfrozen, by its owner's wallet | [Frozen](https://explorer.testnet.arc.io/tx/0xeedff541e643dae3558d229cb056730727e6ad42a19a52a7e6f081d2bd3b1a8a) and [Unfrozen](https://explorer.testnet.arc.io/tx/0xef4f5c7b73059e1bdbe889ec1ba51b468b9af2033ce2408ff57a5a69b89f0558) |
| The contract being deployed | [Deploy](https://explorer.testnet.arc.io/tx/0x1302c8f4725d73f795a258edca6dbf6fd74c3ae4363d0cda55f165baff91cd3d) |

The QuickNode Stream confirmed all three moves to the app: each move records `confirmed_by = stream`. From the app sending each transaction to the webhook settling it took 2.1 seconds for the deposit, 4.7 for the release, and 8.7 for the emergency unlock, which includes the person entering their code. After each one the app's balance and the contract's matched.

## Try it

Open https://stabl-crypto.vercel.app and sign in with any email address.

1. Answer two questions about how you earn, agree to the rules, and give a name and date of birth.
2. **Connect a bank.** This opens Plaid's real window in test mode. Pick any bank and use Plaid's test login: username `user_good`, password `pass_good`.
3. Choose your home base, review what Stabl learned, and open your vault.
4. Stabl runs its first check straight away and tells you what it would do.

Things to try once you are in:

- **Vault, then Freeze.** This sends a transaction from your hidden wallet to the contract. Unfreezing needs a code, which shows up in Messages.
- **Settings, then "Where your vault is held."** It compares what Stabl shows with what the contract says, read live from Arc, and lists your latest proofs.

A set-aside is announced a day ahead, so a new account sees its first deposit on Arc the next day.

## What is real and what is simulated

| | |
| --- | --- |
| Vault contract, its rules, and every transaction | Real, on Arc Testnet |
| Hidden wallets and fee sponsorship | Real, Circle developer-controlled wallets and Gas Station |
| Event delivery | Real, QuickNode Streams |
| Bank connection | Real Plaid, in Sandbox. See the note below |
| Money leaving and reaching the bank | Simulated. Nothing moves at a bank |
| Turning dollars into USDC and back | Simulated. Stabl's operator wallet holds test USDC and stands in for that step |
| Identity check | Simulated. A name and an age check |

Test USDC has no value. The app says so on one page, Settings then "Where your vault is held", and speaks in dollars everywhere else.

**Scale.** The test faucet gives 20 USDC at a time, so on the test network each dollar is held as 0.001 test USDC. A $650.00 move is 0.65 USDC on the explorer. `ARC_UNITS_PER_CENT=10000` makes it one to one.

**Plaid Sandbox.** In Sandbox every bank returns the same stock test user, in someone else's name and with no income pattern Stabl could learn from. So after Plaid's window closes, Stabl asks the Sandbox for a custom test user instead: your own name, under the bank you picked, with six months of history for the way you said you earn ([lib/plaid/test-history.ts](lib/plaid/test-history.ts)). With real accounts the connection is used exactly as Plaid returns it.

**Custody.** This is a custodial prototype with contract-enforced vault rules. The hidden wallets are developer-controlled, which is what lets a person use Stabl without ever seeing a wallet, and it means Stabl asks Circle to sign for them. The contract guarantees that money leaving a vault only reaches that vault's owner wallet. After a release, the app sends the USDC from the owner wallet back to the operator, standing in for paying dollars into checking. The next step is user-controlled wallets, so that only the person can sign a freeze or an emergency unlock.

**Bank timing.** Arc finalizes a vault move in under a second. That says nothing about how fast a real bank transfer would be; the bank side here is simulated.

## Run it locally

You need Node 20.9 or later and Postgres.

```bash
npm install
cp .env.example .env.local     # fill in the values it describes
npm run db:migrate
npm run dev
```

Without Circle keys the app uses the simulated ledger, which is what the tests run against. To use Arc:

```bash
npm run chain:setup            # wallet set and operator wallet on Circle; prints ids for .env.local
(cd contracts && npm install && npm run build)
npm run chain:deploy           # deploys StablVault, prints its address
npm run chain:check            # no-funds smoke test: a sponsored wallet freezes and unfreezes its vault
# fund the operator address at https://faucet.circle.com (Arc Testnet), then:
npm run chain:status -- approve
npm run chain:stream -- create # needs a public https address for the webhook
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Engine, copy and webhook tests |
| `TEST_DATABASE_URL=... npm run test:integration` | The server side against a throwaway Postgres. **It wipes that database.** |
| `(cd contracts && npm test)` | 22 contract tests, two of them fuzz tests |
| `npm run chain:status` | Operator balance, allowance and what the vault holds |
| `npm run chain:check` | Smoke test of wallets, sponsorship, the contract and event decoding |
| `npm run chain:stream -- create \| status \| delete` | Manage the QuickNode Stream |
| `npm run seed:demo jemaya` | Create the presenter account locally |
| `npx tsx scripts/try-pitch.ts` | Run the presenter's whole story on Arc locally and check the app against the contract at each step |
| `npx tsx scripts/presenter.ts seed \| big-client \| advance \| slow-week \| reset \| link` | Drive the presenter account on the live site |
| `npx tsx scripts/compare.ts 200` | The with-and-without simulation; writes docs/simulation.md |
| `npx tsx scripts/try-emergency.ts <userId> [dollars]` | An emergency unlock through the app's own code |
| `npx tsx scripts/live-check.ts` | Compare the live site's numbers with the contract, and show what confirmed each move |

## Where things live

```
contracts/           StablVault.sol, its tests, and the deployment record
engine/              The smoothing engine. Pure functions, no I/O
lib/chain/
  config.ts          Arc details, dollars to USDC units, move id to on-chain reference
  circle.ts          Circle wallets: create, call a contract, idempotency keys
  arc.ts             Read-only access to Arc and vault event decoding
  settle.ts          applyVaultEvent(): the one place a move becomes settled
  stream.ts          The Stream's filter and signature check
lib/vault/
  provider.ts        The interface both vaults implement
  arc.ts             The vault on Arc
  mock.ts            The simulated ledger, used by tests
lib/moves.ts         The move state machine
lib/move-receipts.ts What follows a settled move: bank side, audit trail, receipt
app/api/chain/stream QuickNode webhook
scripts/chain-*.ts   Setup, deploy, status, stream and smoke test
```

## The presenter account

One account, Jemaya Brooks, exists for the video and the stage. It runs on test banks, cannot be entered from the sign in page, and opens only from a one time link made on a page behind a key. Once signed in it looks like any other account. The presenter page can play the events a pitch needs on cue, such as a big client payment or a slow week, because a real account only moves when real income does.
