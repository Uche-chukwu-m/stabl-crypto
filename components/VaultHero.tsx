import Link from "next/link";
import { CountUp } from "./CountUp";
import { Bolt, Lock, Snow } from "./Icons";

type Status = "fast" | "steady" | "feast";

const STATUS = {
  fast: { word: "Fast", line: "Topping up checking" },
  steady: { word: "Steady", line: "Everything is covered" },
  feast: { word: "Feast", line: "Setting extra aside" },
} as const;

const CELLS = 8;

// The green header: what is in the vault, how many slow weeks it would carry,
// and the actions you reach for most. Brand green in both themes.
export function VaultHero({
  greeting,
  status,
  balanceCents,
  coverWeeks,
  frozen,
  actions = true,
}: {
  greeting?: string;
  status?: Status;
  balanceCents: number;
  coverWeeks: number;
  frozen: boolean;
  actions?: boolean;
}) {
  const weeks = Math.floor(coverWeeks);
  return (
    <section className="-mx-4 -mt-4 rounded-b-[2rem] bg-green px-5 pb-6 pt-[calc(1rem+env(safe-area-inset-top))] text-cream sm:-mx-6 sm:px-7 lg:mx-0 lg:mt-0 lg:rounded-[2rem] lg:pt-7">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.9375rem] font-semibold opacity-90">{greeting ?? "Your vault"}</span>
        {status ? (
          <span className="pill bg-cream/14" title={STATUS[status].line}>
            <span aria-hidden="true" className={`size-2 rounded-full ${status === "fast" ? "bg-tan" : status === "feast" ? "bg-sage" : "bg-cream"}`} />
            {STATUS[status].word}
          </span>
        ) : (
          <span className="pill bg-cream/14">
            {frozen ? <Snow className="size-3.5" /> : <Lock className="size-3.5" />}
            {frozen ? "Frozen" : "Locked"}
          </span>
        )}
      </div>

      <div className="rise mt-6 text-center">
        <p className="text-caption opacity-80">{status ? STATUS[status].line : "In your vault"}</p>
        <CountUp cents={balanceCents} className="figure mt-1 block text-[2.75rem] leading-none sm:text-[3.5rem]" />
        <div className="mx-auto mt-5 max-w-xs" role="img" aria-label={`Covers about ${weeks} week${weeks === 1 ? "" : "s"} of slow times`}>
          <div className="grid grid-cols-8 gap-1" aria-hidden="true">
            {Array.from({ length: CELLS }, (_, i) => {
              const part = Math.max(0, Math.min(1, coverWeeks - i));
              return (
                <span key={i} className="relative h-2 overflow-hidden rounded-full bg-cream/18">
                  {part > 0 && <span className="cell-fill absolute inset-y-0 left-0 rounded-full bg-cream" style={{ width: `${part * 100}%`, animationDelay: `${300 + i * 70}ms` }} />}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-caption opacity-85">
            {weeks === 0 ? "Building your cushion" : `${weeks}${coverWeeks > CELLS ? "+" : ""} week${weeks === 1 ? "" : "s"} of slow times covered`}
          </p>
        </div>
      </div>

      {actions && (
        <div className="mt-6 grid grid-cols-3 gap-2">
          <HeroAction href="/vault?sheet=emergency" label="Emergency" icon={<Bolt className="size-5" />} />
          <HeroAction href="/vault?sheet=freeze" label={frozen ? "Unfreeze" : "Freeze"} icon={<Snow className="size-5" />} />
          <HeroAction href="/activity" label="Activity" icon={<ListIcon />} />
        </div>
      )}
    </section>
  );
}

function HeroAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="press flex flex-col items-center gap-1.5 rounded-[1rem] bg-cream/12 py-3 text-[0.8125rem] font-semibold hover:bg-cream/18">
      {icon}
      {label}
    </Link>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
    </svg>
  );
}
