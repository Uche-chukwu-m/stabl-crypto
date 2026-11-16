"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

// Step N of 8, with a thin progress bar. Step 1 is signing in.
export function StepHeader({ step, title, children }: { step: number; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-7">
      <div className="h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(step / 8) * 100}%` }} />
      </div>
      <p className="label mt-3">Step {step} of 8</p>
      <h1 className="mt-2 text-[2rem] leading-[1.1]">{title}</h1>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </header>
  );
}

export function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? "One moment" : children}
    </button>
  );
}

// A big tappable choice: a hidden radio inside a card that lights up when picked.
export function Option({ name, value, label, detail, defaultChecked, onPick }: { name: string; value: string; label: string; detail?: string; defaultChecked?: boolean; onPick?: () => void }) {
  return (
    <label className="card press flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 outline-2 outline-transparent has-[:checked]:outline has-[:checked]:outline-[var(--accent)] has-[:focus-visible]:outline has-[:focus-visible]:outline-[var(--accent)]">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} required className="peer sr-only" onChange={onPick} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {detail && <span className="block text-caption text-muted">{detail}</span>}
      </span>
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-rule peer-checked:border-accent peer-checked:bg-accent peer-checked:[&>span]:opacity-100">
        <span className="size-2 rounded-full bg-on-accent opacity-0" />
      </span>
    </label>
  );
}

type Action = (state: { error?: string } | undefined, form: FormData) => Promise<{ error?: string } | undefined>;

// A form wired to a server action that may return { error }.
export function StepForm({ action, children, submit }: { action: Action; children: React.ReactNode; submit: string }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-5">
      {children}
      {state?.error && (
        <p role="alert" className="rounded-[0.875rem] bg-fast/12 px-4 py-3 text-fast">
          {state.error}
        </p>
      )}
      <Submit>{submit}</Submit>
    </form>
  );
}

// Step 2 asks one question per screen: picking an answer slides to the next.
// The hidden screen is inert, not disabled, so its answer is still submitted.
export function AboutSteps({
  action,
  earn,
  freq,
  earnValue,
  freqValue,
}: {
  action: Action;
  earn: { value: string; label: string }[];
  freq: { value: string; label: string }[];
  earnValue: string | null;
  freqValue: string | null;
}) {
  const [screen, setScreen] = useState(0);
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction}>
      <div className="overflow-hidden">
        <div className="flex w-[200%] transition-transform duration-300 ease-out" style={{ transform: `translateX(${screen === 0 ? "0" : "-50%"})` }}>
          <fieldset className="w-1/2 space-y-2.5 pr-1" inert={screen !== 0}>
            <legend className="mb-3 text-[1.375rem] font-bold">How do you earn?</legend>
            {earn.map((o) => (
              <Option key={o.value} name="earnType" value={o.value} label={o.label} defaultChecked={earnValue === o.value} onPick={() => setTimeout(() => setScreen(1), 180)} />
            ))}
          </fieldset>
          <fieldset className="w-1/2 space-y-2.5 pl-1" inert={screen !== 1}>
            <legend className="mb-3 text-[1.375rem] font-bold">How often does money land?</legend>
            {freq.map((o) => (
              <Option key={o.value} name="payFrequency" value={o.value} label={o.label} defaultChecked={freqValue === o.value} />
            ))}
          </fieldset>
        </div>
      </div>
      {state?.error && (
        <p role="alert" className="mt-4 rounded-[0.875rem] bg-fast/12 px-4 py-3 text-fast">
          {state.error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        {screen === 1 && (
          <button type="button" className="btn btn-quiet" onClick={() => setScreen(0)}>
            Back
          </button>
        )}
        {screen === 0 ? (
          <button type="button" className="btn btn-primary flex-1" onClick={() => setScreen(1)}>
            Next
          </button>
        ) : (
          <div className="flex-1">
            <Submit>Continue</Submit>
          </div>
        )}
      </div>
    </form>
  );
}
