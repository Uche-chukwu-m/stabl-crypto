import type { Metadata } from "next";
import { FeedList } from "@/components/FeedList";
import { Monogram } from "@/components/Monogram";
import { StopButton, VaultSheets } from "@/components/VaultActions";
import { VaultHero } from "@/components/VaultHero";
import { formatCents, formatDay } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/session";
import { activityFeed, homeView, vaultView } from "@/lib/views";

export const metadata: Metadata = { title: "Vault" };

const RULES = [
  "Money only moves between your home base and this vault, both in your name.",
  "Locked. Only a Stabl release or your emergency unlock takes money out.",
  "Never takes money your upcoming bills need.",
  "Buffers are announced a day ahead. Releases land right away.",
  "Every move gets a message.",
];

export default async function VaultPage({ searchParams }: { searchParams: Promise<{ sheet?: string }> }) {
  const user = await requireOnboardedUser();
  const { sheet } = await searchParams;
  const [v, home, feed] = await Promise.all([vaultView(user.id), homeView(user.id), activityFeed(user.id, { days: 365 })]);
  if (!v) return <p>Your vault is not open yet.</p>;
  const frozen = v.status === "frozen";
  const moves = feed.filter((f) => f.vault);

  return (
    <div className="space-y-4">
      <VaultHero balanceCents={v.balanceCents} coverWeeks={home.coverWeeks} frozen={frozen} actions={false} />

      {v.pending.map((p) => (
        <div key={p.id} className="card rise rise-2 flex items-center gap-3 p-4">
          <Monogram name="Stabl" vault />
          <span className="min-w-0 flex-1">
            <span className="figure block text-[1.125rem]">{formatCents(p.amountCents)}</span>
            <span className="block text-caption text-muted">Moving in on {formatDay(p.settleOn, { weekday: true })}</span>
          </span>
          <StopButton moveId={p.id} />
        </div>
      ))}

      {v.onTheWay.map((p) => (
        <div key={p.id} className="card rise rise-2 flex items-center gap-3 p-4">
          <Monogram name="Stabl" vault />
          <span className="min-w-0 flex-1">
            <span className="figure block text-[1.125rem]">{formatCents(p.amountCents)}</span>
            <span className="block text-caption text-muted">{p.direction === "buffer" ? "On its way to your vault" : "On its way to checking"}</span>
          </span>
        </div>
      ))}

      <div className="rise rise-2">
        <VaultSheets
          balanceCents={v.balanceCents}
          emergency={v.emergency}
          frozen={frozen}
          timezone={user.timezone}
          initial={sheet === "emergency" || sheet === "freeze" ? sheet : null}
        />
      </div>

      <section className="card rise rise-3 p-4">
        <h2 className="mb-2 px-1 text-[1.0625rem]">History</h2>
        <FeedList items={moves} today={v.today} />
      </section>

      <details className="card rise rise-4 overflow-hidden">
        <summary className="flex min-h-14 cursor-pointer items-center justify-between px-5 font-bold">How your vault works</summary>
        <ol className="space-y-3 px-5 pb-5">
          {RULES.map((r, i) => (
            <li key={r} className="flex gap-3 text-[0.9375rem]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-caption font-bold text-accent">{i + 1}</span>
              {r}
            </li>
          ))}
        </ol>
      </details>

      <p className="px-1 text-caption text-muted">
        {v.onArc ? (
          <>
            In {v.legalName}&apos;s name, ending {v.mask}. Only you can receive this money.
          </>
        ) : (
          <>
            In {v.legalName}&apos;s name at {v.partnerLabel}, ending {v.mask}. {formatCents(v.interestCents)} interest earned at {v.apy.toFixed(2)}%.
          </>
        )}
      </p>
    </div>
  );
}
