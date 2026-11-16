import type { Metadata } from "next";
import Link from "next/link";
import { Plain } from "@/components/Plain";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <Plain>
      <h1 className="text-title">You are offline</h1>
      <p className="mt-3 text-lead">Stabl needs a connection to show your money. Your vault is safe, and nothing moves without a message.</p>
      <Link href="/replay" className="btn btn-quiet mt-8">
        Watch the replay
      </Link>
    </Plain>
  );
}
