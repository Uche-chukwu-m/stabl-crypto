// npx tsx scripts/live-check.ts
// Reads the live database (address in .secrets/production.env) and Arc, and
// prints the presenter account's recent moves, what confirmed each one, and
// whether the app and the contract agree. Read only.
import { readFileSync } from "node:fs";
import pg from "pg";
import { createPublicClient, http } from "viem";

const secrets = Object.fromEntries(
  readFileSync(".secrets/production.env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const deployment = JSON.parse(readFileSync("contracts/deployments/arc-testnet.json", "utf8")) as { address: `0x${string}` };
const UNITS_PER_CENT = BigInt(process.env.LIVE_UNITS_PER_CENT ?? 10);

const db = new pg.Client({ connectionString: secrets.PROD_DATABASE_URL, ssl: { rejectUnauthorized: true } });
await db.connect();
const arc = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const { rows: people } = await db.query(
  `select u.id, u.name, w.address, coalesce(b.balance_cents, 0) as cents, v.status
   from users u join vault_accounts v on v.user_id = u.id
   left join vault_balances b on b.vault_id = v.id
   left join chain_wallets w on w.user_id = u.id
   where u.is_demo order by u.created_at`,
);
for (const p of people) {
  const [units, frozen] = await arc.readContract({
    address: deployment.address,
    abi: [{ type: "function", name: "vaultOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }, { type: "bool" }] }],
    functionName: "vaultOf",
    args: [p.address],
  });
  const chainCents = Number(units / UNITS_PER_CENT);
  console.log(`${p.name}: app ${money(p.cents)} (${p.status}), contract ${money(chainCents)}${frozen ? " frozen" : ""} ${chainCents === p.cents ? "- they agree" : "- THEY DIFFER"}`);

  const { rows: moves } = await db.query(
    `select direction, amount_cents, state, confirmed_by, tx_hash,
            round(extract(epoch from (settled_at - submitted_at))::numeric, 1) as secs
     from moves where user_id = $1 and submitted_at is not null order by submitted_at`,
    [p.id],
  );
  for (const m of moves) {
    console.log(`  ${m.direction} ${money(m.amount_cents)}: ${m.state}, confirmed by ${m.confirmed_by ?? "nothing yet"}${m.secs ? ` in ${m.secs}s` : ""}  ${m.tx_hash ?? ""}`);
  }
  const { rows: last } = await db.query(`select body from messages where user_id = $1 order by created_at desc limit 1`, [p.id]);
  if (last[0]) console.log(`  latest message: ${last[0].body}`);
}
const { rows: ev } = await db.query(`select source, count(*)::int as n from chain_events group by source order by source`);
console.log(`events recorded on the live site: ${ev.map((e) => `${e.n} by ${e.source}`).join(", ") || "none"}`);
await db.end();
