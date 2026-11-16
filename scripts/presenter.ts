// npx tsx scripts/presenter.ts <seed | big-client | advance [days] | slow-week | link | status>
// Drives the presenter account on the live site from a terminal, through the
// same key-protected routes the presenter page uses. Reads the live site's key
// from .secrets/production.env (PRESENTER_BASE overrides the address).
import { readFileSync } from "node:fs";

const BASE = process.env.PRESENTER_BASE || "https://stabl-crypto.vercel.app";
const secrets = Object.fromEntries(
  readFileSync(".secrets/production.env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const key = secrets.ADMIN_KEY;
if (!key) throw new Error("ADMIN_KEY is missing from .secrets/production.env");

async function call(action: string, body: Record<string, unknown> = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/admin/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": key },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${action} answered ${res.status}: ${JSON.stringify(json)}`);
  console.log(`${action}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return json;
}

// The presenter account's id is kept beside the secrets, so later commands find it.
const ID_FILE = ".secrets/presenter-user-id";
const savedId = () => {
  try {
    return readFileSync(ID_FILE, "utf8").trim();
  } catch {
    throw new Error("No presenter account yet. Run: npx tsx scripts/presenter.ts seed");
  }
};

const [command = "status", arg] = process.argv.slice(2);
if (command === "seed") {
  const { userId } = await call("seed");
  (await import("node:fs")).writeFileSync(ID_FILE, String(userId));
  console.log(`presenter account ${userId}`);
} else if (command === "big-client") {
  console.log(JSON.stringify(await call("inject", { userId: savedId(), event: "big_client" })));
} else if (command === "slow-week") {
  console.log(JSON.stringify(await call("inject", { userId: savedId(), event: "slow_week" })));
} else if (command === "advance") {
  await call("advance", { userId: savedId(), days: Number(arg ?? 1) });
} else if (command === "reset") {
  const { userId } = await call("reset", { userId: savedId() });
  (await import("node:fs")).writeFileSync(ID_FILE, String(userId));
  console.log(`presenter account ${userId}`);
} else if (command === "link") {
  const { url } = await call("link", { userId: savedId() });
  console.log(`One time sign in link, valid for a day:\n${url}`);
} else {
  console.log(`presenter account ${savedId()} on ${BASE}`);
}
