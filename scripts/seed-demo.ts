// npm run seed:demo
// Writes each persona's Plaid custom user JSON to personas/generated, then creates
// the four demo users: through Plaid Sandbox when PLAID_CLIENT_ID and PLAID_SECRET
// are set, or straight into the database (local mode) when they are not.
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { formatCents } from "@/engine/money";
import { localDate } from "@/lib/clock";
import { pool } from "@/lib/db";
import { seedPersona } from "@/lib/demo/seed";
import { demoLoginUrl } from "@/lib/demo/login";
import { env } from "@/lib/env";
import { generatePersona, plaidCustomUser, PERSONAS, type PersonaKey } from "@/personas";

const only = process.argv.slice(2) as PersonaKey[];
const keys = only.length ? only : (Object.keys(PERSONAS) as PersonaKey[]);
console.log(`Seeding ${keys.join(", ")} in ${env.plaidMode} mode.\n`);

mkdirSync("personas/generated", { recursive: true });
for (const key of keys) {
  const gp = generatePersona(key, localDate(new Date(), PERSONAS[key].timezone));
  for (const item of gp.persona.items) {
    writeFileSync(`personas/generated/${item.key}.json`, JSON.stringify(plaidCustomUser(gp, item.key), null, 2));
  }
}

for (const key of keys) {
  const { userId, gp } = await seedPersona(key, { log: (line) => console.log(line) });
  if (gp.demo) {
    console.log(
      `  pitch dry run: big client buffers ${formatCents(gp.demo.bufferCents)}, slow week releases ${formatCents(gp.demo.releaseCents)}`,
    );
  }
  console.log(`  sign in: ${await demoLoginUrl(userId)}\n`);
}

await pool.end();
