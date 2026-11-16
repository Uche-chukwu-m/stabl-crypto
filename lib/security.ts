import { and, eq, gte } from "drizzle-orm";
import { SAFETY } from "@/engine/config";
import { addDays } from "@/engine/dates";
import { audit } from "@/lib/audit";
import { checkCode, issueCode } from "@/lib/codes";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { accounts, channels, moves, users } from "@/lib/db/schema";
import { notify, type Channel } from "@/lib/notify";
import { releaseNow } from "@/lib/moves";
import { namesMatch } from "@/lib/names";
import { vault } from "@/lib/vault/mock";

export type Via = "app" | "telegram";

function when(at: Date, timezone: string): string {
  return at.toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Codes always go to a second channel: never back to the one that asked. If the
// request came from Telegram, the code shows in the app. If it came from the app,
// it goes to email and Telegram, and the thread shows only that it was sent.
async function secondChannels(userId: string, via: Via) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [ch] = await db.select().from(channels).where(eq(channels.userId, userId));
  if (via === "telegram") return { showInApp: true, exclude: ["telegram", "push"] as Channel[], where: "the Stabl app" };
  const others: string[] = [];
  if (user.email && !user.isDemo) others.push("your email");
  if (ch?.telegramChatId) others.push("Telegram");
  // With no second channel at all (a demo user with nothing linked), the app is
  // the only place left to show it.
  if (others.length === 0) return { showInApp: true, exclude: ["push"] as Channel[], where: "the Stabl app" };
  return { showInApp: false, exclude: ["push"] as Channel[], where: others.join(" and ") };
}

// FREEZE needs no code from any channel, because stopping is always safe.
export async function freeze(userId: string, actor: "user" | "admin" = "user") {
  const ctx = await loadContext(userId);
  if (!ctx.vault) return;
  await vault.freeze(ctx.vault.id);
  await db
    .update(moves)
    .set({ state: "cancelled", cancelReason: "frozen" })
    .where(and(eq(moves.userId, userId), eq(moves.state, "announced")));
  // A pending home base change is the most likely reason someone froze.
  if (ctx.user.homeBasePendingAccountId) {
    await db.update(users).set({ homeBasePendingAccountId: null, homeBasePendingUntil: null }).where(eq(users.id, userId));
  }
  await audit(userId, actor, "frozen");
  await notify(userId, "frozen", {});
}

export async function requestUnfreeze(userId: string, via: Via) {
  const ctx = await loadContext(userId);
  if (ctx.vault?.status !== "frozen") {
    await notify(userId, "nothing_to_do", { what: "frozen" }, { only: via === "telegram" ? ["telegram"] : [] });
    return;
  }
  const target = await secondChannels(userId, via);
  const { code } = await issueCode(userId, "unfreeze", { sentTo: [target.where] });
  await notify(
    userId,
    "unfreeze_code",
    { code, minutes: SAFETY.codeTtlMinutes },
    { exclude: target.exclude, threadBody: target.showInApp ? undefined : `Stabl: We sent an unfreeze code to ${target.where}.` },
  );
  if (via === "telegram") await notify(userId, "unfreeze_code_sent", { where: target.where }, { only: ["telegram"] });
  await audit(userId, "user", "unfreeze_requested", { via });
}

export async function confirmUnfreeze(userId: string, code: string): Promise<boolean> {
  const check = await checkCode(userId, "unfreeze", code);
  if (!check.ok) return false;
  const ctx = await loadContext(userId);
  if (ctx.vault) await vault.unfreeze(ctx.vault.id);
  await audit(userId, "user", "unfrozen");
  await notify(userId, "unfrozen", {});
  return true;
}

// Emergency unlock, step 1: send a code to a second channel. Two per 90 days;
// a third opens after 24 hours. Locked for 72 hours after a channel change.
export async function startEmergency(userId: string, via: Via): Promise<"sent" | "wait" | "locked" | "no_vault"> {
  const ctx = await loadContext(userId);
  if (!ctx.vault) return "no_vault";
  const [ch] = await db.select().from(channels).where(eq(channels.userId, userId));
  if (ch?.emergencyLockedUntil && ch.emergencyLockedUntil > new Date()) {
    await notify(userId, "emergency_locked", { until: when(ch.emergencyLockedUntil, ctx.user.timezone) });
    return "locked";
  }

  const used = await emergenciesUsed(userId, ctx.today);
  const left = Math.max(0, SAFETY.emergencyPerWindow - used);
  const notBefore = left === 0 ? new Date(Date.now() + SAFETY.emergencyWaitHours * 3_600_000) : undefined;
  const target = await secondChannels(userId, via);
  const { code } = await issueCode(userId, "emergency", { sentTo: [target.where], notBefore });

  if (notBefore) {
    await notify(userId, "emergency_wait", { opensAt: when(notBefore, ctx.user.timezone) });
  }
  await notify(
    userId,
    "emergency_code",
    { code, minutes: SAFETY.codeTtlMinutes, left: Math.max(0, left - 1) },
    {
      exclude: target.exclude,
      threadBody: target.showInApp ? undefined : `Stabl: Emergency unlock requested. We sent your code to ${target.where}.`,
    },
  );
  if (via === "telegram") await notify(userId, "emergency_code_sent", { where: target.where }, { only: ["telegram"] });
  await audit(userId, "user", "emergency_requested", { via, used, wait: Boolean(notBefore) });
  return notBefore ? "wait" : "sent";
}

// Step 2: the code and an amount, entered in the app. Settles the same day.
export async function confirmEmergency(
  userId: string,
  code: string,
  amountCents: number,
): Promise<{ ok: true } | { ok: false; reason: "code" | "not_yet" | "amount" | "frozen" }> {
  const ctx = await loadContext(userId);
  if (!ctx.vault || !ctx.homeBase) return { ok: false, reason: "amount" };
  if (ctx.vault.status === "frozen") return { ok: false, reason: "frozen" };
  const balance = await vault.getBalance(ctx.vault.id);
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > balance) return { ok: false, reason: "amount" };
  const check = await checkCode(userId, "emergency", code);
  if (!check.ok) return { ok: false, reason: check.reason === "not_yet" ? "not_yet" : "code" };
  await releaseNow(ctx, amountCents, "emergency", "emergency_unlock");
  return { ok: true };
}

export async function emergenciesUsed(userId: string, today: string): Promise<number> {
  const rows = await db
    .select({ id: moves.id })
    .from(moves)
    .where(
      and(
        eq(moves.userId, userId),
        eq(moves.direction, "emergency"),
        eq(moves.state, "settled"),
        gte(moves.plannedFor, addDays(today, -(SAFETY.emergencyWindowDays - 1))),
      ),
    );
  return rows.length;
}

export type HomeBaseResult = { ok: true; pending: boolean } | { ok: false; reason: "not_found" | "not_checking" | "name_mismatch" };

// First home base is set right away. A change waits 72 hours, alerts every
// channel, and blocks buffers until it clears.
export async function setHomeBase(userId: string, accountId: string): Promise<HomeBaseResult> {
  const ctx = await loadContext(userId);
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!account) return { ok: false, reason: "not_found" };
  if (account.type !== "depository" || account.subtype !== "checking") return { ok: false, reason: "not_checking" };
  if (!namesMatch(ctx.user.legalName ?? "", account.ownerNames)) return { ok: false, reason: "name_mismatch" };
  if (ctx.homeBase?.id === account.id) return { ok: true, pending: false };

  if (!ctx.homeBase) {
    await db.update(accounts).set({ isHomeBase: true }).where(eq(accounts.id, account.id));
    await audit(userId, "user", "home_base_set", { accountId });
    return { ok: true, pending: false };
  }

  const until = new Date(Date.now() + SAFETY.homeBaseWaitHours * 3_600_000);
  await db.update(users).set({ homeBasePendingAccountId: account.id, homeBasePendingUntil: until }).where(eq(users.id, userId));
  await audit(userId, "user", "home_base_change_requested", { accountId, until: until.toISOString() });
  await notify(userId, "home_base_change", {});
  return { ok: true, pending: true };
}

// Run by the daily job: a home base change whose 72 hours have passed takes effect.
export async function activatePendingHomeBase(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.homeBasePendingAccountId || !user.homeBasePendingUntil || user.homeBasePendingUntil > new Date()) return;
  const next = user.homeBasePendingAccountId;
  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ isHomeBase: false }).where(and(eq(accounts.userId, userId), eq(accounts.isHomeBase, true)));
    await tx.update(accounts).set({ isHomeBase: true }).where(eq(accounts.id, next));
    await tx.update(users).set({ homeBasePendingAccountId: null, homeBasePendingUntil: null }).where(eq(users.id, userId));
  });
  const [account] = await db.select().from(accounts).where(eq(accounts.id, next));
  await audit(userId, "engine", "home_base_changed", { accountId: next });
  await notify(userId, "home_base_active", { account: `${account.name}${account.mask ? ` ${account.mask}` : ""}` });
}
