import type { Metadata } from "next";
import { Plain } from "@/components/Plain";

export const metadata: Metadata = { title: "Privacy" };

// Plain words. To be reviewed by a lawyer before any real user money is involved.
export default function PrivacyPage() {
  return (
    <Plain wide>
      <h1 className="text-title">Privacy</h1>
      <p className="label mt-2">Draft for the demo build. A lawyer reviews this before any real money is involved.</p>
      <div className="mt-8 space-y-6">
        <Section title="What we collect">
          Your email, your legal name, how you earn, and the bank data you choose to connect through Plaid: accounts, balances,
          transactions, and the owner name on each account. We never store your full Social Security number, card numbers, full
          account numbers, or bank logins.
        </Section>
        <Section title="Why">
          To learn your income pattern and your normal spending, to decide when to set money aside and when to give it back, and to
          send you a message about every move.
        </Section>
        <Section title="Who sees it">
          Only Stabl and the services that run it: Plaid for bank data, our database host, and the services that deliver your
          messages (web push, Telegram if you link it, and email). We do not sell your data.
        </Section>
        <Section title="How it is protected">
          Bank access tokens are encrypted and never leave our servers. Every move and setting change is written to an audit log.
        </Section>
        <Section title="Your choices">
          You can export everything we hold about you, or delete it, from Settings. Deleting also disconnects every bank from Plaid.
        </Section>
      </div>
    </Plain>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-4">
      <h2 className="text-lead font-serif">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
