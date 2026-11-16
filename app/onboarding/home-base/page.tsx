import { and, eq } from "drizzle-orm";
import { chooseHomeBase } from "@/app/onboarding/actions";
import { Option, StepForm, StepHeader } from "@/components/Onboarding";
import { db } from "@/lib/db";
import { accounts, plaidItems } from "@/lib/db/schema";
import { onboardingUser } from "@/lib/onboarding-guard";

export default async function HomeBasePage() {
  const user = await onboardingUser(6);
  const rows = await db
    .select({ a: accounts, institution: plaidItems.institutionName })
    .from(accounts)
    .innerJoin(plaidItems, eq(accounts.itemId, plaidItems.id))
    .where(and(eq(accounts.userId, user.id), eq(accounts.type, "depository"), eq(accounts.subtype, "checking")));

  return (
    <>
      <StepHeader step={6} title="Pick home base">
        <span className="text-[1rem] text-muted">The one account Stabl moves money with. It must be in your name.</span>
      </StepHeader>
      <StepForm action={chooseHomeBase} submit="Make this home base">
        <fieldset className="grid gap-2.5">
          <legend className="sr-only">Checking accounts</legend>
          {rows.map(({ a, institution }) => (
            <Option
              key={a.id}
              name="accountId"
              value={a.id}
              label={`${a.name}${a.mask ? ` ${a.mask}` : ""}`}
              detail={`${institution} · ${a.ownerNames.join(", ") || "owner unknown"}`}
              defaultChecked={rows.length === 1}
            />
          ))}
        </fieldset>
      </StepForm>
    </>
  );
}
