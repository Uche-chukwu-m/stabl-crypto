"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents } from "@/lib/format";
import { post } from "./api";
import { toast } from "./Toast";

export function Toggle({ label, detail, field, value }: { label: string; detail?: string; field: string; value: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(value);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div>
        <p>{label}</p>
        {detail && <p className="text-caption text-muted">{detail}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post("/api/settings", { [field]: !on });
            setOn(!on);
            toast(`${label} ${on ? "off" : "on"}`);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        className={`relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-sunk"}`}
      >
        <span className={`absolute top-1 size-6 rounded-full bg-paper shadow transition-[left] duration-200 ${on ? "left-[1.5rem]" : "left-1"}`} />
      </button>
    </div>
  );
}

export function DailyLimit({ cents, max }: { cents: number; max: number }) {
  const router = useRouter();
  const [dollars, setDollars] = useState(String(cents / 100));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          const value = Math.round(Number(dollars) * 100);
          await post("/api/settings", { dailyLimitCents: value });
          setMsg(null);
          toast(`Daily limit ${formatCents(value)}`);
          router.refresh();
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="limit">Daily limit</label>
        <div className="flex gap-2">
          <span className="relative">
            <span aria-hidden="true" className="figure absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input id="limit" value={dollars} onChange={(e) => setDollars(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="field figure min-h-11 w-28 py-2 pl-7" aria-describedby="limit-max" />
          </span>
          <button type="submit" className="btn btn-quiet min-h-11 px-4">
            Save
          </button>
        </div>
      </div>
      <p id="limit-max" className="sr-only">
        At most {formatCents(max)}
      </p>
      {msg && <p className="mt-2 text-caption">{msg}</p>}
    </form>
  );
}

export function DataControls() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="divide-y divide-rule">
      <form method="post" action="/api/me/export" target="_blank" className="flex items-center justify-between gap-3 px-4 py-3">
        <span>Export my data</span>
        <button type="submit" className="btn btn-quiet min-h-11 px-4">
          Download
        </button>
      </form>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span>Delete my data</span>
          <button type="button" className="btn btn-fast min-h-11 px-4" onClick={() => setOpen(!open)} aria-expanded={open}>
            Delete
          </button>
        </div>
        {open && (
          <form
            className="mt-3 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post("/api/me/delete", { confirm });
                router.push("/signin");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <label htmlFor="delete" className="text-caption text-muted">
              Erases everything and disconnects every bank. Type DELETE.
            </label>
            <div className="flex gap-2">
              <input id="delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="field" />
              <button type="submit" disabled={confirm !== "DELETE"} className="btn btn-fast">
                Confirm
              </button>
            </div>
            {error && (
              <p role="alert" className="text-caption text-fast">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
