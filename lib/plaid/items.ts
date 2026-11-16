import { and, eq } from "drizzle-orm";
import { CountryCode } from "plaid";
import { today as clockToday } from "@/lib/clock";
import { encryptToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { accounts, plaidItems } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { accessToken, plaid, plaidErrorCode } from "./client";
import { syncItem } from "./sync";

// Called after Link succeeds (or a sandbox public token is created). Exchanges
// the public token, encrypts the access token, saves accounts with owner names,
// and pulls the first batch of transactions. The token never leaves the server.
export async function connectItem(userId: string, publicToken: string, opts: { label?: string } = {}) {
  const { data } = await plaid().itemPublicTokenExchange({ public_token: publicToken });
  const token = data.access_token;

  const { data: itemData } = await plaid().itemGet({ access_token: token });
  const institutionId = itemData.item.institution_id ?? null;
  let institutionName = opts.label ?? "Bank";
  if (!opts.label && institutionId) {
    try {
      const { data: inst } = await plaid().institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us, CountryCode.Ca] });
      institutionName = inst.institution.name;
    } catch {
      // A missing name is cosmetic.
    }
  }

  const [item] = await db
    .insert(plaidItems)
    .values({
      userId,
      itemId: data.item_id,
      accessTokenEnc: encryptToken(token),
      institutionId,
      institutionName,
      env: env.plaidMode === "production" ? "production" : "sandbox",
    })
    .returning();

  await refreshAccounts(item.id);
  await syncItem(item.id);
  return item;
}

export async function refreshAccounts(itemRowId: string) {
  const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, itemRowId));
  const token = accessToken(item);
  const { data } = await plaid().accountsGet({ access_token: token });

  // Owner names for the home base name match. Identity is optional for
  // connections that are only read for income.
  const owners = new Map<string, string[]>();
  try {
    const { data: identity } = await plaid().identityGet({ access_token: token });
    for (const a of identity.accounts) owners.set(a.account_id, a.owners.flatMap((o) => o.names));
  } catch (error) {
    console.warn("identity unavailable", plaidErrorCode(error));
  }

  const asOf = await clockToday(item.userId);
  for (const a of data.accounts) {
    const balance = a.balances.current ?? a.balances.available;
    const values = {
      name: a.name,
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      type: a.type,
      subtype: a.subtype ?? null,
      ownerNames: owners.get(a.account_id) ?? [],
      // Plaid balances are positive dollars; for a card it is what is owed.
      balanceCents: balance == null ? null : Math.round(balance * 100),
      balanceAsOf: asOf,
    };
    await db
      .insert(accounts)
      .values({ itemId: item.id, userId: item.userId, plaidAccountId: a.account_id, ...values })
      .onConflictDoUpdate({ target: [accounts.itemId, accounts.plaidAccountId], set: values });
  }
}

// Production only: a live balance right before a buffer, so the safety rule
// reads real money. Sandbox balances never change, so they keep their anchor.
export async function refreshLiveBalance(accountId: string): Promise<void> {
  const [row] = await db
    .select({ account: accounts, item: plaidItems })
    .from(accounts)
    .innerJoin(plaidItems, eq(accounts.itemId, plaidItems.id))
    .where(eq(accounts.id, accountId));
  if (!row || row.item.env !== "production") return;
  const { data } = await plaid().accountsBalanceGet({
    access_token: accessToken(row.item),
    options: { account_ids: [row.account.plaidAccountId] },
  });
  const live = data.accounts[0]?.balances;
  const value = live?.available ?? live?.current;
  if (value == null) return;
  await db
    .update(accounts)
    .set({ balanceCents: Math.round(value * 100), balanceAsOf: await clockToday(row.item.userId) })
    .where(eq(accounts.id, accountId));
}

export async function removeItem(userId: string, itemRowId: string) {
  const [item] = await db.select().from(plaidItems).where(and(eq(plaidItems.id, itemRowId), eq(plaidItems.userId, userId)));
  if (!item) return;
  if (item.env !== "local" && item.accessTokenEnc) {
    try {
      await plaid().itemRemove({ access_token: accessToken(item) });
    } catch (error) {
      console.warn("item remove failed", plaidErrorCode(error));
    }
  }
}
