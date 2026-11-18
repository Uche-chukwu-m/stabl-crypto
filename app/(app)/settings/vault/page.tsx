import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LargeTitle } from "@/components/LargeTitle";
import { formatCents } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/session";
import { vaultProofView } from "@/lib/views";

export const metadata: Metadata = { title: "Where your vault is held" };

const short = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="label mb-2 px-1">{title}</h2>
      <div className="card divide-y divide-rule/50 overflow-hidden">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
      <span>{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline decoration-rule underline-offset-4 hover:decoration-current">
      {children}
    </a>
  );
}

const PROMISES = [
  "Your vault is held by a contract on Arc, a network built for dollars. The contract is public, and anyone can read it.",
  "The contract can only ever pay your vault's own key. Stabl can set money aside and send it back to you, and the contract refuses to send it anywhere else.",
  "Freezing stops every move at once. While it is frozen, the contract moves nothing in or out.",
  "With a passkey, your vault's key lives on your device. Then only you can unfreeze it or unlock money from it, and Stabl can only ever send money back to you.",
];

// The only page that says this build runs on a test network. Everything else in
// the app speaks in dollars.
export default async function VaultProofPage() {
  const user = await requireOnboardedUser();
  const v = await vaultProofView(user.id);
  if (!v) notFound();

  return (
    <div className="space-y-6">
      <LargeTitle>Where your vault is held</LargeTitle>

      <div className="card rise p-5">
        <p className="font-bold">Test network. No real money moves.</p>
        <p className="mt-2 text-[0.9375rem] text-muted">
          This build runs on {v.network}. Money leaving and reaching your bank is simulated, and your vault holds test USDC, which has no value.
          {v.usdcPerDollar && <> Each dollar is held as {v.usdcPerDollar} test USDC, because the test network hands out small amounts.</>}
        </p>
      </div>

      <section className="card rise rise-2 p-5">
        <h2 className="mb-3 text-[1.0625rem]">How it is protected</h2>
        <ol className="space-y-3">
          {PROMISES.map((text, i) => (
            <li key={text} className="flex gap-3 text-[0.9375rem]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-caption font-bold text-accent">{i + 1}</span>
              {text}
            </li>
          ))}
        </ol>
      </section>

      <Group title="Check it yourself">
        <Row label="Stabl shows">
          <span className="figure">{formatCents(v.shownCents)}</span>
        </Row>
        <Row label="The contract says">
          {v.onChain ? (
            <span>
              <span className="figure">{formatCents(v.onChain.cents)}</span>
              <span className="block text-caption text-muted">{v.onChain.usdc} test USDC</span>
            </span>
          ) : (
            <span className="text-caption text-muted">Could not reach Arc just now</span>
          )}
        </Row>
        {v.matches !== null && (
          <Row label="Do they agree">
            {v.matches ? <span className="pill bg-accent/12 text-accent">Yes</span> : <span className="pill bg-sunk text-muted">Catching up</span>}
          </Row>
        )}
        <Row label="Vault contract">
          <Out href={v.contract.url}>{short(v.contract.address)}</Out>
        </Row>
        {v.wallet && (
          <>
            <Row label="Your vault wallet">
              <Out href={v.wallet.url}>{short(v.wallet.address)}</Out>
            </Row>
            <Row label="Who holds its key">
              {v.wallet.kind === "passkey" ? <span className="pill bg-accent/12 text-accent">You, with your passkey</span> : <span className="text-caption text-muted">Stabl, for now</span>}
            </Row>
          </>
        )}
      </Group>

      {v.events.length > 0 && (
        <Group title="Latest proofs">
          {v.events.map((e) => (
            <div key={e.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block font-semibold">
                  {e.label}
                  {e.cents !== null && <> {formatCents(e.cents)}</>}
                </span>
                <span className="block text-caption text-muted">
                  {new Date(e.at).toLocaleString("en-US", { timeZone: user.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {e.usdc && <>, {e.usdc} test USDC</>}
                  <span className="block">{e.source === "stream" ? "Confirmed by QuickNode Stream" : "Confirmed by reading Arc"}</span>
                </span>
              </span>
              <Out href={e.url}>Proof</Out>
            </div>
          ))}
        </Group>
      )}

      <p className="text-center text-caption text-muted">
        <Link href="/settings" className="underline underline-offset-4">
          Back to Settings
        </Link>
      </p>
    </div>
  );
}
