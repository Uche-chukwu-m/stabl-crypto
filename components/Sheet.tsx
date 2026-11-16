"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// A bottom sheet: slides up over the screen, closes on the backdrop or Escape.
// Focus moves into it and stays there while it is open. Rendered into the body,
// so an animated parent can never pin it to the middle of a screen.
const noop = () => () => {};

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // The body only exists in the browser: false while rendering on the server.
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => panel.current?.querySelectorAll<HTMLElement>("button, input, a[href], select, textarea") ?? [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const list = Array.from(focusables());
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose, mounted]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/45 [animation:fade-in_200ms_ease-out_both]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-lg rounded-t-[1.75rem] bg-card px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-lift)] [animation:sheet-up_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] sm:rounded-[1.75rem]"
      >
        <span aria-hidden="true" className="mx-auto mb-4 block h-1.5 w-10 rounded-full bg-rule" />
        <h2 className="mb-4 text-[1.375rem]">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
