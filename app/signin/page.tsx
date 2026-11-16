import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PulseMark } from "@/components/Logo";
import { Monogram } from "@/components/Monogram";
import { auth, signIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const metadata: Metadata = { title: "Sign in" };

async function sendLink(formData: FormData) {
  "use server";
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) redirect("/signin?error=email");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimit(`signin:${ip}`, 8, 900)) || !(await rateLimit(`signin:${email.data}`, 4, 900))) redirect("/signin?error=slow");
  await signIn("resend", { email: email.data, redirectTo: "/home", redirect: false });
  redirect("/signin/check");
}

// Demo builds without email: straight in, no link.
async function instant(formData: FormData) {
  "use server";
  const persona = String(formData.get("persona") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!persona && !z.email().safeParse(email).success) redirect("/signin?error=email");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // Generous: judges at a venue share one network address.
  if (!(await rateLimit(`instant:${ip}`, 100, 900))) redirect("/signin?error=slow");
  await signIn("instant", persona ? { persona, redirectTo: "/home" } : { email, redirectTo: "/home" });
}

const DEMO_PEOPLE = [
  { key: "jemaya", name: "Jemaya Brooks", detail: "Freelancer, the pitch" },
  { key: "jordan", name: "Jordan Ellis", detail: "Commission sales" },
  { key: "ada", name: "Ada Okafor", detail: "Catering business" },
  { key: "tee", name: "Tee Daniels", detail: "Gig work, no margin" },
];

const ERRORS: Record<string, string> = {
  email: "That does not look like an email address.",
  slow: "Too many links asked for. Wait a few minutes and try again.",
  Verification: "That link has expired or was already used. Ask for a new one.",
  CredentialsSignin: "That did not work. If it was a demo link, it may have been used already.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user?.id) redirect("/home");
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Something went wrong. Try again.") : null;

  const quick = env.instantSignIn;

  return (
    <div className="flex min-h-dvh flex-col">
      <section className="rounded-b-[2rem] bg-green px-6 pb-10 pt-[calc(3rem+env(safe-area-inset-top))] text-cream">
        <div className="mx-auto max-w-md">
          <PulseMark className="size-14 rounded-[1rem] shadow-[0_8px_24px_rgb(0_0_0/0.25)]" />
          <h1 className="mt-6 text-[2.25rem] leading-[1.05]">Steady pay for uneven income.</h1>
          <p className="mt-3 text-lead opacity-85">Stabl saves in good weeks and pays you back in slow ones.</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-md flex-1 px-5 py-6">
        <form action={quick ? instant : sendLink} className="card space-y-3 p-5">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" className="field" />
          {message && (
            <p role="alert" className="text-fast">
              {message}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full">
            {quick ? "Continue" : "Email me a link"}
          </button>
          {quick && <p className="text-center text-caption text-muted">Demo build. Email addresses are not checked.</p>}
        </form>

        {quick && (
          <section className="mt-6">
            <h2 className="label mb-2 px-1">Or try a demo person</h2>
            <ul className="card divide-y divide-rule/50 overflow-hidden">
              {DEMO_PEOPLE.map((p) => (
                <li key={p.key}>
                  <form action={instant}>
                    <input type="hidden" name="persona" value={p.key} />
                    <button type="submit" className="press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunk">
                      <Monogram name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block truncate text-caption text-muted">{p.detail}</span>
                      </span>
                      <span aria-hidden="true" className="text-muted">
                        ›
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <p className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-[0.75rem] text-muted">Stabl is not a bank.</p>
    </div>
  );
}
