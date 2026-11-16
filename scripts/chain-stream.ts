// npm run chain:stream -- <create | status | pause | resume | delete>
// Manages the QuickNode Stream that watches the vault contract on Arc Testnet
// and posts its events to this app's webhook.
//
// Streams use API credits for every block they process, whether or not the
// filter matches, and Arc makes a block about every 0.7 seconds (roughly
// 124,000 a day). A paused stream
// catches up on every block it missed when it resumes, so pausing saves
// nothing. To stop spending while nobody is using the app, delete the stream
// and create it again before a demo: a new stream starts at the newest block.
// Nothing is lost in between, because the app's fallback reads Arc directly.
import "./env";
import { chain } from "@/lib/chain/config";
import { streamFilter } from "@/lib/chain/stream";
import { env } from "@/lib/env";

const API = "https://api.quicknode.com/streams/rest/v1";
const EXTERNAL_ID = "stabl-vault-arc-testnet";

const apiKey = process.env.QUICKNODE_API_KEY;
if (!apiKey) throw new Error("Set QUICKNODE_API_KEY in .env.local first.");

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "x-api-key": apiKey!, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new Error(`QuickNode ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
  return json as Record<string, unknown> | null;
}

type Stream = { id: string; name: string; status: string; network: string; dataset: string; destination_attributes?: { url?: string } } & Record<string, unknown>;

async function find(): Promise<Stream | null> {
  const res = (await call("GET", `/streams?external_id=${EXTERNAL_ID}`)) as { data?: Stream[] } | null;
  return res?.data?.find((s) => (s as { external_id?: string }).external_id === EXTERNAL_ID) ?? res?.data?.[0] ?? null;
}

function show(s: Stream) {
  console.log(`Stream ${s.id}`);
  console.log(`  name     ${s.name}`);
  console.log(`  status   ${s.status}`);
  console.log(`  network  ${s.network} (${s.dataset})`);
  console.log(`  webhook  ${s.destination_attributes?.url ?? "?"}`);
  for (const key of ["current_hash", "sequence", "last_delivered_block", "start_range", "end_range"]) {
    if (s[key] != null) console.log(`  ${key}  ${String(s[key])}`);
  }
}

const command = process.argv[2] ?? "status";

if (command === "create") {
  const vault = chain.vaultAddress;
  if (!vault) throw new Error("Set ARC_VAULT_ADDRESS first.");
  const token = process.env.QUICKNODE_STREAM_TOKEN;
  if (!token || token.length < 32) throw new Error("Set QUICKNODE_STREAM_TOKEN (32 characters or more) in .env.local and in Vercel first.");
  const base = process.env.STREAM_WEBHOOK_BASE || env.appUrl;
  if (!base.startsWith("https://")) throw new Error("The webhook needs a public https address. Set STREAM_WEBHOOK_BASE to the live site.");

  const existing = await find();
  if (existing) {
    console.log("The stream already exists.");
    show(existing);
  } else {
    const created = (await call("POST", "/streams", {
      name: "Stabl vault events (Arc Testnet)",
      external_id: EXTERNAL_ID,
      network: "arc-testnet",
      // Logs only: the cheapest dataset that carries the contract's events.
      dataset: "logs",
      filter_function: Buffer.from(streamFilter(vault)).toString("base64"),
      region: "usa_east",
      // One block per delivery is the most this plan allows. Set
      // STREAM_BATCH_SIZE higher on a plan that permits it; elastic batching
      // still delivers at the tip without waiting for a batch to fill.
      dataset_batch_size: Number(process.env.STREAM_BATCH_SIZE ?? 1),
      elastic_batch_enabled: true,
      fix_block_reorgs: 0,
      keep_distance_from_tip: 0,
      destination: "webhook",
      destination_attributes: {
        url: `${base}/api/chain/stream`,
        compression: "none",
        max_retry: 5,
        retry_interval_sec: 2,
        post_timeout_sec: 30,
        security_token: token,
      },
      status: "active",
    })) as Stream;
    console.log("Created.");
    show(created);
  }
} else {
  const stream = await find();
  if (!stream) {
    console.log("No stream yet. Run: npm run chain:stream -- create");
  } else if (command === "status") {
    show(stream);
  } else if (command === "pause") {
    await call("POST", `/streams/${stream.id}/pause`);
    console.log("Paused. When resumed it processes every block it missed. To skip them, delete and create instead.");
  } else if (command === "resume") {
    await call("POST", `/streams/${stream.id}/activate`);
    console.log("Resumed. It catches up from where it stopped.");
  } else if (command === "delete") {
    await call("DELETE", `/streams/${stream.id}`);
    console.log("Deleted.");
  } else {
    console.log("Use one of: create, status, pause, resume, delete");
  }
}
