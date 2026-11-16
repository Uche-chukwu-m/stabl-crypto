import Link from "next/link";
import { Logo } from "./Logo";
import { Toaster } from "./Toast";

// Layout for screens outside the tabs: onboarding and the legal pages.
export function Plain({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Toaster />
      <header className="px-5 pb-2 pt-[calc(1rem+env(safe-area-inset-top))]">
        <Link href="/home" aria-label="Stabl home" className="inline-block">
          <Logo />
        </Link>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-6 ${wide ? "max-w-3xl" : "max-w-lg"}`}>{children}</main>
      <footer className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 text-center text-[0.75rem] text-muted">
        <p>Demo build. No real money moves. Stabl is not a bank.</p>
        <p className="mt-1">
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
          {" · "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
