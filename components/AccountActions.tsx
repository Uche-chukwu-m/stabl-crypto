"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api";
import { toast } from "./Toast";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function HomeBaseButton({ accountId, change }: { accountId: string; change: boolean }) {
  const { busy, error, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  if (change && !confirm) {
    return (
      <button type="button" className="btn btn-quiet min-h-9 whitespace-nowrap px-4 text-caption" onClick={() => setConfirm(true)}>
        Use as home
      </button>
    );
  }
  return (
    <div className="space-y-2">
      {change && <p className="text-caption">This takes effect in 72 hours, and no money is set aside until then. We alert every channel.</p>}
      <button type="button" disabled={busy} className="btn btn-primary" onClick={() => run(() => post("/api/accounts/home-base", { accountId }))}>
        {change ? "Yes, change home base" : "Use as home base"}
      </button>
      {error && (
        <p role="alert" className="text-fast">
          {error}
        </p>
      )}
    </div>
  );
}

export function TagButtons({ sourceKey, tag, short = false }: { sourceKey: string; tag: "income" | "not_income" | null; short?: boolean }) {
  const { busy, error, run } = useRun();
  return (
    <div className="flex shrink-0 rounded-full bg-sunk p-1" role="group" aria-label={`Is ${sourceKey} income?`}>
      {(["income", "not_income"] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={busy}
          aria-pressed={tag === t}
          onClick={() => run(() => post("/api/sources", { sourceKey, tag: t })).then(() => toast(t === "income" ? "Counts as income" : "Not counted as income"))}
          className={`press min-h-9 rounded-full px-3.5 text-caption font-semibold ${tag === t ? "bg-accent text-on-accent shadow-sm" : "text-muted"}`}
        >
          {short ? (t === "income" ? "Yes" : "No") : t === "income" ? "Income" : "Not income"}
        </button>
      ))}
      {error && <span className="text-caption text-fast">{error}</span>}
    </div>
  );
}
