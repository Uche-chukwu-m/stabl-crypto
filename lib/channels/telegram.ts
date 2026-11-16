// Telegram Bot API over plain fetch. Free and two way: receipts go out, and
// replies like EMERGENCY or STOP come back through /api/telegram/webhook.

const API = "https://api.telegram.org";

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function telegramReady(): boolean {
  return Boolean(token());
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const t = token();
  if (!t) return null;
  const res = await fetch(`${API}/bot${t}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    console.error(`telegram ${method} failed`, json.description);
    return null;
  }
  return json.result ?? null;
}

export async function sendTelegram(chatId: string, text: string, replies?: string[]): Promise<boolean> {
  const result = await call("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replies?.length
      ? { inline_keyboard: [replies.map((r) => ({ text: r, callback_data: r }))] }
      : undefined,
  });
  return result !== null;
}

export async function answerCallback(callbackQueryId: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId });
}

export async function setTelegramWebhook(url: string, secret: string) {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}
