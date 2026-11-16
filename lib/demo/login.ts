import { issueCode } from "@/lib/codes";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";

// A one time link that signs a phone in as a demo user, for the presenting phone
// and for judge mode. Demo users only; valid for a day; a new link replaces the old.
export async function demoLoginUrl(userId: string): Promise<string> {
  const token = randomToken(24);
  await issueCode(userId, "demo_login", { sentTo: ["link"], code: token, ttlMinutes: 24 * 60 });
  return `${env.appUrl}/demo/login?u=${userId}&t=${token}`;
}
