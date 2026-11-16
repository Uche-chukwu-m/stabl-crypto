import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Plain } from "@/components/Plain";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Try Stabl" };
// Reads server settings at request time, not build time.
export const dynamic = "force-dynamic";

// Judge mode: scan this, get your own copy of Jemaya, and tap Big client pays yourself.
export default async function TryPage() {
  if (!env.adminEnabled) notFound();
  const url = `${env.appUrl}/try/start`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#16241D", light: "#FBF9F4" } });
  return (
    <Plain>
      <h1 className="text-title">Try it yourself</h1>
      <p className="mt-3 text-lead">Scan to get your own copy of Jemaya, a freelance designer with uneven income. Fake bank data, no real money.</p>
      <div className="mx-auto mt-8 w-64 border border-rule" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mt-4 text-center text-caption break-all">{url}</p>
    </Plain>
  );
}
