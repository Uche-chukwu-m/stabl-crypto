import { eq } from "drizzle-orm";
import { SAFETY } from "@/engine/config";
import { audit } from "@/lib/audit";
import { answerCallback } from "@/lib/channels/telegram";
import { handleCommand } from "@/lib/commands";
import { randomToken, safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

// Telegram sends back the secret_token set at setWebhook in this header. Anything
// without it is rejected, and chats that are not linked to a user are ignored.
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(header, secret)) return new Response(null, { status: 401 });

  const update = (await request.json()) as Update;
  try {
    if (update.callback_query) {
      const q = update.callback_query;
      await answerCallback(q.id);
      if (q.message && q.data) await fromChat(String(q.message.chat.id), q.data);
    } else if (update.message?.text) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text.trim();
      const start = text.match(/^\/start\s+(\S+)$/);
      if (start) await link(chatId, start[1]);
      else await fromChat(chatId, text.replace(/^\//, ""));
    }
  } catch (error) {
    console.error("telegram webhook", error);
  }
  // Always 200, or Telegram retries the same update.
  return Response.json({ ok: true });
}

async function fromChat(chatId: string, text: string) {
  const [ch] = await db.select().from(channels).where(eq(channels.telegramChatId, chatId));
  if (!ch) return;
  if (!(await rateLimit(`tg:${chatId}`, 20, 60))) return;
  await handleCommand(ch.userId, text, "telegram");
}

// One time deep link t.me/<bot>?start=<token>. A new Telegram account replacing an
// old one pauses emergency unlocks for 72 hours (SIM swap protection).
async function link(chatId: string, token: string) {
  const [ch] = await db.select().from(channels).where(eq(channels.telegramLinkToken, token));
  if (!ch) return;
  const changed = Boolean(ch.telegramChatId && ch.telegramChatId !== chatId);
  await db
    .update(channels)
    .set({
      telegramChatId: chatId,
      telegramLinkToken: randomToken(18),
      ...(changed ? { emergencyLockedUntil: new Date(Date.now() + SAFETY.channelChangeLockHours * 3_600_000) } : {}),
    })
    .where(eq(channels.userId, ch.userId));
  await audit(ch.userId, "user", "telegram_linked", { changed });
  await notify(ch.userId, "telegram_linked", {}, { only: ["telegram"] });
}
