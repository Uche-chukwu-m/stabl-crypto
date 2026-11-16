"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PulseMark } from "./Logo";

type Latest = { id: string; body: string; template: string; fromUser: boolean } | null;

// A new receipt slides down from the top while the app is open, the way a phone
// shows an alert. Tapping it opens the thread. Hidden on Messages, which shows
// new messages itself.
export function IncomingBanner() {
  const path = usePathname();
  const [shown, setShown] = useState<NonNullable<Latest> | null>(null);
  const seen = useRef<string | null | undefined>(undefined);

  const check = useCallback(async () => {
    const res = await fetch("/api/messages/latest", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const { latest } = (await res.json()) as { latest: Latest };
    if (seen.current === undefined) {
      seen.current = latest?.id ?? null;
      return;
    }
    if (!latest || latest.id === seen.current) return;
    seen.current = latest.id;
    if (!latest.fromUser) setShown(latest);
  }, []);

  useEffect(() => {
    const now = () => void check();
    const first = setTimeout(now, 0);
    const id = setInterval(() => document.visibilityState === "visible" && now(), 3000);
    window.addEventListener("stabl:check-messages", now);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("stabl:check-messages", now);
    };
  }, [check]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown || path.startsWith("/messages")) return null;
  return (
    <div className="fixed inset-x-0 top-[calc(0.5rem+env(safe-area-inset-top))] z-50 flex justify-center px-3 [animation:sheet-down_380ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <Link
        href="/messages"
        onClick={() => setShown(null)}
        role="status"
        className="press flex w-full max-w-md items-start gap-3 rounded-[1.25rem] bg-card/98 p-3 pr-4 shadow-[var(--shadow-lift)]"
      >
        <PulseMark className="size-9 shrink-0 rounded-[0.625rem]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[0.9375rem] font-bold">Stabl</span>
            <span className="text-[0.75rem] text-muted">now</span>
          </span>
          <span className="line-clamp-3 block text-[0.875rem] leading-snug">{shown.body}</span>
        </span>
      </Link>
    </div>
  );
}
