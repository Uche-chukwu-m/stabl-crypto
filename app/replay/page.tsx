import type { Metadata } from "next";
import { Plain } from "@/components/Plain";
import { ReplayPlayer } from "@/components/ReplayPlayer";
import script from "./script.json";

export const metadata: Metadata = { title: "Replay" };
// Static, so the service worker can precache it for a venue with no wifi.
export const dynamic = "force-static";

export default function ReplayPage() {
  return (
    <Plain wide>
      <h1 className="text-title">The pitch, offline</h1>
      <p className="mt-2 mb-8 text-caption text-muted">Plays the demo from a file on this phone. Made up numbers, no network needed.</p>
      <ReplayPlayer persona={script.persona} steps={script.steps as never} />
    </Plain>
  );
}
