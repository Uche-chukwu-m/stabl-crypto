import { saveAbout } from "@/app/onboarding/actions";
import { AboutSteps, StepHeader } from "@/components/Onboarding";
import { onboardingUser } from "@/lib/onboarding-guard";

const EARN = [
  { value: "freelance", label: "Freelance" },
  { value: "commission", label: "Commission" },
  { value: "own_business", label: "My own business" },
  { value: "mix", label: "A mix" },
];
const FREQ = [
  { value: "weekly", label: "Every week" },
  { value: "every_two_weeks", label: "Every two weeks" },
  { value: "twice_a_month", label: "Twice a month" },
  { value: "monthly", label: "Once a month" },
  { value: "irregular", label: "No set pattern" },
];

export default async function AboutPage() {
  const user = await onboardingUser(2);
  return (
    <>
      <StepHeader step={2} title="About you" />
      <AboutSteps action={saveAbout} earn={EARN} freq={FREQ} earnValue={user.earnType} freqValue={user.payFrequency} />
    </>
  );
}
