import { route } from "@/lib/api";
import { learnedSummary } from "@/lib/onboarding";
import { apiUser } from "@/lib/session";

// The learning pass for onboarding step 7.
export const POST = route(async () => {
  const user = await apiUser();
  return learnedSummary(user.id);
});
