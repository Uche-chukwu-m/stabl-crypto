import webpush from "web-push";
import type { PushSubscriptionJSON } from "@/lib/db/schema";

let configured: boolean | null = null;

function ready(): boolean {
  if (configured !== null) return configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
  if (configured) webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  return configured;
}

export type PushResult = "sent" | "gone" | "skipped" | "failed";

// Web Push with VAPID keys: free, no third party. "gone" means the browser
// dropped the subscription and it should be deleted.
export async function sendPush(sub: PushSubscriptionJSON, payload: { title: string; body: string; url: string; tag?: string }): Promise<PushResult> {
  if (!ready()) return "skipped";
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: "high" });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("push failed", status ?? error);
    return "failed";
  }
}
