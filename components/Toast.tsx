"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "warn" };

// Small confirmation after an action. Any client component can call toast().
export function toast(text: string, tone: Toast["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent("stabl:toast", { detail: { text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent<{ text: string; tone: Toast["tone"] }>).detail;
      const id = ++n;
      setItems((list) => [...list.slice(-2), { id, text, tone }]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 2800);
    };
    window.addEventListener("stabl:toast", on);
    return () => window.removeEventListener("stabl:toast", on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {items.map((t) => (
        <p
          key={t.id}
          className={`pointer-events-auto rounded-full px-5 py-3 text-[0.9375rem] font-semibold shadow-[var(--shadow-lift)] [animation:pop_320ms_ease-out_both] ${
            t.tone === "ok" ? "bg-ink text-paper" : "bg-brown text-paper"
          }`}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}
