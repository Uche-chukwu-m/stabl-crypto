"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { loadContext } from "@/lib/context";
import { db } from "@/lib/db";
import { accounts, engineProfiles, users } from "@/lib/db/schema";
import { RULES_VERSION } from "@/lib/demo/seed";
import { runEngine } from "@/lib/engine-runner";
import { setHomeBase } from "@/lib/security";
import { requireUser } from "@/lib/session";

// Move the user forward to `next`, never back (they may be revisiting a step).
async function advance(userId: string, next: number) {
  const [u] = await db.select({ step: users.onboardingStep }).from(users).where(eq(users.id, userId));
  if (u.step < next) await db.update(users).set({ onboardingStep: next }).where(eq(users.id, userId));
}

const About = z.object({
  earnType: z.enum(["freelance", "commission", "own_business", "mix"]),
  payFrequency: z.enum(["weekly", "every_two_weeks", "twice_a_month", "monthly", "irregular"]),
});

export async function saveAbout(_: unknown, form: FormData) {
  const user = await requireUser();
  const parsed = About.safeParse({ earnType: form.get("earnType"), payFrequency: form.get("payFrequency") });
  if (!parsed.success) return { error: "Pick one answer for each question." };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  await advance(user.id, 3);
  redirect("/onboarding/rules");
}

export async function signRules(_: unknown, form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  if (form.get("agree") !== "on") return { error: "Check the box to agree to the rules." };
  if (name.length < 2) return { error: "Type your name to sign." };
  await db
    .update(users)
    .set({ rulesSignedAt: new Date(), rulesSignedName: name, rulesVersion: RULES_VERSION })
    .where(eq(users.id, user.id));
  await audit(user.id, "user", "rules_signed", { name, version: RULES_VERSION });
  await advance(user.id, 4);
  redirect("/onboarding/identity");
}

// Simulated identity check. The SSN digits are checked for shape and dropped;
// only kyc_status = verified_mock is stored. Date of birth is not stored either.
export async function verifyIdentity(_: unknown, form: FormData) {
  const user = await requireUser();
  const legalName = String(form.get("legalName") ?? "").trim().replace(/\s+/g, " ");
  const dob = String(form.get("dob") ?? "");
  const ssn4 = String(form.get("ssn4") ?? "");
  if (legalName.split(" ").length < 2) return { error: "Enter your first and last name as they appear on your bank account." };
  const born = new Date(`${dob}T12:00:00Z`);
  const adult = !Number.isNaN(born.getTime()) && new Date().getTime() - born.getTime() >= 18 * 365.25 * 86_400_000;
  if (!adult) return { error: "You need to be 18 or older to use Stabl." };
  if (!/^\d{4}$/.test(ssn4)) return { error: "Enter the last 4 digits of your Social Security number." };
  await db.update(users).set({ legalName, name: legalName, kycStatus: "verified_mock" }).where(eq(users.id, user.id));
  await audit(user.id, "user", "identity_verified_mock");
  await advance(user.id, 5);
  redirect("/onboarding/connect");
}

export async function finishConnect() {
  const user = await requireUser();
  const rows = await db.select().from(accounts).where(eq(accounts.userId, user.id));
  if (!rows.some((a) => a.type === "depository" && a.subtype === "checking")) redirect("/onboarding/connect?error=checking");
  await advance(user.id, 6);
  redirect("/onboarding/home-base");
}

const MESSAGES = {
  not_found: "That account is not one of yours.",
  not_checking: "Home base has to be a checking account.",
  name_mismatch: "The name on this account does not match the name you gave us, so it cannot be your home base.",
};

export async function chooseHomeBase(_: unknown, form: FormData) {
  const user = await requireUser();
  const result = await setHomeBase(user.id, String(form.get("accountId") ?? ""));
  if (!result.ok) return { error: MESSAGES[result.reason] };
  await advance(user.id, 7);
  redirect("/onboarding/learned");
}

export async function confirmLearned() {
  const user = await requireUser();
  await advance(user.id, 8);
  redirect("/onboarding/ready");
}

export async function finishOnboarding() {
  const user = await requireUser();
  const ctx = await loadContext(user.id);
  if (!ctx.vault) redirect("/onboarding/ready");
  await runEngine(user.id, { learnOnly: true });
  // The first fast check runs next week and the first feast check in three; a
  // low balance still triggers a fast check right away.
  await db
    .update(engineProfiles)
    .set({ lastFastCheck: ctx.today, lastFeastCheck: ctx.today })
    .where(eq(engineProfiles.userId, user.id));
  await advance(user.id, 9);
  redirect("/home");
}
