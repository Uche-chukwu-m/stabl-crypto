"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessage } from "@/lib/views";
import { post } from "./api";
import { EmptyState } from "./EmptyState";
import { ArrowIn, ArrowOut, Bolt, Lock, Snow } from "./Icons";
import { toast } from "./Toast";

const QUICK = ["BALANCE", "HELP", "FREEZE"];

type Kind = { title: string; tone: "in" | "out" | "quiet" | "alert"; icon: React.ReactNode };

// Receipts read as cards: what happened, the amount, then the message itself.
const KINDS: Record<string, Kind> = {
  buffer_announced: { title: "Setting aside", tone: "in", icon: <ArrowIn /> },
  buffer_settled: { title: "Set aside", tone: "in", icon: <ArrowIn /> },
  release: { title: "Sent back", tone: "out", icon: <ArrowOut /> },
  release_short: { title: "Sent back", tone: "out", icon: <ArrowOut /> },
  emergency_settled: { title: "Emergency unlock", tone: "out", icon: <Bolt /> },
  emergency_code: { title: "Your code", tone: "alert", icon: <Lock /> },
  unfreeze_code: { title: "Your code", tone: "alert", icon: <Lock /> },
  frozen: { title: "Frozen", tone: "alert", icon: <Snow /> },
  home_base_change: { title: "Security", tone: "alert", icon: <Lock /> },
  buffer_skipped: { title: "Skipped", tone: "quiet", icon: <ArrowIn /> },
};

const TONE = {
  in: "bg-accent/12 text-accent",
  out: "bg-fast/14 text-fast",
  alert: "bg-fast/14 text-fast",
  quiet: "bg-sunk text-muted",
};

const REPLY_LABELS: Record<string, string> = {
  YES: "Yes, income",
  NO: "Not income",
  PAUSE: "Pause 3 months",
  KEEP: "Keep going",
  STOP: "Stop it",
  FREEZE: "Freeze",
};

// The record of every receipt and prompt, newest at the bottom, like a text
// conversation. Reply buttons and typed commands go to the same handler as
// Telegram. Polls so a move made elsewhere shows up while the screen is open.
// Times use the user's own timezone on both server and phone, so the first
// render and hydration always agree.
export function Thread({ initial, timezone }: { initial: ThreadMessage[]; timezone: string }) {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const count = useRef(0);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/messages", { cache: "no-store" });
    if (res.ok) setMessages(((await res.json()) as { messages: ThreadMessage[] }).messages);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    const now = () => void refresh();
    window.addEventListener("stabl:check-messages", now);
    return () => {
      clearInterval(id);
      window.removeEventListener("stabl:check-messages", now);
    };
  }, [refresh]);

  // Open at the newest message, and glide down when a new one arrives. The
  // window scrolls, not an anchor: the reply box is sticky, so an anchor inside
  // it always counts as in view.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: count.current === 0 || reduce ? "auto" : "smooth" });
    count.current = messages.length;
  }, [messages.length]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  function reply(m: ThreadMessage, word: string) {
    if (word === "STOP" && m.moveId) return act(() => post(`/api/moves/${m.moveId}/stop`));
    if (m.promptId && word !== "FREEZE") return act(() => post(`/api/prompts/${m.promptId}/answer`, { answer: word }));
    return act(() => post("/api/messages", { text: word }));
  }

  return (
    <div className="flex flex-col">
      {messages.length === 0 && <EmptyState text="Every move will show up here first" />}
      <ol className="space-y-2.5" aria-live="polite">
        {messages.map((m, i) => {
          const showDay = i === 0 || day(messages[i - 1].createdAt) !== day(m.createdAt);
          const kind = m.fromUser ? null : KINDS[m.template];
          const amount = kind ? m.body.match(/\$[\d,]+\.\d{2}/)?.[0] : null;
          const time = new Date(m.createdAt).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
          return (
            <li key={m.id}>
              {showDay && (
                <p className="my-4 text-center">
                  <span className="pill bg-sunk text-muted">
                    {new Date(m.createdAt).toLocaleDateString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </p>
              )}
              <div className={`flex ${m.fromUser ? "justify-end" : "justify-start"}`}>
                {m.fromUser ? (
                  <p className="max-w-[80%] rounded-[1.25rem] rounded-br-md bg-accent px-4 py-2.5 font-semibold text-on-accent">{m.body}</p>
                ) : (
                  <div className="card max-w-[88%] rounded-bl-md px-4 py-3">
                    {kind && (
                      <div className="mb-2 flex items-center gap-2">
                        <span className={`flex size-7 items-center justify-center rounded-lg ${TONE[kind.tone]}`}>{kind.icon}</span>
                        <span className="text-caption font-bold">{kind.title}</span>
                      </div>
                    )}
                    {amount && <p className="figure mb-1 text-[1.625rem] leading-tight">{amount}</p>}
                    <p className={`whitespace-pre-line ${kind ? "text-[0.9375rem] text-muted" : ""}`}>{m.body}</p>
                    <p className="mt-1.5 text-[0.6875rem] text-muted">
                      {time}
                      {m.proofUrl && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <a href={m.proofUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-current">
                            Proof
                          </a>
                        </>
                      )}
                    </p>
                    {m.replies.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.replies.map((r, j) => (
                          <button key={r} type="button" disabled={busy} onClick={() => reply(m, r)} className={`btn min-h-10 px-4 ${j === 0 ? "btn-primary" : "btn-quiet"}`}>
                            {REPLY_LABELS[r] ?? r}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <form
        className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] mt-6 bg-page pb-2 pt-3 lg:bottom-0"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText("");
          void act(() => post("/api/messages", { text: t }));
        }}
      >
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {QUICK.map((q) => (
            <button key={q} type="button" disabled={busy} className="btn btn-quiet min-h-9 shrink-0 px-4 text-caption" onClick={() => act(() => post("/api/messages", { text: q }))}>
              {q}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="command" className="sr-only">
            Reply
          </label>
          <input
            id="command"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply, like BALANCE or STOP"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={40}
            className="field rounded-full px-5"
          />
          <button type="submit" disabled={busy || !text.trim()} className="btn btn-primary">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
