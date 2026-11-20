import type { Metadata } from "next";
import Link from "next/link";
import { daysBetween } from "@/engine/dates";
import { Celebration } from "@/components/Celebration";
import { FeedList } from "@/components/FeedList";
import { Clock } from "@/components/Icons";
import { Monogram } from "@/components/Monogram";
import { StopButton } from "@/components/VaultActions";
import { VaultChart } from "@/components/VaultChart";
import { VaultHero } from "@/components/VaultHero";
import { formatCents, formatDay } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/session";
import { activityFeed, homeView } from "@/lib/views";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const [v, feed] = await Promise.all([homeView(user.id), activityFeed(user.id, { limit: 4, days: 30 })]);
  const fastFirst = v.nextFastCheck <= v.nextFeastCheck;
  const next = fastFirst ? { label: "Fast check", date: v.nextFastCheck } : { label: "Feast check", date: v.nextFeastCheck };
  const pending = v.lastMove?.state === "announced" ? v.lastMove : null;
  // The presenter account is shown on stage and on video, so it greets with the
  // brand rather than a made-up person's name.
  const first = user.isDemo ? "" : v.name.split(" ")[0];

  return (
    <div className="space-y-4">
      <Celebration move={v.lastMove} recent={Boolean(v.lastMove && daysBetween(v.lastMove.date, v.today) <= 2)} />
      <VaultHero greeting={user.isDemo ? "Stabl" : first ? `Hi, ${first}` : "Hi"} status={v.status} balanceCents={v.vaultCents} coverWeeks={v.coverWeeks} frozen={v.frozen} />

      {!v.hasMargin && (
        <p className="card rise rise-2 p-4 text-[0.9375rem]">
          Stabl works when your income covers your spending on average. Right now it does not, so we will not move money.
        </p>
      )}
      {v.frozen && <p className="card rise rise-2 p-4 text-[0.9375rem]">Your vault is frozen. Nothing moves until you unfreeze it.</p>}

      {pending && (
        <div className="card rise rise-2 flex items-center gap-3 p-4">
          <Monogram name="Stabl" vault />
          <span className="min-w-0 flex-1">
            <span className="figure block text-[1.125rem]">{formatCents(pending.amountCents)}</span>
            <span className="block text-caption text-muted">Moving to your vault tomorrow</span>
          </span>
          <StopButton moveId={pending.id} />
        </div>
      )}

      <div className="rise rise-2 grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="label">{v.checkingLabel ?? "Checking"}</p>
          <p className="figure mt-1 text-[1.375rem] leading-tight">{formatCents(v.checkingCents)}</p>
          {v.simulated && <p className="label mt-1">Simulated</p>}
        </div>
        <div className="card p-4">
          <p className="label flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {next.label}
          </p>
          <p className="mt-1 text-[1.375rem] font-bold leading-tight">{formatDay(next.date)}</p>
        </div>
      </div>

      <section className="card rise rise-3 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[1.0625rem]">Your vault</h2>
          <Link href="/home/story" className="text-caption font-semibold text-accent">
            How it works
          </Link>
        </div>
        <VaultChart weeks={v.weeks} />
      </section>

      <section className="card rise rise-4 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[1.0625rem]">Recent</h2>
          <Link href="/activity" className="text-caption font-semibold text-accent">
            See all
          </Link>
        </div>
        <FeedList items={feed} today={v.today} grouped={false} />
      </section>
    </div>
  );
}
