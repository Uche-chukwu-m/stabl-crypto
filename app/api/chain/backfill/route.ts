import { chain } from "@/lib/chain/config";
import { ingestLogs } from "@/lib/chain/settle";
import { logsFromDelivery, verifyStreamSignature } from "@/lib/chain/stream";

export const maxDuration = 60;

// Where the backfill Stream delivers: the vault contract's whole history,
// replayed by QuickNode from the block it was deployed in. Each event goes
// through the same exactly-once path as the live Stream, so the replay records
// anything Stabl missed (say, while it was down) and settles any move still on
// its way, and changes nothing that is already recorded.
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
    const results = await ingestLogs(logsFromDelivery(body), "backfill");
    return Response.json({
      ok: true,
      events: results.length,
      new: results.filter((r) => r !== "duplicate").length,
      duplicate: results.filter((r) => r === "duplicate").length,
    });
  } catch (error) {
    console.error("chain backfill", error);
    return Response.json({ error: "Could not apply events" }, { status: 500 });
  }
}
