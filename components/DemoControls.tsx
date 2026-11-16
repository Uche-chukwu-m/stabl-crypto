"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./api";
import { toast } from "./Toast";

const BUTTONS = [
  { label: "Big client pays", body: { action: "inject", event: "big_client" } },
  { label: "One day later", body: { action: "advance", days: 1 } },
  { label: "Slow week", body: { action: "inject", event: "slow_week" } },
  { label: "One week later", body: { action: "advance", days: 7 } },
  { label: "New source", body: { action: "inject", event: "new_source" } },
  { label: "Huge jump", body: { action: "inject", event: "huge_jump" } },
];

export function DemoControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={Boolean(busy)}
            className="btn card min-h-12 font-semibold"
            onClick={async () => {
              setBusy(b.label);
              setError(null);
              try {
                await post("/api/demo/self", b.body);
                toast(`${b.label} done`);
                router.push("/messages");
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === b.label ? "Working" : b.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-caption text-fast">{error}</p>}
    </div>
  );
}
