import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ENGINE } from "@/engine/config";
import { addMonths } from "@/engine/dates";
import { bufferRoom, decide } from "@/engine/decide";
import { floorDollar } from "@/engine/money";
import type { Action, Decision } from "@/engine/types";
import { audit } from "@/lib/audit";
import { settlePending } from "@/lib/chain/settle";
import { loadContext, type UserContext } from "@/lib/context";
import { db, pool } from "@/lib/db";
import { bills, engineProfiles, messages, prompts, sourceTags } from "@/lib/db/schema";
import { loadEngineInputs } from "@/lib/engine-inputs";
import { notify } from "@/lib/notify";
import { refreshLiveBalance } from "@/lib/plaid/items";
import { announceBuffer, releaseNow } from "@/lib/moves";

export type RunOptions = { forceFast?: boolean; forceFeast?: boolean; learnOnly?: boolean };

// One engine run per user at a time, even when the cron and a webhook overlap.
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [userId]);
    return await fn();
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [userId]).catch(() => {});
    client.release();
  }
}

// Load, decide, save what was learned, then carry out every planned move and
// prompt. The engine itself stays pure; all side effects happen here.
export async function runEngine(userId: string, opts: RunOptions = {}): Promise<Decision> {
  return withUserLock(userId, async () => {
    let ctx = await loadContext(userId);
    let learnOnly = opts.learnOnly || !ctx.homeBase || !ctx.vault;
    // On Arc, a move may still be on its way. Let it land before deciding, and
    // if it has not, only learn this time: never decide on a balance in motion.
    if (!learnOnly && (await settlePending(userId)) > 0) learnOnly = true;
    if (!learnOnly && ctx.homeBase && opts.forceFeast) {
      await refreshLiveBalance(ctx.homeBase.id);
      ctx = await loadContext(userId);
    }

    const inputs = await loadEngineInputs(ctx);
    const decision = decide(inputs.state, inputs.txns, inputs.balances, ctx.today, { ...opts, learnOnly });
    await saveLearning(ctx, decision, inputs.state.externalBills?.map((b) => b.payee) ?? []);
    if (learnOnly) return decision;

    for (const action of decision.actions) await apply(ctx, action, decision);

    if (decision.ran.fast || decision.ran.feast) {
      await db
        .update(engineProfiles)
        .set({
          ...(decision.ran.fast ? { lastFastCheck: ctx.today } : {}),
          ...(decision.ran.feast ? { lastFeastCheck: ctx.today } : {}),
        })
        .where(eq(engineProfiles.userId, userId));
    }
    return decision;
  });
}

async function saveLearning(ctx: UserContext, d: Decision, externalPayees: string[]) {
  const userId = ctx.user.id;
  const rows = Object.entries(d.classes).map(([id, cls]) => ({ id, cls }));
  if (rows.length) {
    await db.execute(sql`
      update transactions t set class = v.cls
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as v(id uuid, cls text)
      where t.id = v.id and t.class is distinct from v.cls
    `);
  }
  if (d.engineTags.length) {
    await db
      .insert(sourceTags)
      .values(d.engineTags.map((t) => ({ userId, sourceKey: t.sourceKey, tag: t.tag, setBy: "engine" as const })))
      .onConflictDoNothing();
  }

  const external = new Set(externalPayees);
  await db.delete(bills).where(and(eq(bills.userId, userId), eq(bills.source, "engine")));
  const detected = d.profile.bills.filter((b) => !external.has(b.payee));
  if (detected.length) {
    await db.insert(bills).values(
      detected.map((b) => ({
        userId,
        payee: b.payee,
        amountCents: b.amountCents,
        dayOfMonth: b.dayOfMonth,
        lastSeen: b.lastSeen,
        nextDue: b.nextDue,
        kind: b.kind,
        source: "engine" as const,
      })),
    );
  }

  const p = d.profile;
  const values = {
    ready: p.ready,
    expenseLowCents: p.expenseLowCents,
    expenseHighCents: p.expenseHighCents,
    rhythmJson: p.rhythm,
    typical3wIncomeCents: p.typical3wIncomeCents,
    feast3wIncomeCents: p.feast3wIncomeCents,
    avgMonthlyIncomeCents: p.avgMonthlyIncomeCents,
    monthlyBillsCents: p.monthlyBillsCents,
    checkingShare: p.checkingShare,
    hasMargin: p.hasMargin,
    status: d.status,
    needCents: d.needCents,
    learnedAt: new Date(),
  };
  await db
    .insert(engineProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: engineProfiles.userId, set: values });
}

async function apply(ctx: UserContext, action: Action, d: Decision) {
  const userId = ctx.user.id;
  switch (action.type) {
    case "release":
      await releaseNow(ctx, action.amountCents, "release", action.reason, { shortByCents: action.shortByCents });
      return;

    case "release_blocked":
      if (await sentRecently(userId, "release_blocked", 3)) return;
      await notify(userId, "release_blocked", { gapCents: action.gapCents, reason: action.reason });
      return;

    case "buffer": {
      // With an unusual jump the jump message names this buffer, so it stays quiet.
      const silent = d.actions.some((a) => a.type === "jump_prompt");
      await announceBuffer(ctx, action.amountCents, action.limitedBy, { shrunk: action.shrunk, silent });
      return;
    }

    case "buffer_skipped":
      if (action.reason === "below_minimum") return;
      await notify(userId, "buffer_skipped", { reason: action.reason });
      return;

    case "jump_prompt": {
      const [prompt] = await db
        .insert(prompts)
        .values({
          userId,
          kind: "jump",
          payloadJson: { ...action },
          expiresAt: new Date(ctx.now.getTime() + ENGINE.jumpAnswerHours * 3_600_000),
        })
        .returning();
      await notify(
        userId,
        "unusual_jump",
        { depositCents: action.depositCents, bufferCents: action.bufferCents },
        { promptId: prompt.id },
      );
      return;
    }

    case "mystery_prompt": {
      const [prompt] = await db.insert(prompts).values({ userId, kind: "mystery", payloadJson: { ...action } }).returning();
      await notify(userId, "mystery_credit", { amountCents: action.amountCents, name: action.name }, { promptId: prompt.id });
      return;
    }

    case "no_margin": {
      const [profile] = await db.select().from(engineProfiles).where(eq(engineProfiles.userId, userId));
      const last = profile?.noMarginNotifiedAt;
      if (last && ctx.now.getTime() - last.getTime() < ENGINE.feastCheckEveryDays * 86_400_000) return;
      await notify(userId, "no_margin", {});
      await db.update(engineProfiles).set({ noMarginNotifiedAt: ctx.now }).where(eq(engineProfiles.userId, userId));
      return;
    }
  }
}

async function sentRecently(userId: string, template: string, days: number): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.template, template), gte(messages.createdAt, new Date(Date.now() - days * 86_400_000))))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return Boolean(row);
}

// KEEP on an unusual jump: buffer the held part too, within today's safety room.
export async function keepHeldIncome(userId: string, heldCents: number): Promise<number> {
  return withUserLock(userId, async () => {
    const ctx = await loadContext(userId);
    if (!ctx.homeBase || !ctx.vault) return 0;
    const inputs = await loadEngineInputs(ctx);
    const profile = decide(inputs.state, inputs.txns, inputs.balances, ctx.today, { learnOnly: true }).profile;
    const { safetyMax, limitMax } = bufferRoom(inputs.state, profile, inputs.balances, ctx.today);
    const amount = floorDollar(Math.min(heldCents, safetyMax, limitMax));
    const blocked = inputs.state.frozen || (inputs.state.homeBasePendingUntil ?? "") >= ctx.today;
    if (amount < ENGINE.minBufferCents || blocked) return 0;
    await announceBuffer(ctx, amount, "jump_keep", { silent: true, shrunk: amount < heldCents });
    return amount;
  });
}

export async function pauseBuffering(userId: string): Promise<string> {
  const ctx = await loadContext(userId);
  const until = addMonths(ctx.today, ENGINE.pauseMonths);
  await db.update(engineProfiles).set({ pausedUntil: until }).where(eq(engineProfiles.userId, userId));
  await audit(userId, "user", "buffering_paused", { until });
  return until;
}

