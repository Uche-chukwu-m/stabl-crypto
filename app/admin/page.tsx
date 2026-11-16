import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminConsole, AdminLogin } from "@/components/AdminConsole";
import { Plain } from "@/components/Plain";
import { VAULT } from "@/engine/config";
import { isAdmin } from "@/lib/admin-auth";
import { clockFor } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, engineProfiles, ledgerEntries, users, vaultBalances, vaultAccounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { formatCents, formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "Presenter", robots: { index: false } };

export default async function AdminPage() {
  if (!env.adminEnabled) notFound();
  if (!(await isAdmin())) {
    return (
      <Plain>
        <h1 className="text-title">Presenter</h1>
        <p className="mt-2 mb-6">For the person presenting Stabl.</p>
        <AdminLogin />
      </Plain>
    );
  }

  const rows = await db
    .select({ u: users, status: engineProfiles.status, balance: vaultBalances.balanceCents })
    .from(users)
    .leftJoin(engineProfiles, eq(engineProfiles.userId, users.id))
    .leftJoin(vaultAccounts, eq(vaultAccounts.userId, users.id))
    .leftJoin(vaultBalances, eq(vaultBalances.vaultId, vaultAccounts.id))
    .where(eq(users.isDemo, true))
    .orderBy(users.name);
  const demoUsers = rows.map(({ u, status, balance }) => ({
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    persona: u.personaKey,
    today: clockFor(u).today,
    status: status ?? "new",
    vault: formatCents(balance ?? 0),
  }));

  // Stabl's interest share on average vault balances, matching the business model.
  // Users never see a fee; this is what the sponsor bank would share with Stabl.
  const [{ avg }] = await db
    .select({ avg: sql<number>`coalesce(avg(daily.total), 0)::float` })
    .from(
      db
        .select({ total: sql<number>`sum(${ledgerEntries.amountCents})`.as("total") })
        .from(ledgerEntries)
        .groupBy(ledgerEntries.vaultId)
        .as("daily"),
    );
  const [{ total }] = await db.select({ total: sql<number>`coalesce(sum(${vaultBalances.balanceCents}), 0)::int` }).from(vaultBalances);
  const share = Math.round((total * VAULT.stablSharePercent) / 100);
  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(12);

  return (
    <Plain wide>
      <h1 className="text-title">Presenter</h1>
      <p className="mt-2 text-caption">
        Tools for the presenter account. It runs on test banks, opens only from a link made here, and looks like any other account once signed in.{" "}
        <Link href="/replay" className="underline underline-offset-4">Replay</Link>
      </p>
      <div className="mt-8">
        <AdminConsole users={demoUsers} />
      </div>
      <section className="mt-10 border-t border-rule pt-6">
        <h2 className="font-serif text-lead">Business model (simulated)</h2>
        <p className="mt-2">
          All vaults hold {formatCents(total)}, {formatCents(Math.round(avg))} on average. At a {VAULT.stablSharePercent.toFixed(2)}% share, Stabl
          would earn about {formatCents(share)} a year on today&apos;s balances. Users see no fee.
        </p>
      </section>
      <section className="mt-10 border-t border-rule pt-6">
        <h2 className="font-serif text-lead">Audit log</h2>
        <ul className="mt-2 space-y-1 text-caption">
          {recent.map((r) => (
            <li key={r.id}>
              {formatTime(r.createdAt.toISOString())} · {r.actor} · {r.action}
            </li>
          ))}
        </ul>
      </section>
    </Plain>
  );
}
