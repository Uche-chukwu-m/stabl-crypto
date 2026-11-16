"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format";

// Money that counts up when a screen opens. Screen readers get the final figure
// straight away; reduced motion skips the count.
export function CountUp({ cents, className }: { cents: number; className?: string }) {
  const [shown, setShown] = useState(cents);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || cents === 0) return;
    const start = performance.now();
    const duration = 750;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(cents * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents]);
  return (
    <span className={className} aria-label={formatCents(cents)}>
      <span aria-hidden="true">{formatCents(shown)}</span>
    </span>
  );
}
