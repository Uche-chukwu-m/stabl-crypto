import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { VAULT } from "@/engine/config";
import { addDays, daysBetween, type ISODate } from "@/engine/dates";
import { sourceKey } from "@/engine/sources";
import { audit } from "@/lib/audit";
import { localDate } from "@/lib/clock";
import { accountLabel } from "@/lib/context";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  accounts,
  channels,
  engineProfiles,
  ledgerEntries,
  messages,
  moves,
  plaidItems,
  sourceTags,
  transactions,
  users,
  vaultAccounts,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runEngine } from "@/lib/engine-runner";
import { render } from "@/lib/notify/templates";
import { connectItem, removeItem } from "@/lib/plaid/items";
import { createCustomUserPublicToken } from "@/lib/plaid/sandbox";
import { syncItem } from "@/lib/plaid/sync";
import { vault } from "@/lib/vault/mock";
import { generatePersona, plaidCustomUser, PERSONAS, type GeneratedPersona, type PersonaKey } from "@/personas";

export const RULES_VERSION = "2026-10-20";

type SeedOptions = { email?: string; log?: (line: string) => void };

// Create a demo user from a persona: connections (Plaid Sandbox custom users, or
// rows straight in the database when Plaid is not configured), home base, a vault
// with the history Stabl would have made, receipts, and the learned profile.
// Running it again replaces the user with the same email, keeping their linked
// phone and Telegram so the presenting phone stays set up.
export async function seedPersona(key: PersonaKey, opts: SeedOptions = {}) {
  const log = opts.log ?? (() => {});
  if (env.plaidMode === "production") throw new Error("Demo seeding never runs against real banks.");

  const persona = PERSONAS[key];
  const realToday = localDate(new Date(), persona.timezone);
  const gp = generatePersona(key, realToday);
  const email = opts.email ?? persona.email;

  const [existing] = await db.select().from(users).where(eq(users.email, email));
  let keptChannels: typeof channels.$inferSelect | undefined;
  if (existing) {
    [keptChannels] = await db.select().from(channels).where(eq(channels.userId, existing.id));
    await deleteUserData(existing.id);
  }

  const [user] = await db
    .insert(users)
    .values({
      email,
      emailVerified: new Date(),
      name: persona.legalName,
      legalName: persona.legalName,
      timezone: persona.timezone,
      kycStatus: "verified_mock",
      earnType: persona.earnType,
      payFrequency: persona.payFrequency,
      isDemo: true,
      personaKey: key,
      rulesSignedAt: new Date(),
      rulesSignedName: persona.legalName,
      rulesVersion: RULES_VERSION,
      onboardingStep: 9,
      clockOffsetDays: daysBetween(realToday, gp.end),
      promptAfter: gp.end,
    })
    .returning();

  await db.insert(channels).values({
    userId: user.id,
    pushSubscriptionJson: keptChannels?.pushSubscriptionJson ?? null,
    telegramChatId: keptChannels?.telegramChatId ?? null,
    telegramLinkToken: randomToken(18),
    emailVerified: true,
    quietHours: false,
  });

  const accountIdByKey = await connectPersona(user.id, gp, log);
  const homeKey = persona.items.flatMap((i) => i.accounts).find((a) => a.homeBase)!.key;
  const homeId = accountIdByKey.get(homeKey)!;
  await db.update(accounts).set({ isHomeBase: true }).where(eq(accounts.id, homeId));

  const v = await vault.openAccount(user.id, persona.legalName);
  await db
    .update(vaultAccounts)
    .set({ openedAt: new Date(`${addDays(gp.end, -120)}T15:00:00Z`) })
    .where(eq(vaultAccounts.id, v.id));
  const [home] = await db.select().from(accounts).where(eq(accounts.id, homeId));
  await seedVaultHistory(user.id, v.id, home, gp);

  await db
    .insert(sourceTags)
    .values(Object.entries(gp.sim.sourceTags).map(([k, tag]) => ({ userId: user.id, sourceKey: k, tag, setBy: "engine" as const })))
    .onConflictDoNothing();
  await runEngine(user.id, { learnOnly: true });
  await db
    .update(engineProfiles)
    .set({ lastFastCheck: gp.sim.lastFastCheck, lastFeastCheck: gp.sim.lastFeastCheck })
    .where(eq(engineProfiles.userId, user.id));

  await audit(user.id, "admin", "demo_seeded", { persona: key, end: gp.end, demo: gp.demo });
  log(`${persona.legalName}: ${gp.txns.length} transactions through ${gp.end}, vault ${(gp.sim.vaultCents / 100).toFixed(2)}`);
  return { userId: user.id, gp };
}

// Connections for a persona's bank data, owned by `userId`. Also used when a new
// user picks a demo bank during onboarding; then `ownerName` is their own name.
export async function connectPersona(
  userId: string,
  gp: GeneratedPersona,
  log: (line: string) => void = () => {},
  ownerName = gp.persona.legalName,
) {
  const ids = new Map<string, string>();
  if (env.plaidMode === "sandbox") {
    for (const item of gp.persona.items) {
      log(`  creating Plaid Sandbox custom user for ${item.label}`);
      const publicToken = await createCustomUserPublicToken(plaidCustomUser(gp, item.key, ownerName));
      const row = await connectItem(userId, publicToken, { label: item.label });
      await waitForTransactions(row.id);
      const rows = await db.select().from(accounts).where(eq(accounts.itemId, row.id));
      for (const a of item.accounts) {
        const match = rows.find((r) => r.mask === a.mask);
        if (!match) throw new Error(`Plaid did not return account ${a.mask}`);
        ids.set(a.key, match.id);
        // Sandbox balances never move, so they anchor on the last day of history.
        await db.update(accounts).set({ balanceCents: gp.endBalances[a.key], balanceAsOf: gp.end }).where(eq(accounts.id, match.id));
      }
    }
    return ids;
  }

  // Local mode: the same data, written straight into the database.
  for (const item of gp.persona.items) {
    const [row] = await db
      .insert(plaidItems)
      .values({ userId, itemId: `local-${randomUUID()}`, institutionName: item.label, env: "local", lastSyncedAt: new Date() })
      .returning();
    for (const a of item.accounts) {
      const [acct] = await db
        .insert(accounts)
        .values({
          itemId: row.id,
          userId,
          plaidAccountId: `local-${a.key}-${randomUUID().slice(0, 8)}`,
          name: a.name,
          officialName: a.officialName,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          ownerNames: [ownerName],
          balanceCents: gp.endBalances[a.key],
          balanceAsOf: gp.end,
        })
        .returning();
      ids.set(a.key, acct.id);
    }
  }
  const rows = gp.txns.map((t) => ({
    accountId: ids.get(t.accountId)!,
    userId,
    date: t.date,
    amountCents: t.amountCents,
    name: t.name,
    sourceKey: sourceKey(t.name),
    origin: "local_seed" as const,
  }));
  for (let i = 0; i < rows.length; i += 500) await db.insert(transactions).values(rows.slice(i, i + 500));
  return ids;
}

// Plaid builds a custom user's history in the background; wait until it lands.
async function waitForTransactions(itemRowId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await syncItem(itemRowId);
    if (result.added > 0) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Plaid Sandbox did not return transactions in time");
}

// The moves Stabl made during the persona's history, written as real moves,
// ledger entries, daily interest, and the receipts the user would have read.
async function seedVaultHistory(userId: string, vaultId: string, home: typeof accounts.$inferSelect, gp: GeneratedPersona) {
  const label = accountLabel(home);
  const at = (date: ISODate, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const ledger: { date: ISODate; cents: number }[] = [];
  const thread: (typeof messages.$inferInsert)[] = [];
  let running = 0;

  const opened = addDays(gp.end, -120);
  thread.push({ userId, template: "vault_ready", body: render("vault_ready", { mask: "0000" }).body, createdAt: at(opened, 12) });

  for (const m of gp.sim.moves.filter((m) => m.state === "settled" || m.state === "cancelled")) {
    const id = randomUUID();
    const settleOn = m.direction === "buffer" ? addDays(m.date, 1) : m.date;
    await db.insert(moves).values({
      id,
      userId,
      vaultId,
      homeBaseAccountId: home.id,
      direction: m.direction,
      amountCents: m.amountCents,
      state: m.state,
      reason: m.reason,
      cancelReason: m.state === "cancelled" ? "settle_failed" : null,
      plannedFor: m.date,
      settleOn,
      settledAt: m.settledOn ? at(m.settledOn, 14) : null,
      createdAt: at(m.date, 14),
    });

    if (m.direction === "buffer") {
      thread.push({
        userId,
        template: "buffer_announced",
        moveId: id,
        body: render("buffer_announced", { amountCents: m.amountCents, account: label, shrunk: false }).body,
        createdAt: at(m.date, 14),
      });
    }
    if (m.state === "cancelled") {
      thread.push({
        userId,
        template: "buffer_skipped",
        moveId: id,
        body: render("buffer_skipped", { reason: "settle_failed", amountCents: m.amountCents }).body,
        createdAt: at(settleOn, 14),
      });
      continue;
    }

    const signed = m.direction === "buffer" ? m.amountCents : -m.amountCents;
    running += signed;
    ledger.push({ date: m.settledOn!, cents: signed });
    await db.insert(ledgerEntries).values({ vaultId, moveId: id, kind: m.direction, amountCents: signed, entryDate: m.settledOn! });
    thread.push(
      m.direction === "buffer"
        ? {
            userId,
            template: "buffer_settled",
            moveId: id,
            body: render("buffer_settled", {
              amountCents: m.amountCents,
              vaultCents: running,
              checkingCents: gp.sim.checkingOn(m.settledOn!),
            }).body,
            createdAt: at(m.settledOn!, 15),
          }
        : {
            userId,
            template: "release",
            moveId: id,
            body: render("release", { amountCents: m.amountCents, account: label, vaultCents: running, unusual: false }).body,
            createdAt: at(m.settledOn!, 15),
          },
    );
  }

  // Daily interest from the first deposit through the last day of history.
  if (ledger.length) {
    const interest: (typeof ledgerEntries.$inferInsert)[] = [];
    let balance = 0;
    for (let day = ledger[0].date; day <= gp.end; day = addDays(day, 1)) {
      balance += ledger.filter((l) => l.date === day).reduce((s, l) => s + l.cents, 0);
      const cents = Math.floor((balance * VAULT.apyPercent) / 100 / 365);
      if (cents > 0) {
        interest.push({ vaultId, kind: "interest", amountCents: cents, entryDate: day });
        balance += cents;
      }
    }
    if (interest.length) await db.insert(ledgerEntries).values(interest);
  }

  const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.id, vaultId));
  thread[0].body = render("vault_ready", { mask: v.mask }).body;
  await db.insert(messages).values(thread);
}

// Full delete: Plaid Items removed, then every row. The ledger is insert only, so
// this transaction opts in to deletes explicitly.
export async function deleteUserData(userId: string) {
  const items = await db.select().from(plaidItems).where(eq(plaidItems.userId, userId));
  for (const item of items) await removeItem(userId, item.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local stabl.allow_ledger_delete = 'on'`);
    await tx.delete(users).where(eq(users.id, userId));
  });
}
