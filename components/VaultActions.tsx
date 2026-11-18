"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents, formatTime } from "@/lib/format";
import { post } from "./api";
import { Bolt, Snow } from "./Icons";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function StopButton({ moveId, className = "btn btn-quiet px-4" }: { moveId: string; className?: string }) {
  const { busy, error, run } = useAction();
  return (
    <span>
      <button type="button" disabled={busy} className={className} onClick={() => run(() => post(`/api/moves/${moveId}/stop`), () => toast("Stopped. It stays in checking."))}>
        Stop
      </button>
      {error && <span className="ml-2 text-caption text-fast">{error}</span>}
    </span>
  );
}

type Emergency = { left: number; codeWaiting: boolean; opensAt: string | null; lockedUntil: string | null };

type SignRequest = { to: `0x${string}`; data: `0x${string}`; label: string };

// A passkey vault: the server checked the code and says what to sign. The
// person approves it with their passkey, and Stabl reads the result from Arc.
async function approveIfAsked(res: { sign?: SignRequest; moveId?: string }, opts: { unfreeze?: boolean } = {}) {
  if (!res.sign) return;
  const pk = await import("@/lib/passkey-client");
  let txHash: string;
  try {
    txHash = await pk.approveWithPasskey(res.sign);
  } catch (e) {
    throw new Error(pk.passkeyErrorMessage(e));
  }
  await post("/api/vault/signed", { txHash, moveId: res.moveId, unfreeze: opts.unfreeze });
}

// Step 1 sends a code to a second channel. Step 2 takes the code and an amount;
// the money is in checking the same day.
function EmergencyPanel({ balanceCents, emergency, frozen, timezone, onDone }: { balanceCents: number; emergency: Emergency; frozen: boolean; timezone: string; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [code, setCode] = useState("");
  const [dollars, setDollars] = useState("");
  const cents = Math.round(Number(dollars) * 100);
  const valid = /^\d{6}$/.test(code) && Number.isFinite(cents) && cents > 0 && cents <= balanceCents;

  if (emergency.lockedUntil) return <p>Paused until {formatTime(emergency.lockedUntil, timezone)} because a new Telegram account was linked.</p>;
  if (frozen) return <p>Your vault is frozen. Unfreeze it first.</p>;

  return (
    <div className="space-y-4">
      <p className="text-muted">
        A code goes to a second channel. Enter it here with an amount and it lands in checking today.
        {emergency.left === 0 ? " The next one opens 24 hours after you ask." : ` ${emergency.left} left this quarter.`}
      </p>
      {!emergency.codeWaiting ? (
        <button
          type="button"
          disabled={busy || balanceCents <= 0}
          className="btn btn-primary w-full"
          onClick={() => run(() => post("/api/vault/emergency", { action: "start" }), () => window.dispatchEvent(new Event("stabl:check-messages")))}
        >
          Send me a code
        </button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => approveIfAsked(await post<{ sign?: SignRequest; moveId?: string }>("/api/vault/emergency", { action: "confirm", code, amountCents: cents })),
              () => {
                toast(`${formatCents(cents)} sent to checking`);
                onDone();
              },
            );
          }}
        >
          {emergency.opensAt && <p className="text-caption">Opens {formatTime(emergency.opensAt, timezone)}</p>}
          <label className="block">
            <span className="label">Code from your messages</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="field figure mt-1 text-center text-[1.5rem] tracking-[0.4em]" />
          </label>
          <label className="block">
            <span className="label">Amount, up to {formatCents(balanceCents)}</span>
            <span className="relative mt-1 block">
              <span aria-hidden="true" className="figure absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-muted">$</span>
              <input value={dollars} onChange={(e) => setDollars(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="150" className="field figure pl-9 text-[1.25rem]" />
            </span>
          </label>
          <button type="submit" disabled={busy || !valid} className="btn btn-primary w-full">
            Send to checking
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-fast">
          {error}
        </p>
      )}
    </div>
  );
}

function FreezePanel({ frozen, onDone }: { frozen: boolean; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [asked, setAsked] = useState(false);
  const [code, setCode] = useState("");
  return (
    <div className="space-y-4">
      {!frozen ? (
        <>
          <p className="text-muted">Stops every move, in and out, right away. No code needed.</p>
          <button
            type="button"
            disabled={busy}
            className="btn btn-primary w-full"
            onClick={() =>
              run(
                () => post("/api/vault/freeze", { action: "freeze" }),
                () => {
                  toast("Everything is frozen");
                  onDone();
                },
              )
            }
          >
            Freeze everything
          </button>
        </>
      ) : (
        <>
          <p className="text-muted">Nothing moves until you unfreeze. A code goes to a second channel.</p>
          {!asked ? (
            <button type="button" disabled={busy} className="btn btn-primary w-full" onClick={() => run(() => post("/api/vault/freeze", { action: "unfreeze_request" }), () => setAsked(true))}>
              Send me a code
            </button>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  async () => approveIfAsked(await post<{ sign?: SignRequest }>("/api/vault/freeze", { action: "unfreeze_confirm", code }), { unfreeze: true }),
                  () => {
                    toast("Unfrozen");
                    onDone();
                  },
                );
              }}
            >
              <label htmlFor="unfreeze-code" className="label">
                Code from your messages
              </label>
              <input id="unfreeze-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="field figure text-center text-[1.5rem] tracking-[0.4em]" />
              <button type="submit" disabled={busy || code.length !== 6} className="btn btn-primary w-full">
                Unfreeze
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-fast">
          {error}
        </p>
      )}
    </div>
  );
}

// Two action cards; each opens a bottom sheet. `initial` opens one straight away
// when arriving from the quick actions on Home.
export function VaultSheets({
  balanceCents,
  emergency,
  frozen,
  timezone,
  initial,
}: {
  balanceCents: number;
  emergency: Emergency;
  frozen: boolean;
  timezone: string;
  initial: "emergency" | "freeze" | null;
}) {
  const [open, setOpen] = useState<"emergency" | "freeze" | null>(initial ?? (emergency.codeWaiting ? "emergency" : null));
  const close = () => setOpen(null);
  const tile = (key: "emergency" | "freeze", icon: React.ReactNode, title: string, sub: string) => (
    <button type="button" onClick={() => setOpen(key)} className="card press flex min-h-28 flex-col items-start justify-between p-4 text-left">
      <span className={`flex size-10 items-center justify-center rounded-[0.75rem] ${key === "emergency" ? "bg-fast/14 text-fast" : "bg-accent/12 text-accent"}`}>{icon}</span>
      <span>
        <span className="block font-bold">{title}</span>
        <span className="block text-caption text-muted">{sub}</span>
      </span>
    </button>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {tile("emergency", <Bolt className="size-5" />, "Emergency", `${emergency.left} left this quarter`)}
        {tile("freeze", <Snow className="size-5" />, frozen ? "Unfreeze" : "Freeze", frozen ? "Everything is stopped" : "Stop every move")}
      </div>
      <Sheet open={open === "emergency"} onClose={close} title="Emergency unlock">
        <EmergencyPanel balanceCents={balanceCents} emergency={emergency} frozen={frozen} timezone={timezone} onDone={close} />
      </Sheet>
      <Sheet open={open === "freeze"} onClose={close} title={frozen ? "Unfreeze" : "Freeze everything"}>
        <FreezePanel frozen={frozen} onDone={close} />
      </Sheet>
    </>
  );
}
