import { eq } from "drizzle-orm";
import { SAFETY } from "@/engine/config";
import { sendEmail } from "@/lib/channels/email";
import { sendPush } from "@/lib/channels/push";
import { sendSms, smsReady } from "@/lib/channels/sms";
import { sendTelegram } from "@/lib/channels/telegram";
import { db } from "@/lib/db";
import { channels, messages, users } from "@/lib/db/schema";
import { render, type TemplateData, type TemplateName } from "./templates";

export type Channel = "push" | "telegram" | "email" | "sms";

type NotifyOptions = {
  // Keep a message off a channel, such as a code that must not go back to the
  // channel that asked for it.
  exclude?: Channel[];
  // Send only to these channels (the in app thread always gets it).
  only?: Channel[];
  // Write something else in the in app thread, such as a code with its digits hidden.
  threadBody?: string;
  promptId?: string;
  moveId?: string;
};

// Every event goes through here. The in app thread is written first because it
// is the record; then the message goes to every channel the user turned on.
export async function notify<T extends TemplateName>(
  userId: string,
  template: T,
  data: TemplateData<T>,
  options: NotifyOptions = {},
): Promise<{ messageId: string; sent: string[] }> {
  const msg = render(template, data);
  const [row] = await db
    .insert(messages)
    .values({
      userId,
      template,
      body: options.threadBody ?? msg.body,
      channelsSent: ["app"],
      promptId: options.promptId,
      moveId: options.moveId,
    })
    .returning({ id: messages.id });

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [ch] = await db.select().from(channels).where(eq(channels.userId, userId));
  const allowed = (c: Channel) => !options.exclude?.includes(c) && (!options.only || options.only.includes(c));
  const sent = ["app"];

  if (ch?.pushSubscriptionJson && allowed("push") && !(ch.quietHours && !msg.urgent && inQuietHours(user.timezone))) {
    const result = await sendPush(ch.pushSubscriptionJson, {
      title: "Stabl",
      body: msg.body.replace(/^Stabl: /, ""),
      url: "/messages",
      tag: template,
    });
    if (result === "sent") sent.push("push");
    if (result === "gone") await db.update(channels).set({ pushSubscriptionJson: null }).where(eq(channels.userId, userId));
  }

  if (ch?.telegramChatId && allowed("telegram")) {
    if (await sendTelegram(ch.telegramChatId, msg.body, msg.replies)) sent.push("telegram");
  }

  if (msg.email && user.email && allowed("email") && (ch?.emailEnabled ?? true) && !user.isDemo) {
    if (await sendEmail(user.email, msg.email.subject, msg.body)) sent.push("email");
  }

  if (smsReady() && allowed("sms")) await sendSms("", msg.body);

  if (sent.length > 1) await db.update(messages).set({ channelsSent: sent }).where(eq(messages.id, row.id));
  return { messageId: row.id, sent };
}

// Quiet hours are real time on the user's own clock, not the demo clock.
export function inQuietHours(timezone: string, at = new Date()): boolean {
  const hour = Number(at.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }));
  return hour >= SAFETY.quietHoursStart || hour < SAFETY.quietHoursEnd;
}

// A message the user typed, recorded in the thread so the story reads both ways.
export async function recordUserMessage(userId: string, body: string) {
  await db.insert(messages).values({ userId, template: "user", body, fromUser: true, channelsSent: ["app"] });
}
