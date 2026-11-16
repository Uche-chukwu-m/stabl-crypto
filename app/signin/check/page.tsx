import type { Metadata } from "next";
import { Plain } from "@/components/Plain";
import { emailReady } from "@/lib/channels/email";

export const metadata: Metadata = { title: "Check your email" };
// Reads server settings at request time, not build time.
export const dynamic = "force-dynamic";

export default function CheckPage() {
  return (
    <Plain>
      <h1 className="text-title">Check your email</h1>
      <p className="mt-3 text-lead">We sent you a sign in link. It works once and expires in 15 minutes.</p>
      {!emailReady() && (
        <p className="mt-6 border-l-2 border-rule pl-4 text-caption">
          Email is not set up on this server yet, so the link was printed to the server log instead.
        </p>
      )}
    </Plain>
  );
}
