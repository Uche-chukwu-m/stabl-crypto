import { route } from "@/lib/api";
import { seedPersona } from "@/lib/demo/seed";
import { demoLoginUrl } from "@/lib/demo/login";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/session";

export const maxDuration = 120;

// Judge mode: a fresh copy of Jemaya for whoever scanned the QR code.
export const POST = route(async (request) => {
  if (!env.adminEnabled) throw new HttpError(404, "Not found");
  if (!(await rateLimit(`try:${clientIp(request)}`, 3, 3600))) throw new HttpError(429, "One copy at a time, please.");
  const email = `jemaya+${randomToken(6).toLowerCase()}@demo.stabl.app`;
  const { userId } = await seedPersona("jemaya", { email });
  return { url: await demoLoginUrl(userId) };
});
