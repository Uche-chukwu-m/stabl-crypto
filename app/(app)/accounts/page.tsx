import type { Metadata } from "next";
import { HomeBaseButton, TagButtons } from "@/components/AccountActions";
import { BillStrip } from "@/components/BillStrip";
import { ConnectBank, Reconnect } from "@/components/ConnectBank";
import { LargeTitle } from "@/components/LargeTitle";
import { Monogram } from "@/components/Monogram";
import { env } from "@/lib/env";
import { formatCents, formatDay, formatDollars, formatTime, titleCase } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/session";
import { accountsView } from "@/lib/views";

export const metadata: Metadata = { title: "Accounts" };

const STATUS: Record<string, string> = {
  login_required: "Log in again",
  pending_disconnect: "Disconnecting soon",
  revoked: "Disconnected",
};

const SHADES = ["#1F5138", "#3F7A5A", "#7FA68C", "#C9A97E", "#8A5A3B"];

export default async function AccountsPage() {
  const user = await requireOnboardedUser();
  const v = await accountsView(user.id);
  const income = v.sources.filter((s) => s.tag === "income");
  const incomeTotal = income.reduce((sum, s) => sum + s.totalCents, 0) || 1;

  return (
    <div className="space-y-6">
      <LargeTitle>Accounts</LargeTitle>

      {v.pendingHomeBase && (
        <p className="card p-4 text-[0.9375rem]">
          Home base changes {v.pendingHomeBase.until ? formatTime(v.pendingHomeBase.until, user.timezone) : "soon"}. Not you? Freeze from the Vault tab.
        </p>
      )}

      {v.mysteries.length > 0 && (
        <section className="rise">
          <h2 className="label mb-2 px-1">Is this income?</h2>
          <div className="card divide-y divide-rule/50">
            {v.mysteries.map((m) => (
              <div key={m.sourceKey} className="flex items-center gap-3 p-4">
                <Monogram name={m.name} />
                <span className="min-w-0 flex-1">
                  <span className="figure block">{formatCents(m.amountCents)}</span>
                  <span className="block truncate text-caption text-muted">
                    {titleCase(m.name)} · {formatDay(m.date)}
                  </span>
                </span>
                <TagButtons sourceKey={m.sourceKey} tag={null} short />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rise rise-2">
        <h2 className="label mb-2 px-1">Connected</h2>
        <div className="space-y-3">
          {v.items.map((item) => (
            <article key={item.id} className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 px-4 pt-4">
                <span className="text-caption font-semibold text-muted">{item.institution}</span>
                {STATUS[item.status] &&
                  (item.status === "login_required" && item.env !== "local" ? <Reconnect itemId={item.id} /> : <span className="pill bg-fast/14 text-fast">{STATUS[item.status]}</span>)}
              </header>
              <ul className="divide-y divide-rule/50">
                {item.accounts.map((a) => {
                  const checking = a.type === "depository" && a.subtype === "checking";
                  const pending = v.pendingHomeBase?.accountId === a.id;
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-3.5">
                      <Monogram name={a.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {a.name} <span className="figure font-normal text-muted">{a.mask}</span>
                        </span>
                        <span className="block text-caption text-muted">{a.subtype ?? a.type}</span>
                      </span>
                      {a.isHomeBase ? (
                        <span className="pill bg-accent/12 text-accent">Home base</span>
                      ) : pending ? (
                        <span className="pill bg-fast/14 text-fast">In 72 hours</span>
                      ) : (
                        checking && <HomeBaseButton accountId={a.id} change={Boolean(v.homeBaseId)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
          <details className="card overflow-hidden">
            <summary className="press flex min-h-14 cursor-pointer items-center gap-3 px-4 font-semibold text-accent">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-[0.75rem] bg-accent/12 text-[1.25rem]">
                +
              </span>
              Add a place you get paid
            </summary>
            <div className="px-4 pb-4">
              <ConnectBank mode={env.plaidMode} />
            </div>
          </details>
        </div>
      </section>

      {v.sources.length > 0 && (
        <section className="rise rise-3">
          <h2 className="label mb-2 px-1">Where your money comes from</h2>
          <div className="card p-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label={income.map((s) => `${titleCase(s.key)} ${Math.round((s.totalCents / incomeTotal) * 100)} percent`).join(", ")}>
              {income.map((s, i) => (
                <span key={s.key} style={{ width: `${(s.totalCents / incomeTotal) * 100}%`, background: SHADES[i % SHADES.length] }} />
              ))}
            </div>
            <ul className="mt-3 divide-y divide-rule/50">
              {v.sources.map((s) => (
                <li key={s.key} className="flex items-center gap-3 py-3">
                  <Monogram name={s.key} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{titleCase(s.key)}</span>
                    <span className="block text-caption text-muted">
                      {formatDollars(s.totalCents)} · {s.count} payment{s.count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <TagButtons sourceKey={s.key} tag={s.tag} short />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {v.bills.length > 0 && (
        <section className="rise rise-4">
          <h2 className="label mb-2 px-1">Bills Stabl protects</h2>
          <div className="card p-4">
            <BillStrip bills={v.bills} />
          </div>
        </section>
      )}
    </div>
  );
}
