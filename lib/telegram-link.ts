import { eq } from "drizzle-orm";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { env } from "@/lib/env";

// The one time deep link t.me/<bot>?start=<token>, or null when no bot is set up.
export async function telegramLink(userId: string): Promise<{ url: string | null; linked: boolean }> {
  const [ch] = await db.select().from(channels).where(eq(channels.userId, userId));
  let token = ch?.telegramLinkToken;
  if (!token) {
    token = randomToken(18);
    await db
      .insert(channels)
      .values({ userId, telegramLinkToken: token })
      .onConflictDoUpdate({ target: channels.userId, set: { telegramLinkToken: token } });
  }
  const bot = env.telegramBotName;
  return { url: bot ? `https://t.me/${bot}?start=${token}` : null, linked: Boolean(ch?.telegramChatId) };
}
