import { safeEqual } from "@/lib/crypto";
import { runDailyJob } from "@/lib/daily";

export const maxDuration = 300;

// Vercel Cron, 0 13 * * * UTC (about 8 am Central). Vercel sends CRON_SECRET as
// a bearer token; nothing else may start the job.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return new Response(null, { status: 401 });
  return Response.json(await runDailyJob());
}
