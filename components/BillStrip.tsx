import { formatCents, formatDollars, titleCase } from "@/lib/format";

export { titleCase };

type Bill = { payee: string; amountCents: number; dayOfMonth: number };

// The month as a line from the 1st to the 31st, with a block on each bill's due
// day, taller for bigger bills. Rent weeks show at a glance.
export function BillStrip({ bills }: { bills: Bill[] }) {
  const max = Math.max(...bills.map((b) => b.amountCents), 1);
  const total = bills.reduce((s, b) => s + b.amountCents, 0);
  const x = (day: number) => ((day - 0.5) / 31) * 100;
  return (
    <figure>
      <div className="relative h-16" role="img" aria-label={`${bills.length} bills a month, ${formatDollars(total)} in total`}>
        {[1, 8, 15, 22].map((d) => (
          <span key={d} aria-hidden="true" className="absolute inset-y-0 w-px bg-rule/40" style={{ left: `${((d - 1) / 31) * 100}%` }} />
        ))}
        {bills.map((b) => (
          <span
            key={b.payee}
            aria-hidden="true"
            className="absolute bottom-0 w-[2.6%] -translate-x-1/2 rounded-t-[3px] bg-fast"
            style={{ left: `${x(b.dayOfMonth)}%`, height: `${18 + (b.amountCents / max) * 82}%`, opacity: 0.35 + (b.amountCents / max) * 0.65 }}
          />
        ))}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-text/50" />
      </div>
      <div aria-hidden="true" className="relative mt-1 h-4 text-[0.6875rem] text-muted">
        {[1, 8, 15, 22, 31].map((d) => (
          <span key={d} className="absolute -translate-x-1/2" style={{ left: `${x(d)}%` }}>
            {d}
          </span>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-rule/50 text-[0.9375rem]">
        {[...bills]
          .sort((a, b) => a.dayOfMonth - b.dayOfMonth)
          .map((b) => (
            <li key={b.payee} className="flex items-center gap-3 py-2.5">
              <span className="figure w-6 text-right text-muted">{b.dayOfMonth}</span>
              <span className="min-w-0 flex-1 truncate">{titleCase(b.payee)}</span>
              <span className="figure">{formatCents(b.amountCents)}</span>
            </li>
          ))}
      </ul>
    </figure>
  );
}
