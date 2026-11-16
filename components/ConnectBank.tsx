"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { post } from "./api";

type Mode = "sandbox" | "production" | "local";

const DEMO_BANKS = [
  { key: "jemaya", label: "Freelance designer", detail: "Client payments on random days" },
  { key: "jordan", label: "Car sales", detail: "Base pay plus commission on the 15th" },
  { key: "ada", label: "Catering business", detail: "Weekly card payouts with big spikes" },
  { key: "tee", label: "Mixed gig work", detail: "Spends more than comes in" },
] as const;

// Plaid Link for a real or sandbox bank, once per bank or platform. Where it is
// allowed, a demo bank gives six months of realistic history without a login.
export function ConnectBank({
  mode,
  label = "Add another place you get paid",
  onDone,
  openDemo = false,
}: {
  mode: Mode;
  label?: string;
  onDone?: () => void;
  openDemo?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(() => {
    onDone?.();
    router.refresh();
  }, [onDone, router]);

  async function demoBank(persona: string) {
    setError(null);
    setBusy(true);
    try {
      await post("/api/plaid/demo-bank", { persona });
      finish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {mode !== "local" && <PlaidButton label={label} busy={busy} setBusy={setBusy} setError={setError} onDone={finish} />}
      {mode !== "production" && (
        <details className="rounded-[1rem] bg-sunk" open={openDemo}>
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Use a demo bank</summary>
          <div className="px-3 pb-3">
            <p className="px-1 text-caption text-muted">Six months of made up history in your name. No real money.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {DEMO_BANKS.map((b) => (
                <li key={b.key}>
                  <button type="button" disabled={busy} onClick={() => demoBank(b.key)} className="press flex h-full w-full flex-col items-start rounded-[0.875rem] bg-card p-3 text-left shadow-[var(--shadow)] disabled:opacity-50">
                    <span className="font-semibold">{b.label}</span>
                    <span className="text-caption font-normal text-muted">{b.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      {busy && <p className="label">Connecting. This can take a few seconds.</p>}
      {error && (
        <p role="alert" className="text-fast">
          {error}
        </p>
      )}
    </div>
  );
}

// Plaid Link, mounted only where Plaid is configured, so its script never loads
// in local mode.
function PlaidButton({
  label,
  busy,
  setBusy,
  setError,
  onDone,
}: {
  label: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onDone: () => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      if (!publicToken) return;
      setBusy(true);
      try {
        await post("/api/plaid/exchange", { publicToken });
        onDone();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    [onDone, setBusy, setError],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit: () => setLinkToken(null) });
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function startLink() {
    setError(null);
    setBusy(true);
    try {
      setLinkToken((await post<{ linkToken: string }>("/api/plaid/link-token")).linkToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={startLink} disabled={busy} className="btn btn-primary w-full sm:w-auto">
      {label}
    </button>
  );
}

export function Reconnect({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const { open, ready } = usePlaidLink({ token, onSuccess: () => router.refresh(), onExit: () => setToken(null) });
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);
  return (
    <button type="button" className="btn btn-fast" onClick={async () => setToken((await post<{ linkToken: string }>("/api/plaid/link-token", { itemId })).linkToken)}>
      Reconnect
    </button>
  );
}
