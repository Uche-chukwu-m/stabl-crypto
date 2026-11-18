// Runs the server side against a real Postgres. Set TEST_DATABASE_URL to a
// throwaway database (it is migrated and written to). Skipped when unset.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

if (url) {
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET ??= "test-secret-for-codes";
  process.env.DEMO_MODE = "true";
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}

// Imported lazily so DATABASE_URL is set first.
const load = async () => {
  const { db, pool } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const drizzle = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { seedPersona, deleteUserData } = await import("@/lib/demo/seed");
  const admin = await import("@/lib/demo/admin");
  const { handleCommand } = await import("@/lib/commands");
  const security = await import("@/lib/security");
  const { loadContext } = await import("@/lib/context");
  const { vault } = await import("@/lib/vault/mock");
  const { checkingBalance } = await import("@/lib/balances");
  const { billsDueCents } = await import("@/engine/learn");
  const { ENGINE } = await import("@/engine/config");
  return { db, pool, schema, drizzle, migrate, seedPersona, deleteUserData, admin, handleCommand, security, loadContext, vault, checkingBalance, billsDueCents, ENGINE };
};

type Mods = Awaited<ReturnType<typeof load>>;
let m: Mods;
let jemaya: string;

async function thread(userId: string) {
  const { db, schema, drizzle } = m;
  return db
    .select()
    .from(schema.messages)
    .where(drizzle.eq(schema.messages.userId, userId))
    .orderBy(drizzle.asc(schema.messages.createdAt));
}

async function ledgerSum(vaultId: string) {
  const { db, schema, drizzle } = m;
  const rows = await db.select().from(schema.ledgerEntries).where(drizzle.eq(schema.ledgerEntries.vaultId, vaultId));
  return rows.reduce((s, r) => s + r.amountCents, 0);
}

suite("server side against Postgres", () => {
  beforeAll(async () => {
    m = await load();
    await m.db.execute(m.drizzle.sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await m.migrate(m.db, { migrationsFolder: "./drizzle" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    jemaya = (await m.seedPersona("jemaya")).userId;
  }, 120_000);

  afterAll(async () => {
    await m?.pool.end();
  });

  it("seeds Jemaya Steady with a vault whose balance is the sum of its ledger", async () => {
    const ctx = await m.loadContext(jemaya);
    const [profile] = await m.db.select().from(m.schema.engineProfiles).where(m.drizzle.eq(m.schema.engineProfiles.userId, jemaya));
    expect(profile.status).toBe("steady");
    expect(await m.vault.getBalance(ctx.vault!.id)).toBe(await ledgerSum(ctx.vault!.id));
    expect(await m.vault.getBalance(ctx.vault!.id)).toBeGreaterThan(0);
    expect((await thread(jemaya)).length).toBeGreaterThan(3);
  });

  it("runs the pitch: big client buffers, STOP works, a slow week releases", async () => {
    const before = await m.loadContext(jemaya);
    const vaultBefore = await m.vault.getBalance(before.vault!.id);

    // Big client pays: announce message, nothing moved yet.
    const d = await m.admin.injectEvent(jemaya, "big_client");
    expect(d.actions.some((a) => a.type === "buffer")).toBe(true);
    let msgs = await thread(jemaya);
    expect(msgs.at(-1)!.body).toMatch(/^Stabl: Good stretch\. Tomorrow we will move \$[\d,]+\.00 from Checking 4321 to your vault\./);
    expect(await m.vault.getBalance(before.vault!.id)).toBe(vaultBefore);

    // Advance one day: the receipt arrives and the vault grows.
    await m.admin.advanceClock(jemaya, 1);
    msgs = await thread(jemaya);
    expect(msgs.some((x) => x.template === "buffer_settled" && x.createdAt > before.now)).toBe(true);
    const afterBuffer = await m.vault.getBalance(before.vault!.id);
    expect(afterBuffer).toBeGreaterThan(vaultBefore);

    // Slow week: inject, advance 7 days, a release lands without a question.
    await m.admin.injectEvent(jemaya, "slow_week");
    await m.admin.advanceClock(jemaya, 7);
    const releases = await m.db
      .select()
      .from(m.schema.moves)
      .where(m.drizzle.and(m.drizzle.eq(m.schema.moves.userId, jemaya), m.drizzle.eq(m.schema.moves.direction, "release"), m.drizzle.gt(m.schema.moves.createdAt, before.now)));
    expect(releases.length).toBeGreaterThan(0);
    expect(releases.every((r) => r.state === "settled")).toBe(true);
    msgs = await thread(jemaya);
    expect(msgs.some((x) => x.template === "release" && /^Stabl: Slow week, so we sent/.test(x.body))).toBe(true);

    // Checking never ends a release below this week's bills plus the floor.
    const ctx = await m.loadContext(jemaya);
    const checking = await m.checkingBalance(ctx.homeBase!, ctx.today, ctx.vault!.id);
    const [profileRow] = await m.db.select().from(m.schema.engineProfiles).where(m.drizzle.eq(m.schema.engineProfiles.userId, jemaya));
    expect(checking).toBeGreaterThanOrEqual(m.ENGINE.floorCents);
    expect(profileRow.status).toBe("fast");
    expect(await m.vault.getBalance(ctx.vault!.id)).toBe(await ledgerSum(ctx.vault!.id));
  }, 120_000);

  it("STOP cancels an announced buffer", async () => {
    await m.admin.injectEvent(jemaya, "big_client");
    const [announced] = await m.db
      .select()
      .from(m.schema.moves)
      .where(m.drizzle.and(m.drizzle.eq(m.schema.moves.userId, jemaya), m.drizzle.eq(m.schema.moves.state, "announced")));
    expect(announced).toBeDefined();
    await m.handleCommand(jemaya, "stop", "telegram");
    const [after] = await m.db.select().from(m.schema.moves).where(m.drizzle.eq(m.schema.moves.id, announced.id));
    expect(after.state).toBe("cancelled");
    expect((await thread(jemaya)).at(-1)!.body).toMatch(/^Stabl: Skipped: you asked us to stop/);
  }, 60_000);

  it("EMERGENCY from Telegram puts the code in the app, and a third use waits 24 hours", async () => {
    const ctx = await m.loadContext(jemaya);
    const start = await m.vault.getBalance(ctx.vault!.id);

    for (let use = 1; use <= 2; use++) {
      await m.handleCommand(jemaya, "EMERGENCY", "telegram");
      const msg = (await thread(jemaya)).filter((x) => x.template === "emergency_code").at(-1)!;
      const code = msg.body.match(/code is (\d{6})/)![1];
      const wrong = await m.security.confirmEmergency(jemaya, "000000" === code ? "111111" : "000000", 150_00);
      expect(wrong).toEqual({ ok: false, reason: "code" });
      expect(await m.security.confirmEmergency(jemaya, code, 150_00)).toMatchObject({ ok: true });
    }
    expect(await m.vault.getBalance(ctx.vault!.id)).toBe(start - 300_00);

    await m.handleCommand(jemaya, "EMERGENCY", "telegram");
    const wait = (await thread(jemaya)).filter((x) => x.template === "emergency_wait").at(-1);
    expect(wait?.body).toMatch(/opens in 24 hours/);
    const code = (await thread(jemaya)).filter((x) => x.template === "emergency_code").at(-1)!.body.match(/code is (\d{6})/)![1];
    expect(await m.security.confirmEmergency(jemaya, code, 100_00)).toEqual({ ok: false, reason: "not_yet" });
  }, 60_000);

  it("FREEZE stops every move at once, and UNFREEZE needs a code", async () => {
    await m.handleCommand(jemaya, "FREEZE", "telegram");
    const ctx = await m.loadContext(jemaya);
    expect(ctx.vault!.status).toBe("frozen");
    const d = await m.admin.injectEvent(jemaya, "big_client");
    expect(d.actions.some((a) => a.type === "buffer" || a.type === "release")).toBe(false);

    await m.handleCommand(jemaya, "UNFREEZE 123456", "telegram");
    expect((await m.loadContext(jemaya)).vault!.status).toBe("frozen");
    await m.handleCommand(jemaya, "UNFREEZE", "telegram");
    const code = (await thread(jemaya)).filter((x) => x.template === "unfreeze_code").at(-1)!.body.match(/code is (\d{6})/)![1];
    await m.handleCommand(jemaya, `UNFREEZE ${code}`, "telegram");
    expect((await m.loadContext(jemaya)).vault!.status).toBe("locked");
  }, 60_000);

  it("the database refuses a move between one user's vault and another user's account", async () => {
    const jordan = (await m.seedPersona("jordan")).userId;
    const a = await m.loadContext(jemaya);
    const b = await m.loadContext(jordan);
    await expect(
      m.db.insert(m.schema.moves).values({
        userId: jemaya,
        vaultId: a.vault!.id,
        homeBaseAccountId: b.homeBase!.id,
        direction: "buffer",
        amountCents: 100_00,
        state: "planned",
        reason: "test",
        plannedFor: a.today,
        settleOn: a.today,
      }),
    ).rejects.toThrow();
  }, 120_000);

  it("home base cannot be set when the owner name does not match", async () => {
    const ctx = await m.loadContext(jemaya);
    await m.db.update(m.schema.users).set({ legalName: "Someone Else" }).where(m.drizzle.eq(m.schema.users.id, jemaya));
    expect(await m.security.setHomeBase(jemaya, ctx.homeBase!.id)).toEqual({ ok: false, reason: "name_mismatch" });
    await m.db.update(m.schema.users).set({ legalName: "Jemaya Brooks" }).where(m.drizzle.eq(m.schema.users.id, jemaya));
    expect(await m.security.setHomeBase(jemaya, ctx.homeBase!.id)).toEqual({ ok: true, pending: false });
  });

  it("the ledger is insert only and can never go below zero", async () => {
    const ctx = await m.loadContext(jemaya);
    await expect(m.db.update(m.schema.ledgerEntries).set({ amountCents: 1 }).where(m.drizzle.eq(m.schema.ledgerEntries.vaultId, ctx.vault!.id))).rejects.toThrow();
    await expect(m.db.delete(m.schema.ledgerEntries).where(m.drizzle.eq(m.schema.ledgerEntries.vaultId, ctx.vault!.id))).rejects.toThrow();
    await expect(
      m.db.insert(m.schema.ledgerEntries).values({ vaultId: ctx.vault!.id, kind: "interest", amountCents: -10_000_000_00, entryDate: "2000-01-01" }),
    ).rejects.toThrow();
  });

  it("a retried vault call never moves money twice", async () => {
    const ctx = await m.loadContext(jemaya);
    const [move] = await m.db
      .insert(m.schema.moves)
      .values({
        userId: jemaya,
        vaultId: ctx.vault!.id,
        homeBaseAccountId: ctx.homeBase!.id,
        direction: "release",
        amountCents: 10_00,
        state: "planned",
        reason: "test",
        plannedFor: ctx.today,
        settleOn: ctx.today,
      })
      .returning();
    const before = await m.vault.getBalance(ctx.vault!.id);
    await m.vault.release(ctx.vault!.id, 10_00, move.id);
    await m.vault.release(ctx.vault!.id, 10_00, move.id);
    expect(await m.vault.getBalance(ctx.vault!.id)).toBe(before - 10_00);
  });

  it("a mystery credit asks once and the answer sticks", async () => {
    await m.admin.injectEvent(jemaya, "new_source");
    await m.admin.injectEvent(jemaya, "new_source");
    const asks = (await thread(jemaya)).filter((x) => x.template === "mystery_credit");
    expect(asks).toHaveLength(1);
    await m.handleCommand(jemaya, "YES", "app");
    const [tag] = await m.db
      .select()
      .from(m.schema.sourceTags)
      .where(m.drizzle.and(m.drizzle.eq(m.schema.sourceTags.userId, jemaya), m.drizzle.eq(m.schema.sourceTags.sourceKey, "ZELLE FROM K JONES")));
    expect(tag).toMatchObject({ tag: "income", setBy: "user" });
  }, 60_000);

  it("Tee gets no buffers and a plain explanation", async () => {
    const tee = (await m.seedPersona("tee")).userId;
    await m.admin.runNow(tee);
    const msgs = await thread(tee);
    expect(msgs.some((x) => x.body === "Stabl: Stabl works when your income covers your spending on average. Right now it does not, so we will not move money.")).toBe(true);
    const buffers = await m.db
      .select()
      .from(m.schema.moves)
      .where(m.drizzle.and(m.drizzle.eq(m.schema.moves.userId, tee), m.drizzle.eq(m.schema.moves.direction, "buffer")));
    expect(buffers).toEqual([]);
  }, 120_000);

  // The Arc path, without Arc: the contract's event is handed to the same code the
  // QuickNode Stream's webhook calls.
  it("a vault event settles a move once, and a repeated delivery changes nothing", async () => {
    const { applyVaultEvent } = await import("@/lib/chain/settle");
    const { moveRef, centsToUnits } = await import("@/lib/chain/config");
    const { db, schema, drizzle } = m;
    const ctx = await m.loadContext(jemaya);
    const owner = "0x00000000000000000000000000000000000a11ce";
    await db.insert(schema.chainWallets).values({ userId: jemaya, circleWalletId: "test-wallet", address: owner, blockchain: "ARC-TESTNET" }).onConflictDoNothing();

    const [move] = await db
      .insert(schema.moves)
      .values({
        userId: jemaya,
        vaultId: ctx.vault!.id,
        homeBaseAccountId: ctx.homeBase!.id,
        direction: "buffer",
        amountCents: 123_00,
        state: "settling",
        reason: "test",
        plannedFor: ctx.today,
        settleOn: ctx.today,
        chainTxId: "circle-test-tx",
        submittedAt: new Date(),
      })
      .returning();
    const before = await ledgerSum(ctx.vault!.id);
    const event = {
      name: "Deposited" as const,
      owner: owner as `0x${string}`,
      units: centsToUnits(123_00),
      ref: moveRef(move.id),
      balanceUnits: 0n,
      txHash: `0x${"ab".repeat(32)}` as `0x${string}`,
      logIndex: 3,
      blockNumber: 1000n,
    };

    expect(await applyVaultEvent(event, "stream")).toBe("settled");
    const receipts = async () => (await thread(jemaya)).filter((x) => x.moveId === move.id && x.template === "buffer_settled");
    const [settled] = await db.select().from(schema.moves).where(drizzle.eq(schema.moves.id, move.id));
    expect(settled).toMatchObject({ state: "settled", confirmedBy: "stream", txHash: event.txHash });
    expect(settled.followUpsDoneAt).not.toBeNull();
    expect(await ledgerSum(ctx.vault!.id)).toBe(before + 123_00);
    expect(await receipts()).toHaveLength(1);

    // QuickNode retries, or the fallback reads the same event from Arc.
    expect(await applyVaultEvent(event, "stream")).toBe("duplicate");
    expect(await applyVaultEvent(event, "reconcile")).toBe("duplicate");
    expect(await ledgerSum(ctx.vault!.id)).toBe(before + 123_00);
    expect(await receipts()).toHaveLength(1);
    const events = await db.select().from(schema.chainEvents).where(drizzle.eq(schema.chainEvents.txHash, event.txHash));
    expect(events).toHaveLength(1);

    // An event for an amount the move did not ask for never settles it.
    const [other] = await db
      .insert(schema.moves)
      .values({ ...move, id: undefined, state: "settling", amountCents: 50_00, createdAt: undefined, settledAt: null, txHash: null, confirmedBy: null, followUpsDoneAt: null, followUpsJson: null })
      .returning();
    const wrong = { ...event, ref: moveRef(other.id), units: centsToUnits(49_00), txHash: `0x${"cd".repeat(32)}` as `0x${string}` };
    expect(await applyVaultEvent(wrong, "stream")).toBe("mismatch");
    const [still] = await db.select().from(schema.moves).where(drizzle.eq(schema.moves.id, other.id));
    expect(still.state).toBe("settling");
    await db.update(schema.moves).set({ state: "cancelled" }).where(drizzle.eq(schema.moves.id, other.id));
  }, 60_000);

  it("a receipt that failed to send is finished by the next delivery", async () => {
    const { applyVaultEvent } = await import("@/lib/chain/settle");
    const { moveRef, centsToUnits } = await import("@/lib/chain/config");
    const { db, schema, drizzle } = m;
    const ctx = await m.loadContext(jemaya);
    const owner = "0x00000000000000000000000000000000000a11ce";
    const [move] = await db
      .insert(schema.moves)
      .values({
        userId: jemaya,
        vaultId: ctx.vault!.id,
        homeBaseAccountId: ctx.homeBase!.id,
        direction: "buffer",
        amountCents: 77_00,
        state: "settling",
        reason: "test",
        plannedFor: ctx.today,
        settleOn: ctx.today,
        chainTxId: "circle-test-tx-2",
        submittedAt: new Date(),
      })
      .returning();
    const event = {
      name: "Deposited" as const,
      owner: owner as `0x${string}`,
      units: centsToUnits(77_00),
      ref: moveRef(move.id),
      balanceUnits: 0n,
      txHash: `0x${"ef".repeat(32)}` as `0x${string}`,
      logIndex: 0,
      blockNumber: 1001n,
    };
    expect(await applyVaultEvent(event, "stream")).toBe("settled");

    // As if the first delivery crashed after the bank side but before the receipt.
    await db.delete(schema.messages).where(drizzle.eq(schema.messages.moveId, move.id));
    await db.update(schema.moves).set({ followUpsJson: { mirror: true }, followUpsDoneAt: null }).where(drizzle.eq(schema.moves.id, move.id));

    expect(await applyVaultEvent(event, "stream")).toBe("duplicate");
    const receipts = (await thread(jemaya)).filter((x) => x.moveId === move.id && x.template === "buffer_settled");
    expect(receipts).toHaveLength(1);
    const mirrors = await db
      .select()
      .from(schema.transactions)
      .where(drizzle.and(drizzle.eq(schema.transactions.userId, jemaya), drizzle.eq(schema.transactions.amountCents, -77_00), drizzle.eq(schema.transactions.origin, "vault_mirror")));
    expect(mirrors).toHaveLength(1); // the bank side was not posted twice
    const [done] = await db.select().from(schema.moves).where(drizzle.eq(schema.moves.id, move.id));
    expect(done.followUpsDoneAt).not.toBeNull();
  }, 60_000);

  it("deleting a user removes everything, ledger included", async () => {
    const ada = (await m.seedPersona("ada")).userId;
    await m.deleteUserData(ada);
    const left = await m.db.select().from(m.schema.vaultAccounts).where(m.drizzle.eq(m.schema.vaultAccounts.userId, ada));
    expect(left).toEqual([]);
  }, 120_000);
});
