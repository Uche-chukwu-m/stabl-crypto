import { verifyIdentity } from "@/app/onboarding/actions";
import { StepForm, StepHeader } from "@/components/Onboarding";
import { onboardingUser } from "@/lib/onboarding-guard";

export default async function IdentityPage() {
  const user = await onboardingUser(4);
  return (
    <>
      <StepHeader step={4} title="Identity check">
        <span className="text-[1rem] text-muted">Verified by our partner bank (simulated)</span>
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
        <label className="block">
          <span className="label">Last 4 of your Social Security number</span>
          <input name="ssn4" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required className="field figure mt-1 max-w-32 tracking-[0.3em]" />
        </label>
        <p className="text-caption text-muted">We never keep these digits or your birth date.</p>
      </StepForm>
    </>
  );
}
