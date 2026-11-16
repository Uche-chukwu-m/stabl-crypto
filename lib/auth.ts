import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { sendEmail } from "@/lib/channels/email";
import { checkCode } from "@/lib/codes";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { PERSONAS } from "@/personas";
import { z } from "zod";
import { authAccounts, authVerificationTokens, users } from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name?: string | null };
  }
}

const config: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: authAccounts,
    verificationTokensTable: authVerificationTokens,
  } as never),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", verifyRequest: "/signin/check", error: "/signin" },
  providers: [
    // Email magic link, sent by Resend. No passwords to store. Without a Resend key
    // (local development) the link is printed to the server log instead.
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "local",
      from: process.env.EMAIL_FROM ?? "Stabl <onboarding@resend.dev>",
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        const text = `Sign in to Stabl:\n${url}\n\nThis link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.`;
        const html = `<p>Sign in to Stabl.</p><p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#1F5138;color:#F1EEE3;text-decoration:none">Sign in</a></p><p style="color:#8A5A3B">This link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>`;
        await sendEmail(identifier, "Your Stabl sign in link", text, html);
      },
    }),
    // Demo builds without email: sign in with just an email address, or as one of
    // the demo people. Refused unless env.instantSignIn is on.
    Credentials({
      id: "instant",
      credentials: { email: {}, persona: {} },
      async authorize(input) {
        if (!env.instantSignIn) return null;
        const persona = String(input?.persona ?? "");
        if (persona) {
          const seeded = PERSONAS[persona as keyof typeof PERSONAS];
          if (!seeded) return null;
          const [user] = await db.select().from(users).where(and(eq(users.email, seeded.email), eq(users.isDemo, true)));
          return user ? { id: user.id, email: user.email, name: user.name } : null;
        }
        const email = z.email().safeParse(String(input?.email ?? "").trim().toLowerCase());
        if (!email.success) return null;
        const [existing] = await db.select().from(users).where(eq(users.email, email.data));
        const [user] = existing ? [existing] : await db.insert(users).values({ email: email.data, emailVerified: null }).returning();
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    // One time links for demo users only: the presenting phone and judge mode.
    Credentials({
      id: "demo",
      credentials: { userId: {}, token: {} },
      async authorize(input) {
        const userId = String(input?.userId ?? "");
        const token = String(input?.token ?? "");
        if (!/^[0-9a-f-]{36}$/.test(userId) || !token) return null;
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user?.isDemo) return null;
        const check = await checkCode(userId, "demo_login", token);
        return check.ok ? { id: user.id, email: user.email, name: user.name } : null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
