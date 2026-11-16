import { eq } from "drizzle-orm";
import { after } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { plaidItems, vaultAccounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runEngine } from "@/lib/engine-runner";
import { notify } from "@/lib/notify";
import { refreshRecurringBills } from "@/lib/plaid/recurring";
import { syncItem } from "@/lib/plaid/sync";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";

export const maxDuration = 60;

type PlaidWebhook = { webhook_type: string; webhook_code: string; item_id: string; error?: { error_code?: string } | null };

// Every call is verified against Plaid's signing key; anything unsigned is
// rejected. The work runs after the response so Plaid never waits on us.
export async function POST(request: Request) {
  if (env.plaidMode === "local") return new Response(null, { status: 404 });
  const raw = await request.text();
  if (!(await verifyPlaidWebhook(raw, request.headers.get("plaid-verification")))) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as PlaidWebhook;
  const [item] = await db.select().from(plaidItems).where(eq(plaidItems.itemId, body.item_id));
  if (!item) return Response.json({ ok: true });

  after(async () => {
    try {
      await handle(item, body);
    } catch (error) {
      console.error("plaid webhook", body.webhook_code, error);
    }
  });
  return Response.json({ ok: true });
}

async function handle(item: typeof plaidItems.$inferSelect, body: PlaidWebhook) {
  const code = body.webhook_code;
  const errorCode = body.error?.error_code;
  await audit(item.userId, "engine", "plaid_webhook", { type: body.webhook_type, code, errorCode });

  if (code === "SYNC_UPDATES_AVAILABLE" || code === "DEFAULT_UPDATE" || code === "INITIAL_UPDATE" || code === "HISTORICAL_UPDATE") {
    await syncItem(item.id);
    const [v] = await db.select().from(vaultAccounts).where(eq(vaultAccounts.userId, item.userId));
    // New transactions: sync, then the fast check (which also runs whenever
    // checking dropped under this week's bills plus the floor).
    await runEngine(item.userId, v ? { forceFast: true } : { learnOnly: true });
    return;
  }

  if (code === "RECURRING_TRANSACTIONS_UPDATE") {
    await refreshRecurringBills(item.userId);
    return;
  }

  if (code === "PENDING_DISCONNECT" || code === "PENDING_EXPIRATION" || (code === "ERROR" && errorCode === "ITEM_LOGIN_REQUIRED")) {
    const status = code === "ERROR" ? "login_required" : "pending_disconnect";
    await db.update(plaidItems).set({ status }).where(eq(plaidItems.id, item.id));
    await notify(item.userId, "connection_broken", { institution: item.institutionName });
    return;
  }

  if (code === "USER_PERMISSION_REVOKED" || code === "USER_ACCOUNT_REVOKED") {
    await db.update(plaidItems).set({ status: "revoked" }).where(eq(plaidItems.id, item.id));
    await notify(item.userId, "permission_revoked", { institution: item.institutionName });
    return;
  }

  if (code === "LOGIN_REPAIRED") {
    await db.update(plaidItems).set({ status: "active" }).where(eq(plaidItems.id, item.id));
  }
}
