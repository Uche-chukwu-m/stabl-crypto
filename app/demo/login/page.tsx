import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Plain } from "@/components/Plain";
import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

async function openDemo(formData: FormData) {
  "use server";
  await signIn("demo", { userId: String(formData.get("u") ?? ""), token: String(formData.get("t") ?? ""), redirectTo: "/home" });
}

// A button, not an automatic sign in, so link previews in chat apps cannot use
// up the one time link before a person taps it.
export default async function DemoLoginPage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const { u = "", t = "" } = await searchParams;
  const [user] = /^[0-9a-f-]{36}$/.test(u) ? await db.select({ name: users.name, isDemo: users.isDemo }).from(users).where(eq(users.id, u)) : [];
  return (
    <Plain>
      <h1 className="text-title">{user?.isDemo ? `Sign in as ${user.name}` : "Sign in link"}</h1>
      <p className="mt-3 text-lead">
        {user?.isDemo ? "This link works once, on this phone." : "This link is not valid. Ask for a new one."}
      </p>
      {user?.isDemo && (
        <form action={openDemo} className="mt-8">
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="btn btn-primary w-full">
            Sign in
          </button>
        </form>
      )}
    </Plain>
  );
}
