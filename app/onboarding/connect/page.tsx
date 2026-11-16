import { eq } from "drizzle-orm";
import { finishConnect } from "@/app/onboarding/actions";
import { ConnectBank } from "@/components/ConnectBank";
import { Monogram } from "@/components/Monogram";
import { StepHeader, Submit } from "@/components/Onboarding";
import { db } from "@/lib/db";
import { accounts, plaidItems } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { onboardingUser } from "@/lib/onboarding-guard";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await onboardingUser(5);
  const { error } = await searchParams;
  const items = await db.select().from(plaidItems).where(eq(plaidItems.userId, user.id));
  const accts = await db.select().from(accounts).where(eq(accounts.userId, user.id));

  return (
    <>
      <StepHeader step={5} title="Connect your money">
        <span className="text-[1rem] text-muted">Every place you get paid. Stabl only reads them.</span>
      </StepHeader>

      {items.length > 0 && (
        <ul className="card mb-5 divide-y divide-rule/50">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <Monogram name={item.institutionName} />
              <span className="min-w-0 flex-1">
              <p className="font-semibold">{item.institutionName}</p>
              <p className="truncate text-caption text-muted">
                {accts
                  .filter((a) => a.itemId === item.id)
                  .map((a) => `${a.name}${a.mask ? ` ${a.mask}` : ""}`)
                  .join(", ")}
              </p>
              </span>
              <span className="pill bg-accent/12 text-accent">Connected</span>
            </li>
          ))}
        </ul>
      )}

      <ConnectBank mode={env.plaidMode} label={items.length ? "Add another place you get paid" : "Connect a bank"} openDemo={env.plaidMode === "local" && items.length === 0} />

      {error === "checking" && (
        <p role="alert" className="mt-6 text-fast">
          Connect at least one checking account. It will be your home base.
        </p>
      )}
      {items.length > 0 && (
        <form action={finishConnect} className="mt-8">
          <Submit>That is everything</Submit>
        </form>
      )}
    </>
  );
}
