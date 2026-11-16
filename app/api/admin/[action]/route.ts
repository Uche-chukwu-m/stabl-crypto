import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { ADMIN_COOKIE, adminCookieValue, isAdmin } from "@/lib/admin-auth";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { advanceClock, injectEvent, resetDemoUser, runNow } from "@/lib/demo/admin";
import { demoLoginUrl } from "@/lib/demo/login";
import { seedPersona } from "@/lib/demo/seed";
import { env } from "@/lib/env";
import { freeze } from "@/lib/security";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/session";

export const maxDuration = 300;

const Target = z.object({ userId: z.uuid() });
const Bodies = {
  inject: Target.extend({ event: z.enum(["big_client", "slow_week", "new_source", "huge_jump"]) }),
  run: Target,
  advance: Target.extend({ days: z.number().int().min(1).max(30) }),
  reset: Target,
  link: Target,
  freeze: Target,
};

// Presenter only: needs ADMIN_KEY, DEMO_MODE, and a sandbox or local bank setup.
// Every call is written to the audit log.
export const POST = route(async (request, { params }: { params: Promise<{ action: string }> }) => {
  if (!env.adminEnabled) throw new HttpError(404, "Not found");
  const { action } = await params;
  if (!(await rateLimit(`admin:${clientIp(request)}`, 120, 60))) throw new HttpError(429, "Slow down.");

  if (action === "login") {
    if (!(await rateLimit(`admin-login:${clientIp(request)}`, 10, 900))) throw new HttpError(429, "Too many tries.");
    const { key } = z.object({ key: z.string().min(1) }).parse(await request.json());
    if (!safeEqual(key, process.env.ADMIN_KEY ?? "")) throw new HttpError(401, "Wrong key.");
    (await cookies()).set(ADMIN_COOKIE, adminCookieValue(), { httpOnly: true, sameSite: "strict", secure: env.appUrl.startsWith("https"), path: "/", maxAge: 12 * 3600 });
    await audit(null, "admin", "admin_login");
    return { ok: true };
  }
  if (!(await isAdmin(request))) throw new HttpError(401, "Presenter key needed.");
  // The one presenter account. Creating it again replaces it with a fresh copy.
  if (action === "seed") {
    const { userId } = await seedPersona("jemaya");
    return { userId };
  }
  if (!(action in Bodies)) throw new HttpError(404, "Not found");

  const body = Bodies[action as keyof typeof Bodies].parse(await request.json());
  const [user] = await db.select().from(users).where(eq(users.id, body.userId));
  if (!user?.isDemo) throw new HttpError(403, "These tools only work on the presenter account.");

  switch (action) {
    case "inject": {
      const d = await injectEvent(user.id, (body as z.infer<typeof Bodies.inject>).event);
      return { actions: d.actions, status: d.status };
    }
    case "run": {
      const d = await runNow(user.id);
      return { actions: d.actions, status: d.status };
    }
    case "advance":
      await advanceClock(user.id, (body as z.infer<typeof Bodies.advance>).days);
      return { ok: true };
    case "reset":
      return { userId: await resetDemoUser(user.id) };
    case "link":
      return { url: await demoLoginUrl(user.id) };
    case "freeze":
      await freeze(user.id, "admin");
      return { ok: true };
  }
});
