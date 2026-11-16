import { and, desc, eq, isNull } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { checkingBalance } from "@/lib/balances";
import { accountLabel, loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { prompts, sourceTags } from "@/lib/db/schema";
import { keepHeldIncome, pauseBuffering } from "@/lib/engine-runner";
import { notify, recordUserMessage, type Channel } from "@/lib/notify";
import { stopBuffer } from "@/lib/moves";
import { confirmUnfreeze, freeze, requestUnfreeze, startEmergency, type Via } from "@/lib/security";
import { vault } from "@/lib/vault";

export const COMMANDS = ["BALANCE", "STOP", "YES", "NO", "PAUSE", "KEEP", "FREEZE", "UNFREEZE", "EMERGENCY", "HELP"] as const;
export type Command = (typeof COMMANDS)[number];

// Telegram replies and in app buttons map to this one handler. Replies that only
// answer the asker go back on the channel they came from (and the thread, which
// records everything). Receipts for real changes go to every channel.
export async function handleCommand(userId: string, text: string, via: Via, opts: { promptId?: string } = {}) {
  const [word, arg] = text.trim().toUpperCase().split(/\s+/);
  const command = (COMMANDS as readonly string[]).includes(word) ? (word as Command) : null;
  await recordUserMessage(userId, text.trim().toUpperCase());
  const replyOnly: Channel[] = via === "telegram" ? ["telegram"] : [];

  switch (command) {
    case "HELP":
      return notify(userId, "help", {}, { only: replyOnly });

    case "BALANCE": {
      const ctx = await loadContext(userId);
      if (!ctx.vault || !ctx.homeBase) return notify(userId, "unknown", {}, { only: replyOnly });
      const vaultCents = await vault.getBalance(ctx.vault.id);
      const checkingCents = await checkingBalance(ctx.homeBase, ctx.today, ctx.vault.id);
      return notify(userId, "balance", { vaultCents, account: accountLabel(ctx.homeBase), checkingCents }, { only: replyOnly });
    }

    case "STOP":
      if (!(await stopBuffer(userId))) return notify(userId, "nothing_to_do", { what: "stop" }, { only: replyOnly });
      return;

    case "YES":
    case "NO": {
      const prompt = await openPrompt(userId, "mystery", opts.promptId);
      if (!prompt) return notify(userId, "nothing_to_do", { what: "mystery" }, { only: replyOnly });
      const payload = prompt.payloadJson as { sourceKey: string; name: string };
      const tag = command === "YES" ? "income" : "not_income";
      await db.update(prompts).set({ answer: command, answeredAt: new Date() }).where(eq(prompts.id, prompt.id));
      await db
        .insert(sourceTags)
        .values({ userId, sourceKey: payload.sourceKey, tag, setBy: "user" })
        .onConflictDoUpdate({ target: [sourceTags.userId, sourceTags.sourceKey], set: { tag, setBy: "user" } });
      await audit(userId, "user", "prompt_answered", { promptId: prompt.id, answer: command, sourceKey: payload.sourceKey });
      return notify(userId, "mystery_answered", { name: payload.name, income: command === "YES" }, { only: replyOnly });
    }

    case "PAUSE":
    case "KEEP": {
      const prompt = await openPrompt(userId, "jump", opts.promptId);
      if (!prompt) return notify(userId, "nothing_to_do", { what: "jump" }, { only: replyOnly });
      await db.update(prompts).set({ answer: command, answeredAt: new Date() }).where(eq(prompts.id, prompt.id));
      await audit(userId, "user", "prompt_answered", { promptId: prompt.id, answer: command });
      if (command === "PAUSE") {
        const until = await pauseBuffering(userId);
        return notify(userId, "jump_paused", { until: new Date(`${until}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric" }) });
      }
      const held = Number((prompt.payloadJson as { heldCents?: number }).heldCents ?? 0);
      const amountCents = await keepHeldIncome(userId, held);
      const ctx = await loadContext(userId);
      return notify(userId, "jump_kept", { amountCents, account: ctx.homeBase ? accountLabel(ctx.homeBase) : "checking" });
    }

    case "FREEZE":
      return freeze(userId);

    case "UNFREEZE":
      if (arg && /^\d{6}$/.test(arg)) {
        if (!(await confirmUnfreeze(userId, arg))) return notify(userId, "code_wrong", {}, { only: replyOnly });
        return;
      }
      return requestUnfreeze(userId, via);

    case "EMERGENCY":
      await startEmergency(userId, via);
      return;

    default:
      return notify(userId, "unknown", {}, { only: replyOnly });
  }
}

async function openPrompt(userId: string, kind: "mystery" | "jump", promptId?: string) {
  const [prompt] = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.userId, userId), eq(prompts.kind, kind), isNull(prompts.answer), promptId ? eq(prompts.id, promptId) : undefined))
    .orderBy(desc(prompts.createdAt))
    .limit(1);
  return prompt ?? null;
}
