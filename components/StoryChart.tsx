import { formatDollars } from "@/lib/format";
import { percentile } from "@/engine/money";

type Week = { week: string; incomeCents: number; buffered: number; released: number; vaultCents: number };

const W = 600;
const TOP_H = 132;
const GAP = 40;
const LOW_H = 86;
const H = TOP_H + GAP + LOW_H;

// The Stabl idea in one picture, on one timeline. Above: income, uneven, against
// the band of normal weekly spending. Below: the vault, filling in good weeks and
// draining in slow ones. Hand drawn SVG; dollars rounded.
export function StoryChart({ weeks, band }: { weeks: Week[]; band: { lowCents: number; highCents: number } }) {
  const slot = W / weeks.length;
  const bar = slot * 0.6;
  // One huge week would flatten every other bar, so the scale stops at a typical
  // good week and anything taller is drawn to the top with a break mark.
  const incomeMax = Math.max(percentile(weeks.map((w) => w.incomeCents), 0.9) * 1.5, band.highCents * 1.6, 1);
  const vaultMax = Math.max(...weeks.map((w) => w.vaultCents), 1) * 1.12;
  const yIncome = (c: number) => TOP_H - (c / incomeMax) * TOP_H;
  const yVault = (c: number) => TOP_H + GAP + LOW_H - (c / vaultMax) * LOW_H;
  const cx = (i: number) => slot * i + slot / 2;

  const points: [number, number][] = weeks.map((w, i) => [cx(i), yVault(w.vaultCents)]);
  const line = monotonePath(points);
  const area = `${line} L${cx(weeks.length - 1)},${TOP_H + GAP + LOW_H} L${cx(0)},${TOP_H + GAP + LOW_H} Z`;

  const months = weeks
    .map((w, i) => ({ i, m: w.week.slice(5, 7), label: new Date(`${w.week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) }))
    .filter((x, i, all) => i === 0 || x.m !== all[i - 1].m)
    .filter((x, i, all) => i + 1 >= all.length || all[i + 1].i - x.i >= 3);

  const incomes = weeks.map((w) => w.incomeCents);
  const inTotal = weeks.reduce((s, w) => s + w.buffered, 0);
  const outTotal = weeks.reduce((s, w) => s + w.released, 0);

  return (
    <figure>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="block h-auto w-full overflow-visible" role="img" aria-labelledby="story-title story-desc">
        <title id="story-title">Weekly income and your vault over six months</title>
        <desc id="story-desc">
          Income ran from {formatDollars(Math.min(...incomes))} to {formatDollars(Math.max(...incomes))} a week. The vault took in {formatDollars(inTotal)} and
          gave back {formatDollars(outTotal)}.
        </desc>

        {/* Income */}
        <rect x="0" width={W} y={yIncome(band.highCents)} height={Math.max(2, yIncome(band.lowCents) - yIncome(band.highCents))} fill="var(--band)" opacity="0.35" />
        {weeks.map((w, i) => {
          if (w.incomeCents <= 0) return null;
          const top = Math.max(0, yIncome(w.incomeCents));
          return (
            <g key={w.week}>
              <rect x={cx(i) - bar / 2} y={top} width={bar} height={TOP_H - top} fill="#C9A97E" />
              {w.incomeCents > incomeMax && <path d={`M${cx(i) - bar / 2 - 2} 14 l${bar + 4} -6 M${cx(i) - bar / 2 - 2} 21 l${bar + 4} -6`} stroke="var(--card)" strokeWidth="3" />}
            </g>
          );
        })}
        <line x1="0" x2={W} y1={TOP_H} y2={TOP_H} stroke="var(--rule)" />

        {/* Vault */}
        <path d={area} fill="var(--accent)" opacity="0.14" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--rule)" />
        {weeks.map((w, i) => {
          const y = yVault(w.vaultCents);
          if (w.buffered > 0) return <path key={`b${w.week}`} d={`M${cx(i) - 6} ${y - 6} L${cx(i)} ${y - 14} L${cx(i) + 6} ${y - 6} Z`} fill="var(--accent)" />;
          if (w.released > 0) return <path key={`r${w.week}`} d={`M${cx(i) - 6} ${y + 6} L${cx(i)} ${y + 14} L${cx(i) + 6} ${y + 6} Z`} fill="var(--fast)" />;
          return null;
        })}

      </svg>
      {/* Labels in HTML, so they stay readable at phone width. */}
      <p aria-hidden="true" className="label absolute left-0 top-0 -translate-y-full pb-1">Income each week</p>
      <p aria-hidden="true" className="label absolute left-0 -translate-y-full pb-1" style={{ top: `${((TOP_H + GAP) / (H + 18)) * 100}%` }}>
        Your vault
      </p>
      <div aria-hidden="true" className="relative mt-1 h-4 text-[0.6875rem] text-muted">
        {months.map((m) => (
          <span key={m.i} className="absolute -translate-x-1/2" style={{ left: `${(cx(m.i) / W) * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-4 bg-band opacity-60" /> Normal spending
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-accent">▲</span> {formatDollars(inTotal)} set aside
        </span>
        {outTotal > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-fast">▼</span> {formatDollars(outTotal)} given back
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// Monotone cubic (Fritsch and Carlson), as on the landing page: smooth, and it
// never overshoots, so a flat vault stays flat.
function monotonePath(points: [number, number][]): string {
  const n = points.length;
  if (n < 2) return n ? `M${points[0][0]},${points[0][1]}` : "";
  const slopes = points.slice(0, -1).map((p, i) => (points[i + 1][1] - p[1]) / (points[i + 1][0] - p[0]));
  const t = points.map((_, i) => (i === 0 ? slopes[0] : i === n - 1 ? slopes[n - 2] : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slopes[i];
    const b = t[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * slopes[i];
      t[i + 1] = k * b * slopes[i];
    }
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  let d = `M${r(points[0][0])},${r(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += ` C${r(x0 + h)},${r(y0 + t[i] * h)} ${r(x1 - h)},${r(y1 - t[i + 1] * h)} ${r(x1)},${r(y1)}`;
  }
  return d;
}
