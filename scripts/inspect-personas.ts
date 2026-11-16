// Prints what the engine learns from each persona. Handy when tuning personas.
import { formatDollars } from "@/engine/money";
import { generatePersona, PERSONAS, plaidCustomUser, type PersonaKey } from "@/personas";

const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
  const t0 = Date.now();
  const gp = generatePersona(key, today);
  const d = gp.sim.lastDecision!;
  const p = d.profile;
  console.log(`\n${gp.persona.legalName}  end ${gp.end}  (${Date.now() - t0} ms)`);
  console.log(`  range ${formatDollars(p.expenseLowCents)} to ${formatDollars(p.expenseHighCents)}  avg income ${formatDollars(p.avgMonthlyIncomeCents)}  typical3w ${formatDollars(p.typical3wIncomeCents)}  feast3w ${formatDollars(p.feast3wIncomeCents)}  margin ${p.hasMargin}`);
  console.log(`  bills ${p.bills.map((b) => `${b.payee} ${formatDollars(b.amountCents)} d${b.dayOfMonth}`).join(", ")}`);
  console.log(`  rhythm ${p.rhythm.map((r) => r.toFixed(2)).join(" ")}  status ${d.status}  need ${formatDollars(d.needCents)}  checking ${formatDollars(gp.sim.checkingOn(gp.end))}  vault ${formatDollars(gp.sim.vaultCents)}`);
  console.log(`  moves ${gp.sim.moves.map((m) => `${m.date.slice(5)} ${m.direction[0]}${formatDollars(m.amountCents)} ${m.state[0]}`).join(" | ")}`);
  console.log(`  mystery ${d.mysteryCredits.map((m) => m.name).join(", ")}  tags ${Object.entries(gp.sim.sourceTags).map(([k, v]) => `${k}:${v[0]}`).join(" ")}`);
  for (const item of gp.persona.items) {
    const json = JSON.stringify(plaidCustomUser(gp, item.key));
    const n = plaidCustomUser(gp, item.key).override_accounts.reduce((s, a) => s + a.transactions.length, 0);
    console.log(`  plaid ${item.key}: ${n} txns, ${(json.length / 1024).toFixed(1)} KB`);
  }
  if (gp.demo) console.log(`  demo dry run: buffer ${formatDollars(gp.demo.bufferCents)} release ${formatDollars(gp.demo.releaseCents)} margin ${formatDollars(gp.demo.marginCents)}`);
}
