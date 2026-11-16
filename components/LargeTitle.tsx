"use client";

import { useEffect, useRef, useState } from "react";

// A big title that hands off to a small one in a top bar as you scroll, the way
// native apps do.
export function LargeTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div
        aria-hidden="true"
        className={`fixed inset-x-0 top-0 z-30 border-b bg-page pt-[env(safe-area-inset-top)] transition-[opacity,border-color] duration-200 lg:left-60 ${
          compact ? "border-rule/60 opacity-100" : "pointer-events-none border-transparent opacity-0"
        }`}
      >
        <p className="flex h-12 items-center justify-center text-[1rem] font-bold">{children}</p>
      </div>
      <div className="flex items-end justify-between gap-3 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:pt-0">
        <h1 ref={ref} className="text-title">
          {children}
        </h1>
        {action}
      </div>
    </>
  );
}
