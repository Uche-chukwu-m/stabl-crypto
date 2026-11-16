import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { prompts, sourceTags } from "@/lib/db/schema";
import { apiUser } from "@/lib/session";

const Body = z.object({ sourceKey: z.string().min(1).max(80), tag: z.enum(["income", "not_income"]) });

// Label a source as income or not. The answer applies to every credit from it,
// past and future, and closes any open prompt about it.
export const POST = route(async (request) => {
  const user = await apiUser();
  const { sourceKey, tag } = Body.parse(await request.json());
  await db
    .insert(sourceTags)
    .values({ userId: user.id, sourceKey, tag, setBy: "user" })
    .onConflictDoUpdate({ target: [sourceTags.userId, sourceTags.sourceKey], set: { tag, setBy: "user" } });
  await db
    .update(prompts)
    .set({ answer: tag === "income" ? "YES" : "NO", answeredAt: new Date() })
    .where(and(eq(prompts.userId, user.id), eq(prompts.kind, "mystery"), isNull(prompts.answer), sql`${prompts.payloadJson}->>'sourceKey' = ${sourceKey}`));
  await audit(user.id, "user", "source_tagged", { sourceKey, tag });
  return { ok: true };
});
