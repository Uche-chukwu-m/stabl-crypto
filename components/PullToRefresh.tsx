"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PulseMark } from "./Logo";

const TRIGGER = 72;

// Pull down from the top of a screen to reload it. Home Screen apps have no
// browser reload button, so this is the way to check for a new move.
export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !document.querySelector("[role=dialog]") ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      setPull(dy > 0 ? Math.min(110, dy * 0.5) : 0);
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      setPull((p) => {
        if (p >= TRIGGER) {
          setBusy(true);
          router.refresh();
          setTimeout(() => setBusy(false), 900);
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [router]);

  const shown = busy ? TRIGGER : pull;
  if (shown === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-20 flex justify-center" style={{ transform: `translateY(${shown - 40}px)` }}>
      <span className={`rounded-full bg-card p-2 shadow-[var(--shadow-lift)] ${busy ? "animate-pulse" : ""}`} style={{ opacity: Math.min(1, shown / TRIGGER) }}>
        <PulseMark className="size-6 rounded-md" />
      </span>
    </div>
  );
}
