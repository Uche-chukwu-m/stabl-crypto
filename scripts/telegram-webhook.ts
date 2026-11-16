// npm run telegram:webhook
// Points the Telegram bot at this deployment and sets the secret Telegram sends
// back on every update. Run once after each new domain.
import "./env";
import { setTelegramWebhook } from "@/lib/channels/telegram";
import { env, requireEnv } from "@/lib/env";

requireEnv("TELEGRAM_BOT_TOKEN");
const url = `${env.appUrl}/api/telegram/webhook`;
if (!url.startsWith("https://")) throw new Error(`Telegram needs an https URL; APP_URL gives ${url}`);
const ok = await setTelegramWebhook(url, requireEnv("TELEGRAM_WEBHOOK_SECRET"));
console.log(ok ? `Telegram webhook set to ${url}` : "Telegram refused the webhook. Check the bot token.");
