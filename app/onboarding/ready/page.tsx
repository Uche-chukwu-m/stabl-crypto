import { eq } from "drizzle-orm";
import { finishOnboarding } from "@/app/onboarding/actions";
import { StepHeader, Submit } from "@/components/Onboarding";
import { PushToggle } from "@/components/PushToggle";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { channels, users } from "@/lib/db/schema";
import { formatCents } from "@/lib/format";
import { notify } from "@/lib/notify";
import { onboardingUser } from "@/lib/onboarding-guard";
import { telegramLink } from "@/lib/telegram-link";
import { vault } from "@/lib/vault/mock";

export default async function ReadyPage() {
  const user = await onboardingUser(8);
  let ctx = await loadContext(user.id);
  if (!ctx.vault) {
    const v = await vault.openAccount(user.id, user.legalName ?? user.name ?? user.email);
    // New money from here on gets a question; older credits were on step 7.
    await db.update(users).set({ promptAfter: ctx.today }).where(eq(users.id, user.id));
    const verified = Boolean(user.emailVerified);
    await db.insert(channels).values({ userId: user.id, emailVerified: verified }).onConflictDoUpdate({ target: channels.userId, set: { emailVerified: verified } });
    await notify(user.id, "vault_ready", { mask: v.mask });
    ctx = await loadContext(user.id);
  }
  const v = ctx.vault!;
  const [ch] = await db.select().from(channels).where(eq(channels.userId, user.id));
  const tg = await telegramLink(user.id);

  return (
    <>
      <StepHeader step={8} title="Your vault is ready" />
      <section className="rounded-[1.75rem] bg-green p-6 text-center text-cream [animation:pop_520ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <p className="text-caption opacity-80">Stabl Vault ending {v.mask}</p>
        <p className="figure mt-1 text-[3rem] leading-none">{formatCents(0)}</p>
        <p className="mt-3 text-caption opacity-85">
          In {v.legalName}&apos;s name at {v.partnerLabel}. Locked.
        </p>
      </section>

      <section className="card mt-5 divide-y divide-rule/50">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
          <p className="font-semibold">Phone alerts</p>
          <div>
            <PushToggle subscribed={Boolean(ch?.pushSubscriptionJson)} />
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
          <p className="font-semibold">Telegram</p>
          <div>
            {tg.linked ? (
              <span className="pill bg-accent/12 text-accent">Linked</span>
            ) : tg.url ? (
              <a href={tg.url} target="_blank" rel="noopener noreferrer" className="btn btn-quiet min-h-10 px-4">
                Link
              </a>
            ) : (
              <p className="text-caption text-muted">Not set up</p>
            )}
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
          <p className="font-semibold">Email</p>
          <p className="truncate text-caption text-muted">{user.email}</p>
        </div>
      </section>

      <form action={finishOnboarding} className="mt-10">
        <Submit>Go to Stabl</Submit>
      </form>
    </>
  );
}
