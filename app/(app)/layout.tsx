import { and, eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { requireOnboardedUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const [real] = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(and(eq(plaidItems.userId, user.id), eq(plaidItems.env, "production")))
    .limit(1);
  // Real Trial plan accounts never move money; every screen says so.
  const badge = real ? "Simulated moves" : user.isDemo ? "Demo" : null;
  return (
    <AppShell badge={badge}>
      {children}
      <p className="mt-12 pb-2 text-center text-[0.75rem] text-muted">Demo build. No real money moves. Stabl is not a bank.</p>
    </AppShell>
  );
}
