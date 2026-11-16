import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { apiUser } from "@/lib/session";

// The newest message, for the in app banner. Cheap enough to poll.
export const GET = route(async () => {
  const user = await apiUser();
  const [m] = await db
    .select({ id: messages.id, body: messages.body, template: messages.template, fromUser: messages.fromUser })
    .from(messages)
    .where(eq(messages.userId, user.id))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return { latest: m ? { ...m, body: m.body.replace(/^Stabl: /, "") } : null };
});
