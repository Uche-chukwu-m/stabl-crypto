import { Resend } from "resend";

let client: Resend | null | undefined;

function resend(): Resend | null {
  if (client === undefined) client = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return client;
}

export function emailReady(): boolean {
  return Boolean(resend() && process.env.EMAIL_FROM);
}

// Resend: backup receipts, security alerts, the Monday summary, and magic links.
// Without a key (local development) the email is printed to the server log.
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const r = resend();
  const from = process.env.EMAIL_FROM;
  if (!r || !from) {
    console.info(`[email to ${to}] ${subject}\n${text}`);
    return false;
  }
  const { error } = await r.emails.send({ from, to, subject, text, html });
  if (error) {
    console.error("email failed", error);
    return false;
  }
  return true;
}
