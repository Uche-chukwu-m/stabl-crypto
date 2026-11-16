import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { apiUser } from "@/lib/session";

// Everything Stabl holds about the user, as JSON. Access tokens and code hashes
// are left out; they are secrets, not the user's data.
export const POST = route(async () => {
  const user = await apiUser();
  const id = user.id;
  const [vault] = await db.select().from(s.vaultAccounts).where(eq(s.vaultAccounts.userId, id));
  const data = {
    exportedAt: new Date().toISOString(),
    profile: user,
    connections: (await db.select().from(s.plaidItems).where(eq(s.plaidItems.userId, id))).map(({ accessTokenEnc, syncCursor, ...rest }) => {
      void accessTokenEnc;
      void syncCursor;
      return rest;
    }),
    accounts: await db.select().from(s.accounts).where(eq(s.accounts.userId, id)),
    transactions: await db.select().from(s.transactions).where(eq(s.transactions.userId, id)),
    sourceTags: await db.select().from(s.sourceTags).where(eq(s.sourceTags.userId, id)),
    bills: await db.select().from(s.bills).where(eq(s.bills.userId, id)),
    engineProfile: await db.select().from(s.engineProfiles).where(eq(s.engineProfiles.userId, id)),
    vault: vault ?? null,
    moves: await db.select().from(s.moves).where(eq(s.moves.userId, id)),
    ledger: vault ? await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.vaultId, vault.id)) : [],
    prompts: await db.select().from(s.prompts).where(eq(s.prompts.userId, id)),
    messages: await db.select().from(s.messages).where(eq(s.messages.userId, id)),
    auditLog: await db.select().from(s.auditLog).where(eq(s.auditLog.userId, id)),
  };
  await audit(id, "user", "data_exported");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="stabl-export-${data.exportedAt.slice(0, 10)}.json"`,
    },
  });
});
