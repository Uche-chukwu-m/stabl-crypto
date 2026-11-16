import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { SAFETY } from "@/engine/config";
import { hashCode, safeEqual, sixDigitCode } from "@/lib/crypto";
import { db } from "@/lib/db";
import { codes } from "@/lib/db/schema";

type Purpose = "emergency" | "unfreeze" | "demo_login";

// One time codes: 6 digits, stored as a keyed hash, short lived, 5 tries.
export async function issueCode(
  userId: string,
  purpose: Purpose,
  opts: { sentTo: string[]; notBefore?: Date; ttlMinutes?: number; code?: string },
) {
  const code = opts.code ?? sixDigitCode();
  const start = opts.notBefore ?? new Date();
  const expiresAt = new Date(start.getTime() + (opts.ttlMinutes ?? SAFETY.codeTtlMinutes) * 60_000);
  // A new code replaces any unused one for the same purpose.
  await db.update(codes).set({ usedAt: new Date() }).where(and(eq(codes.userId, userId), eq(codes.purpose, purpose), isNull(codes.usedAt)));
  const [row] = await db
    .insert(codes)
    .values({ userId, purpose, codeHash: hashCode(code), sentTo: opts.sentTo, notBefore: opts.notBefore ?? null, expiresAt })
    .returning();
  return { code, row };
}

export type CodeCheck = { ok: true; id: string } | { ok: false; reason: "none" | "wrong" | "not_yet"; opensAt?: Date };

export async function checkCode(userId: string, purpose: Purpose, code: string): Promise<CodeCheck> {
  const [row] = await db
    .select()
    .from(codes)
    .where(and(eq(codes.userId, userId), eq(codes.purpose, purpose), isNull(codes.usedAt), gt(codes.expiresAt, new Date())))
    .orderBy(desc(codes.createdAt))
    .limit(1);
  if (!row || row.attempts >= 5) return { ok: false, reason: "none" };
  if (row.notBefore && row.notBefore > new Date()) return { ok: false, reason: "not_yet", opensAt: row.notBefore };
  if (!safeEqual(row.codeHash, hashCode(code.trim()))) {
    await db.update(codes).set({ attempts: row.attempts + 1 }).where(eq(codes.id, row.id));
    return { ok: false, reason: "wrong" };
  }
  await db.update(codes).set({ usedAt: new Date() }).where(eq(codes.id, row.id));
  return { ok: true, id: row.id };
}

export async function pendingCode(userId: string, purpose: Purpose) {
  const [row] = await db
    .select()
    .from(codes)
    .where(and(eq(codes.userId, userId), eq(codes.purpose, purpose), isNull(codes.usedAt), gt(codes.expiresAt, new Date())))
    .orderBy(desc(codes.createdAt))
    .limit(1);
  return row ?? null;
}
