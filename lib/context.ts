import { and, eq } from "drizzle-orm";
import type { ISODate } from "@/engine/dates";
import { clockFor } from "@/lib/clock";
import { db } from "@/lib/db";
import { accounts, plaidItems, users, vaultAccounts } from "@/lib/db/schema";

export type HomeBase = typeof accounts.$inferSelect & { item: typeof plaidItems.$inferSelect };

export type UserContext = {
  user: typeof users.$inferSelect;
  now: Date;
  today: ISODate;
  homeBase: HomeBase | null;
  vault: typeof vaultAccounts.$inferSelect | null;
};

export async function loadContext(userId: string): Promise<UserContext> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("No such user");
  const { now, today } = clockFor(user);
  const [home] = await db
    .select({ account: accounts, item: plaidItems })
    .from(accounts)
    .innerJoin(plaidItems, eq(accounts.itemId, plaidItems.id))
    .where(and(eq(accounts.userId, userId), eq(accounts.isHomeBase, true)));
  const [vault] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, userId));
  return {
    user,
    now,
    today,
    homeBase: home ? { ...home.account, item: home.item } : null,
    vault: vault ?? null,
  };
}

// "Checking 4321", the way every receipt names an account.
export function accountLabel(a: { name: string; mask: string | null }): string {
  const name = /checking/i.test(a.name) ? "Checking" : a.name;
  return a.mask ? `${name} ${a.mask}` : name;
}
