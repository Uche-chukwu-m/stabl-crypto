import { db, type Executor } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

type Actor = "user" | "engine" | "admin";

// One row for every move, prompt answer, setting change, and admin action.
export async function audit(
  userId: string | null,
  actor: Actor,
  action: string,
  details: Record<string, unknown> = {},
  executor: Executor = db,
) {
  await executor.insert(auditLog).values({ userId, actor, action, detailsJson: details });
}
