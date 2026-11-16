"use client";

import { useState } from "react";
import { formatDay, formatDollars } from "@/lib/format";

type Week = { week: string; incomeCents: number; buffered: number; released: number; vaultCents: number };

const W = 600;
const H = 150;

// The vault over six months as one soft line. Drag a finger across it to read
// any week.
export function VaultChart({ weeks }: { weeks: Week[] }) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(...weeks.map((w) => w.vaultCents), 1) * 1.15;
  const x = (i: number) => (i / (weeks.length - 1)) * W;
  const y = (c: number) => H - 6 - (c / max) * (H - 18);
  const pts: [number, number][] = weeks.map((w, i) => [x(i), y(w.vaultCents)]);
  const line = monotone(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const shown = at === null ? weeks.length - 1 : at;
  const w = weeks[shown];

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setAt(Math.max(0, Math.min(weeks.length - 1, Math.round(((clientX - r.left) / r.width) * (weeks.length - 1)))));
  };

  return (
    <figure>
      <div className="flex items-baseline justify-between gap-3">
        <p className="figure text-[1.5rem] leading-none">{formatDollars(w.vaultCents)}</p>
        <p className="text-caption text-muted">{at === null ? "Now" : `Week of ${formatDay(w.week)}`}</p>
      </div>
      <p className="mt-1 h-5 text-caption text-muted">
        {at !== null &&
          `${formatDollars(w.incomeCents)} came in${w.buffered ? `, ${formatDollars(w.buffered)} set aside` : ""}${w.released ? `, ${formatDollars(w.released)} sent back` : ""}`}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 block h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Vault balance over 26 weeks, now ${formatDollars(weeks.at(-1)!.vaultCents)}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setAt(null)}
      >
        <defs>
          <linearGradient id="vault-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#vault-fill)" className="[animation:fade-in_600ms_ease-out_300ms_both]" />
        <path d={line} pathLength={1} className="draw-line" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {weeks.map((wk, i) =>
          wk.buffered || wk.released ? (
            <circle key={wk.week} cx={x(i)} cy={y(wk.vaultCents)} r="4" fill={wk.buffered ? "var(--accent)" : "var(--fast)"} stroke="var(--card)" strokeWidth="2" />
          ) : null,
        )}
        <line x1={x(shown)} x2={x(shown)} y1="0" y2={H} stroke="var(--text)" strokeOpacity={at === null ? 0 : 0.25} strokeWidth="1.5" />
        <circle cx={x(shown)} cy={y(w.vaultCents)} r="6.5" fill="var(--accent)" stroke="var(--card)" strokeWidth="3" />
      </svg>
    </figure>
  );
}

function monotone(points: [number, number][]): string {
  const n = points.length;
  const s = points.slice(0, -1).map((p, i) => (points[i + 1][1] - p[1]) / (points[i + 1][0] - p[0]));
  const t = points.map((_, i) => (i === 0 ? s[0] : i === n - 1 ? s[n - 2] : s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / s[i];
    const b = t[i + 1] / s[i];
    const q = a * a + b * b;
    if (q > 9) {
      t[i] = (3 / Math.sqrt(q)) * a * s[i];
      t[i + 1] = (3 / Math.sqrt(q)) * b * s[i];
    }
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  let d = `M${r(points[0][0])},${r(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (points[i + 1][0] - points[i][0]) / 3;
    d += ` C${r(points[i][0] + h)},${r(points[i][1] + t[i] * h)} ${r(points[i + 1][0] - h)},${r(points[i + 1][1] - t[i + 1] * h)} ${r(points[i + 1][0])},${r(points[i + 1][1])}`;
  }
  return d;
}
