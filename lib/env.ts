// One place that reads configuration, so a missing key degrades a feature
// instead of crashing a route. Nothing secret here is ever sent to the browser.

export type PlaidMode = "sandbox" | "production" | "local";

export const env = {
  get plaidMode(): PlaidMode {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) return "local";
    return process.env.PLAID_ENV === "production" ? "production" : "sandbox";
  },
  get demoMode(): boolean {
    return process.env.DEMO_MODE === "true";
  },
  // Admin tools and sandbox injections are never available against real banks.
  get adminEnabled(): boolean {
    return env.demoMode && Boolean(process.env.ADMIN_KEY) && env.plaidMode !== "production";
  },
  // Demo builds without an email service sign people in straight away, no link
  // needed. Switches off by itself once Resend is set up or real banks are used.
  get instantSignIn(): boolean {
    const emailReady = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    return env.demoMode && !emailReady && env.plaidMode !== "production";
  },
  get appUrl(): string {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return "http://localhost:3000";
  },
  get telegramBotName(): string | null {
    return process.env.TELEGRAM_BOT_NAME || null;
  },
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
