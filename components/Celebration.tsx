"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format";

type Move = { id: string; direction: "buffer" | "release" | "emergency"; amountCents: number; state: string } | null;

const KEY = "stabl:celebrated";

// A small moment when money settles: cells fill for a buffer, a calm note for a
// release. Shown once per move on this phone, and only for recent ones.
export function Celebration({ move, recent }: { move: Move; recent: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!move || !recent || move.state !== "settled") return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(KEY);
    } catch {}
    if (seen === move.id) return;
    try {
      localStorage.setItem(KEY, move.id);
    } catch {}
    const open = setTimeout(() => setShow(true), 500);
    const close = setTimeout(() => setShow(false), 3800);
    return () => {
      clearTimeout(open);
      clearTimeout(close);
    };
  }, [move, recent]);

  if (!show || !move) return null;
  const buffer = move.direction === "buffer";
  return (
    <div role="status" className="fixed inset-0 z-50 flex items-center justify-center px-8" onClick={() => setShow(false)}>
      <div className="absolute inset-0 bg-ink/40 [animation:fade-in_200ms_ease-out_both]" />
      <div className="relative w-full max-w-xs rounded-[1.75rem] bg-card p-6 text-center shadow-[var(--shadow-lift)] [animation:pop_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <div className="mx-auto grid w-40 grid-cols-6 gap-1" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-2.5 overflow-hidden rounded-full bg-sunk">
              <span className={`cell-fill block h-full rounded-full ${buffer ? "bg-accent" : "bg-fast"}`} style={{ animationDelay: `${200 + i * 90}ms` }} />
            </span>
          ))}
        </div>
        <p className="figure mt-5 text-[2rem] leading-none">{formatCents(move.amountCents)}</p>
        <p className="mt-2 text-lead font-semibold">{buffer ? "Tucked away" : "Sent back. You are covered."}</p>
        <p className="mt-1 text-caption text-muted">{buffer ? "Safe in your vault for a slow week." : "It is in checking now."}</p>
      </div>
    </div>
  );
}
