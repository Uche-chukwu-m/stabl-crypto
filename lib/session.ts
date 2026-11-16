import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const ONBOARDING_DONE = 9;

// Server components: the signed in user, or a trip to sign in.
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user) redirect("/signin");
  return user;
}

// Screens after onboarding: send anyone mid onboarding back to their step.
export async function requireOnboardedUser() {
  const user = await requireUser();
  if (user.onboardingStep < ONBOARDING_DONE) redirect(`/onboarding/${STEP_PATHS[user.onboardingStep] ?? "about"}`);
  return user;
}

export const STEP_PATHS: Record<number, string> = {
  2: "about",
  3: "rules",
  4: "identity",
  5: "connect",
  6: "home-base",
  7: "learned",
  8: "ready",
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Route handlers: the signed in user id, or a 401.
export async function apiUser() {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Sign in first");
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user) throw new HttpError(401, "Sign in first");
  return user;
}
