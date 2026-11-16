import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PulseMark } from "@/components/Logo";
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

// Until an email service is set up: straight in with an email address.
async function instant(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success) redirect("/signin?error=email");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // Generous: people at one venue share a network address.
  if (!(await rateLimit(`instant:${ip}`, 100, 900))) redirect("/signin?error=slow");
  await signIn("instant", { email, redirectTo: "/home" });
}

const ERRORS: Record<string, string> = {
  email: "That does not look like an email address.",
  slow: "Too many links asked for. Wait a few minutes and try again.",
  Verification: "That link has expired or was already used. Ask for a new one.",
  CredentialsSignin: "That did not work. Check the address and try again.",
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
        </form>
      </main>
      <p className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-[0.75rem] text-muted">Stabl is not a bank.</p>
    </div>
  );
}
