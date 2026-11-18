"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { post } from "./api";
import { Lock } from "./Icons";
import { toast } from "./Toast";

// Offered once a vault exists: move its key from Stabl to the person's device.
// After this, only their passkey can unfreeze the vault or unlock money from it.
export function PasskeyCard({ username }: { username: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<null | "passkey" | "moving">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void import("@/lib/passkey-client").then((m) => setReady(m.passkeysAvailable()));
  }, []);
  if (!ready) return null;

  async function start() {
    setError(null);
    const pk = await import("@/lib/passkey-client");
    try {
      setStep("passkey");
      const { account } = await pk.passkeyWallet("register", username);
      const { message } = await post<{ message: string }>("/api/wallet/passkey", { action: "challenge" });
      const signature = await account.signMessage({ message });
      setStep("moving");
      await post("/api/wallet/passkey", { action: "link", address: account.address, message, signature });
      toast("Your vault key is now on this device");
      router.refresh();
    } catch (e) {
      const text = (e as Error).message;
      setError(/passkey|cancel|NotAllowed|InvalidState/i.test(text) ? pk.passkeyErrorMessage(e) : text);
    } finally {
      setStep(null);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[0.75rem] bg-accent/12 text-accent">
          <Lock />
        </span>
        <span className="min-w-0">
          <span className="block font-bold">Hold your own vault key</span>
          <span className="mt-1 block text-[0.9375rem] text-muted">
            Create a passkey with Face ID or your fingerprint. Then only you can unfreeze your vault or unlock money from it. Stabl keeps setting money aside and sending it back, as always.
          </span>
        </span>
      </div>
      <button type="button" disabled={step !== null} onClick={start} className="btn btn-primary mt-4 w-full">
        {step === "passkey" ? "Waiting for your passkey" : step === "moving" ? "Moving your vault to your key" : "Create my passkey"}
      </button>
      {step === "moving" && <p className="label mt-2">This takes about half a minute. Keep this page open.</p>}
      {error && (
        <p role="alert" className="mt-2 text-fast">
          {error}
        </p>
      )}
    </section>
  );
}
