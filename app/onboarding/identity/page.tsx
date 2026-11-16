import { verifyIdentity } from "@/app/onboarding/actions";
import { StepForm, StepHeader } from "@/components/Onboarding";
import { onboardingUser } from "@/lib/onboarding-guard";

export default async function IdentityPage() {
  const user = await onboardingUser(4);
  return (
    <>
      <StepHeader step={4} title="Identity check">
        <span className="text-[1rem] text-muted">So your vault is opened in your name</span>
      </StepHeader>
      <StepForm action={verifyIdentity} submit="Verify">
        <label className="block">
          <span className="label">Legal name, as on your bank account</span>
          <input name="legalName" autoComplete="name" defaultValue={user.legalName ?? ""} required className="field mt-1" />
        </label>
        <label className="block">
          <span className="label">Date of birth</span>
          <input name="dob" type="date" autoComplete="bday" required className="field mt-1" />
        </label>
        <p className="text-caption text-muted">We check that you are 18 or older. We never keep your birth date.</p>
      </StepForm>
    </>
  );
}
