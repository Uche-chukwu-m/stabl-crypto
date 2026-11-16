"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/format";
import { PulseMark } from "./Logo";

type Step = { at: number; title: string; status: "steady" | "feast" | "fast"; vaultCents: number; note: string; message: string | null };

const WORD = { steady: "Steady", feast: "Feast", fast: "Fast" };

// The pitch, played from a local file with timed notifications. No network: it
// is precached by the service worker once the app is installed.
export function ReplayPlayer({ persona, steps }: { persona: string; steps: Step[] }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fired = useRef(new Set<number>());
  const end = steps[steps.length - 1].at + 4;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x + 0.25 >= end ? (setPlaying(false), end) : x + 0.25)), 250);
    return () => clearInterval(id);
  }, [playing, end]);

  const index = steps.reduce((acc, s, i) => (s.at <= t ? i : acc), 0);
  const step = steps[index];
  const thread = steps.slice(0, index + 1).filter((s) => s.message);

  // A real lock screen notification, if this phone allowed them. Works offline.
  useEffect(() => {
    if (!playing || !step.message || fired.current.has(index)) return;
    fired.current.add(index);
    if ("Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification("Stabl", { body: step.message!.replace(/^Stabl: /, ""), tag: `replay-${index}`, icon: "/icons/192" })).catch(() => {});
    }
  }, [index, playing, step.message]);

  const tone = step.status === "feast" ? "text-accent" : step.status === "fast" ? "text-fast" : "text-text";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : t > 0 && t < end ? "Resume" : "Play"}
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            fired.current.clear();
            setT(0);
            setPlaying(true);
          }}
        >
          Restart
        </button>
        {steps.map((s, i) => (
          <button key={s.at} type="button" aria-label={`Jump to step ${i + 1}: ${s.title}`} className={`btn px-3 ${i === index ? "btn-primary" : "btn-quiet"}`} onClick={() => setT(s.at)}>
            {i + 1}
          </button>
        ))}
      </div>

      <section className="border border-rule bg-card p-5" aria-live="polite">
        <p className="label">
          {persona} · Step {index + 1} of {steps.length}: {step.title}
        </p>
        <p className={`figure mt-2 text-hero ${tone}`}>{WORD[step.status]}</p>
        <p className="mt-2 text-lead">{step.note}</p>
        <p className="mt-4 label">Vault</p>
        <p className="figure text-stat text-accent">{formatCents(step.vaultCents)}</p>
      </section>

      {step.message && (
        <div key={index} role="status" className="flex items-start gap-3 border border-rule bg-page p-4 shadow-[0_8px_30px_rgba(22,36,29,0.12)]">
          <PulseMark className="size-8 shrink-0" />
          <div>
            <p className="font-semibold">Stabl</p>
            <p>{step.message.replace(/^Stabl: /, "")}</p>
          </div>
        </div>
      )}

      <section>
        <h2 className="font-serif text-lead">Messages</h2>
        <ol className="mt-3 space-y-3">
          {thread.map((s) => (
            <li key={s.at} className="border border-rule bg-card px-4 py-3">
              {s.message!.replace(/^Stabl: /, "")}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
