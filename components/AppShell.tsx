"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IncomingBanner } from "./IncomingBanner";
import { Logo } from "./Logo";
import { PullToRefresh } from "./PullToRefresh";
import { Toaster } from "./Toast";

const TABS = [
  { href: "/home", label: "Home", icon: HomeIcon, also: ["/activity"] },
  { href: "/messages", label: "Messages", icon: ThreadIcon, also: [] },
  { href: "/vault", label: "Vault", icon: VaultIcon, also: [] },
  { href: "/accounts", label: "Accounts", icon: BankIcon, also: [] },
  { href: "/settings", label: "Settings", icon: SlidersIcon, also: [] },
] as const;

// Bottom tab bar on phones, left rail on desktop. Each screen brings its own
// large title, so phones have no header bar of their own.
export function AppShell({ children, badge }: { children: React.ReactNode; badge?: string | null }) {
  const path = usePathname();
  const isActive = (t: (typeof TABS)[number]) => path.startsWith(t.href) || t.also.some((a) => path.startsWith(a));
  return (
    <div className="min-h-dvh lg:flex">
      <Toaster />
      <IncomingBanner />
      <PullToRefresh />
      <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-60 shrink-0 px-5 py-8 lg:block">
        <Link href="/home" aria-label="Stabl home" className="inline-block">
          <Logo />
        </Link>
        {badge && <p className="pill mt-3 bg-sunk text-muted">{badge}</p>}
        <ul className="mt-10 space-y-1">
          {TABS.map((t) => {
            const active = isActive(t);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`press flex min-h-11 items-center gap-3 rounded-full px-4 text-[0.9375rem] ${
                    active ? "bg-accent/12 font-semibold text-accent" : "text-muted hover:bg-sunk hover:text-text"
                  }`}
                >
                  <Icon />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-h-dvh flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-4 sm:px-6 lg:max-w-3xl lg:py-10">{children}</main>
      </div>

      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-20 bg-page pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--rule)] lg:hidden">
        <ul className="grid grid-cols-5 px-1">
          {TABS.map((t) => {
            const active = isActive(t);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`press flex min-h-[4rem] flex-col items-center justify-center gap-1 text-[0.6875rem] ${active ? "font-semibold text-accent" : "text-muted"}`}
                >
                  <span className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-accent/14" : ""}`}>
                    <Icon />
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.375rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function HomeIcon() {
  return (
    <Svg>
      <path d="M3 13h4l2.5-6 4 11 2.5-5H21" />
    </Svg>
  );
}

function ThreadIcon() {
  return (
    <Svg>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4V6a1 1 0 0 1 1-1z" />
    </Svg>
  );
}

function VaultIcon() {
  return (
    <Svg>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M12 9.5v5M9.5 12h5" />
    </Svg>
  );
}

function BankIcon() {
  return (
    <Svg>
      <path d="M3 9.5 12 4l9 5.5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" />
    </Svg>
  );
}

function SlidersIcon() {
  return (
    <Svg>
      <path d="M5 7h14M5 17h14" />
      <path d="M9 4.5v5M15 14.5v5" />
    </Svg>
  );
}
