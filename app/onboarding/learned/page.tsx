import { confirmLearned } from "@/app/onboarding/actions";
import { TagButtons } from "@/components/AccountActions";
import { BillStrip, titleCase } from "@/components/BillStrip";
import { StepHeader, Submit } from "@/components/Onboarding";
import { formatCents, formatDay, formatDollars } from "@/lib/format";
import { learnedSummary } from "@/lib/onboarding";
import { onboardingUser } from "@/lib/onboarding-guard";

export default async function LearnedPage() {
  const user = await onboardingUser(7);
  const s = await learnedSummary(user.id);
  const months = Math.max(1, Math.round(s.historyDays / 30));
  const max = Math.max(s.avgMonthlyIncomeCents, s.expenseHighCents, 1) * 1.1;
  const pct = (c: number) => `${(c / max) * 100}%`;

  return (
    <>
      <StepHeader step={7} title="What we learned">
        <span className="text-[1rem] text-muted">
          From {months} month{months === 1 ? "" : "s"} of history
        </span>
      </StepHeader>

      <section className="card space-y-5 p-5">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="label">Income, monthly average</span>
            <span className="figure text-[1.5rem]">{formatDollars(s.avgMonthlyIncomeCents)}</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: pct(s.avgMonthlyIncomeCents) }} />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="label">Spending, normal range</span>
            <span className="figure text-[1.5rem]">
              {formatDollars(s.expenseLowCents)} to {formatDollars(s.expenseHighCents)}
            </span>
          </div>
          <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <div className="absolute inset-y-0 rounded-full bg-fast/70" style={{ left: pct(s.expenseLowCents), width: `calc(${pct(s.expenseHighCents)} - ${pct(s.expenseLowCents)})` }} />
            <div className="absolute inset-y-0 left-0 bg-fast/25" style={{ width: pct(s.expenseLowCents) }} />
          </div>
        </div>
        <p className={`text-caption ${s.hasMargin ? "text-accent" : "text-fast"}`}>
          {s.hasMargin
            ? "Income covers spending on average. Stabl can smooth it."
            : "Stabl works when your income covers your spending on average. Right now it does not, so we will not move money."}
        </p>
        {!s.ready && <p className="text-caption text-muted">About a month of history is needed before anything is set aside.</p>}
      </section>

      {s.bills.length > 0 && (
        <section className="mt-6">
          <h2 className="label mb-2 px-1">Bills we found</h2>
          <div className="card p-4">
            <BillStrip bills={s.bills} />
          </div>
        </section>
      )}

      {s.mysteries.length > 0 && (
        <section className="mt-6">
          <h2 className="label mb-2 px-1">Is this income?</h2>
          <div className="card divide-y divide-rule/50">
          {s.mysteries.map((m) => (
            <div key={m.sourceKey} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="figure block">{formatCents(m.amountCents)}</span>
                <span className="block text-caption text-muted">
                  {titleCase(m.name)} · {formatDay(m.date)}
                </span>
              </span>
              <TagButtons sourceKey={m.sourceKey} tag={null} short />
            </div>
          ))}
          </div>
        </section>
      )}

      <form action={confirmLearned} className="mt-10">
        <Submit>Looks right</Submit>
      </form>
    </>
  );
}
