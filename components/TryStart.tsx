"use client";

import { useState } from "react";
import { post } from "./api";

export function TryStart() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={busy}
        className="btn btn-primary w-full"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            window.location.href = (await post<{ url: string }>("/api/try")).url;
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Making your copy" : "Make my copy"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-fast">
          {error}
        </p>
      )}
    </div>
  );
}
