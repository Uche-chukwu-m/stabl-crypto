import { chain } from "@/lib/chain/config";
import { ingestLogs } from "@/lib/chain/settle";
import { logsFromDelivery, verifyStreamSignature } from "@/lib/chain/stream";

export const maxDuration = 60;

// Where the QuickNode Stream delivers the vault contract's events. This is what
// settles a move: the ledger entry and the receipt are written here, when Arc
// says the money moved, not when the app asked for it.
//
// Every delivery is checked against the stream's signing token. The work runs
// before the response, so a failure answers 500 and QuickNode sends the same
// events again; applying an event twice does nothing.
export async function POST(request: Request) {
  if (!chain.enabled) return new Response(null, { status: 404 });
  const raw = await request.text();
  if (!verifyStreamSignature(raw, request.headers, process.env.QUICKNODE_STREAM_TOKEN)) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Not JSON" }, { status: 400 });
  }
  try {
    const results = await ingestLogs(logsFromDelivery(body), "stream");
    return Response.json({ ok: true, events: results.length, settled: results.filter((r) => r === "settled").length });
  } catch (error) {
    console.error("chain stream", error);
    return Response.json({ error: "Could not apply events" }, { status: 500 });
  }
}
