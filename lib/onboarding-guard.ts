import { redirect } from "next/navigation";
import { ONBOARDING_DONE, requireUser, STEP_PATHS } from "@/lib/session";

// Onboarding screens: no skipping ahead, and nothing to do once finished.
export async function onboardingUser(step: number) {
  const user = await requireUser();
  if (user.onboardingStep >= ONBOARDING_DONE) redirect("/home");
  if (step > user.onboardingStep) redirect(`/onboarding/${STEP_PATHS[user.onboardingStep]}`);
  return user;
}
