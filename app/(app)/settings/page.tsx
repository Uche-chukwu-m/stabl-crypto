import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { DemoControls } from "@/components/DemoControls";
import { LargeTitle } from "@/components/LargeTitle";
import { Monogram } from "@/components/Monogram";
import { PushToggle } from "@/components/PushToggle";
import { DailyLimit, DataControls, Toggle } from "@/components/SettingsForm";
import { ENGINE } from "@/engine/config";
import { signOut } from "@/lib/auth";
import { chain } from "@/lib/chain/config";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { channels, engineProfiles } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { formatDay } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/session";
import { telegramLink } from "@/lib/telegram-link";

export const metadata: Metadata = { title: "Settings" };

async function doSignOut() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="label mb-2 px-1">{title}</h2>
      <div className="card divide-y divide-rule/50 overflow-hidden">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
      <span>{label}</span>
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const ctx = await loadContext(user.id);
  const [ch] = await db.select().from(channels).where(eq(channels.userId, user.id));
  const [profile] = await db.select().from(engineProfiles).where(eq(engineProfiles.userId, user.id));
  const tg = await telegramLink(user.id);
  const paused = Boolean(profile?.pausedUntil && profile.pausedUntil >= ctx.today);

  return (
    <div className="space-y-6">
      <LargeTitle>Settings</LargeTitle>

      <div className="card rise flex items-center gap-3 p-4">
        <Monogram name={user.name ?? user.email} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{user.name ?? "You"}</span>
          <span className="block truncate text-caption text-muted">{user.email}</span>
        </span>
        <form action={doSignOut}>
          <button type="submit" className="btn btn-quiet min-h-10 px-4 text-caption">
            Sign out
          </button>
        </form>
      </div>

      <Group title="Alerts">
        <Row label="Phone alerts">
          <PushToggle subscribed={Boolean(ch?.pushSubscriptionJson)} />
        </Row>
        <Row label="Telegram">
          {tg.linked ? (
            <span className="pill bg-accent/12 text-accent">Linked</span>
          ) : tg.url ? (
            <a href={tg.url} target="_blank" rel="noopener noreferrer" className="btn btn-quiet min-h-10 px-4">
              Link
            </a>
          ) : (
            <span className="text-caption text-muted">Not set up</span>
          )}
        </Row>
        <Toggle label="Email receipts" field="emailEnabled" value={ch?.emailEnabled ?? true} />
        <Toggle label="Quiet hours" detail="10 pm to 8 am. Releases still come through." field="quietHours" value={ch?.quietHours ?? true} />
      </Group>

      <Group title="Money">
        <DailyLimit cents={user.dailyLimitCents} max={ENGINE.dailyLimitCents} />
        <Toggle label="Pause buffering" detail={paused ? `Until ${formatDay(profile!.pausedUntil!)}` : undefined} field="pauseBuffering" value={paused} />
        <Row label="Freeze everything">
          <Link href="/vault?sheet=freeze" className="btn btn-quiet min-h-10 px-4">
            Open
          </Link>
        </Row>
      </Group>

      {user.isDemo && env.adminEnabled && (
        <section>
          <h2 className="label mb-2 px-1">Demo controls</h2>
          <DemoControls />
        </section>
      )}

      <Group title="Your data">
        <DataControls />
      </Group>

      {chain.enabled && (
        <Group title="About">
          <Row label="Where your vault is held">
            <Link href="/settings/vault" className="btn btn-quiet min-h-10 px-4">
              Open
            </Link>
          </Row>
        </Group>
      )}

      <p className="text-center text-caption text-muted">
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
      </p>
    </div>
  );
}
