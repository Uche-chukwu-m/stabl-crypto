"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { post } from "./api";

type DemoUser = { id: string; name: string; email: string; today: string; vault: string; status: string; persona: string | null };

const EVENTS = [
  { key: "big_client", label: "Big client pays", detail: "A client payment that sets aside $650.00" },
  { key: "slow_week", label: "Slow week", detail: "No income, $620.00 MIDAS AUTO 2231, rental car, a normal week" },
  { key: "new_source", label: "New source", detail: "+$300.00 ZELLE FROM K JONES" },
  { key: "huge_jump", label: "Huge jump", detail: "+$12,000.00 PAYROLL NEW EMPLOYER LLC" },
] as const;

export function AdminLogin() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await post("/api/admin/login", { key });
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label className="block">
        <span className="label">Admin key</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" className="field mt-1" />
      </label>
      {error && <p className="text-fast">{error}</p>}
      <button type="submit" className="btn btn-primary">
        Open admin
      </button>
    </form>
  );
}

export function AdminConsole({ users }: { users: DemoUser[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(users.find((u) => u.persona === "jemaya")?.id ?? users[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [qr, setQr] = useState<{ svg: string; url: string } | null>(null);
  const user = users.find((u) => u.id === userId);

  async function act(label: string, action: string, body: Record<string, unknown> = {}) {
    setBusy(label);
    const started = Date.now();
    try {
      const res = await post<{ actions?: { type: string; amountCents?: number }[]; userId?: string; url?: string }>(`/api/admin/${action}`, { userId, ...body });
      if (res.userId) setUserId(res.userId);
      if (res.url) setQr({ url: res.url, svg: await QRCode.toString(res.url, { type: "svg", margin: 1, color: { dark: "#16241D", light: "#FBF9F4" } }) });
      const did = res.actions?.map((a) => (a.amountCents ? `${a.type} $${(a.amountCents / 100).toFixed(2)}` : a.type)).join(", ");
      setLog((l) => [`${label}: ${did || "done"} (${((Date.now() - started) / 1000).toFixed(1)}s)`, ...l].slice(0, 12));
      router.refresh();
    } catch (e) {
      setLog((l) => [`${label}: ${(e as Error).message}`, ...l].slice(0, 12));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <label className="block max-w-md">
        <span className="label">Demo user</span>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="field mt-1">
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </label>
      {user && (
        <p className="text-caption">
          Clock {user.today} · {user.status} · vault {user.vault}
        </p>
      )}

      <section>
        <h2 className="font-serif text-lead">Live events</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {EVENTS.map((e) => (
            <button key={e.key} type="button" disabled={Boolean(busy)} onClick={() => act(e.label, "inject", { event: e.key })} className="btn btn-quiet h-full flex-col items-start py-3 text-left">
              <span>{e.label}</span>
              <span className="text-caption font-normal text-muted">{e.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-lead">Clock and engine</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} className="btn btn-primary" onClick={() => act("Run engine now", "run")}>
            Run engine now
          </button>
          <button type="button" disabled={Boolean(busy)} className="btn btn-quiet" onClick={() => act("Advance 1 day", "advance", { days: 1 })}>
            Advance 1 day
          </button>
          <button type="button" disabled={Boolean(busy)} className="btn btn-quiet" onClick={() => act("Advance 7 days", "advance", { days: 7 })}>
            Advance 7 days
          </button>
          <button type="button" disabled={Boolean(busy)} className="btn btn-quiet" onClick={() => act("Freeze", "freeze")}>
            Freeze
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            className="btn btn-fast"
            onClick={() => confirm("Reset this demo user to a fresh copy? Push and Telegram stay linked.") && act("Reset", "reset")}
          >
            Reset user
          </button>
        </div>
        {busy && <p className="label mt-2">{busy}…</p>}
      </section>

      <section>
        <h2 className="font-serif text-lead">Presenting phone</h2>
        <p className="mt-1 text-caption">A one time link that signs a phone in as this user. Valid for a day.</p>
        <button type="button" disabled={Boolean(busy)} className="btn btn-quiet mt-3" onClick={() => act("Sign in link", "link")}>
          Make a sign in link
        </button>
        {qr && (
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <div className="w-44 border border-rule" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <p className="max-w-sm break-all text-caption">{qr.url}</p>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-lead">Log</h2>
        <ol className="mt-2 space-y-1 text-caption">
          {log.length === 0 && <li className="text-muted">Nothing yet.</li>}
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
