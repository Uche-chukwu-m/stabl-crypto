import type { Metadata } from "next";
import { Plain } from "@/components/Plain";

export const metadata: Metadata = { title: "Terms" };

// Plain words. To be reviewed by a lawyer before any real user money is involved.
export default function TermsPage() {
  const rules = [
    "This is an early build that runs on a test network. No real money moves, and Stabl is not a bank.",
    "Stabl moves money only between your home base checking account and your own vault, both in your name.",
    "Stabl never takes money if it would leave less in checking than your upcoming bills plus a small floor.",
    "Buffers are announced the day before and you can stop them. Releases happen right away.",
    "Your vault is locked. Emergency unlocks need a code sent to a second channel, and settle the same day.",
    "You can freeze everything at any time, from any channel, without a code.",
    "Every move gets a message. Nothing happens silently.",
    "There is no fee or subscription in this build.",
  ];
  return (
    <Plain wide>
      <h1 className="text-title">Terms</h1>
      <p className="label mt-2">Draft. A lawyer reviews this before any real money is involved.</p>
      <ol className="mt-8 space-y-4">
        {rules.map((r, i) => (
          <li key={r} className="flex gap-4 border-t border-rule pt-4">
            <span className="figure text-muted">{i + 1}</span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
    </Plain>
  );
}
