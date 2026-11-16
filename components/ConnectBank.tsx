"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { post } from "./api";

type Mode = "sandbox" | "production" | "local";

// Plaid Link, once per bank or platform. Without Plaid keys (local development)
// there is no window to open, so the button connects a test bank directly.
export function ConnectBank({ mode, label = "Add another place you get paid", onDone }: { mode: Mode; label?: string; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(() => {
    onDone?.();
    router.refresh();
  }, [onDone, router]);

  async function connectLocal() {
    setError(null);
    setBusy(true);
    try {
      await post("/api/plaid/exchange", {});
      finish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {mode === "local" ? (
        <button type="button" onClick={connectLocal} disabled={busy} className="btn btn-primary w-full sm:w-auto">
          {label}
        </button>
      ) : (
        <PlaidButton label={label} busy={busy} setBusy={setBusy} setError={setError} onDone={finish} />
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
