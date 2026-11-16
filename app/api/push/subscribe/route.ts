import { eq } from "drizzle-orm";
import { z } from "zod";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { apiUser } from "@/lib/session";

const Subscription = z.object({
  endpoint: z.url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }),
});

// Save the phone's Web Push subscription. Permission is asked from a button tap.
export const POST = route(async (request) => {
  const user = await apiUser();
  const sub = Subscription.parse((await request.json()).subscription);
  await db
    .insert(channels)
    .values({ userId: user.id, pushSubscriptionJson: sub })
    .onConflictDoUpdate({ target: channels.userId, set: { pushSubscriptionJson: sub } });
  await audit(user.id, "user", "push_enabled");
  return { ok: true };
});

export const DELETE = route(async () => {
  const user = await apiUser();
  await db.update(channels).set({ pushSubscriptionJson: null }).where(eq(channels.userId, user.id));
  await audit(user.id, "user", "push_disabled");
  return { ok: true };
});
