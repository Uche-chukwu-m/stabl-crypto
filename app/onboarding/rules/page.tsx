import { signRules } from "@/app/onboarding/actions";
import { StepForm, StepHeader } from "@/components/Onboarding";
import { onboardingUser } from "@/lib/onboarding-guard";

const RULES = [
  "Money only moves between your checking and your vault, both in your name.",
  "Your bills always come first.",
  "Slow weeks get money back right away.",
  "Emergencies unlock the same day.",
  "Every move gets a message. Freeze any time.",
];

export default async function RulesPage() {
  await onboardingUser(3);
  return (
    <>
      <StepHeader step={3} title="The rules" />
      <ol className="card mb-6 space-y-4 p-5">
        {RULES.map((r, i) => (
          <li key={r} className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-caption font-bold text-accent">{i + 1}</span>
            <span className="pt-0.5">{r}</span>
          </li>
        ))}
      </ol>
      <StepForm action={signRules} submit="Sign and continue">
        <label className="card flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3">
          <input type="checkbox" name="agree" className="size-5 accent-[var(--accent)]" />
          <span>I have read the rules and agree to them.</span>
        </label>
        <label className="block">
          <span className="label">Type your full name to sign</span>
          <input name="name" autoComplete="name" placeholder="Your full name" className="field mt-1 font-italic text-[1.25rem]" />
        </label>
      </StepForm>
    </>
  );
}
