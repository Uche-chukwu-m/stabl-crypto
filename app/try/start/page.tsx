import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plain } from "@/components/Plain";
import { TryStart } from "@/components/TryStart";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Your copy of Jemaya" };
// Reads server settings at request time, not build time.
export const dynamic = "force-dynamic";

export default function TryStartPage() {
  if (!env.adminEnabled) notFound();
  return (
    <Plain>
      <h1 className="text-title">Your copy of Jemaya</h1>
      <p className="mt-3 text-lead">
        We will make a fresh demo account with six months of Jemaya&apos;s history. Then link your Telegram in Settings and press Big client pays under Demo controls.
      </p>
      <TryStart />
    </Plain>
  );
}
