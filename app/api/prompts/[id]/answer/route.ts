import { z } from "zod";
import { route } from "@/lib/api";
import { handleCommand } from "@/lib/commands";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({ answer: z.enum(["YES", "NO", "PAUSE", "KEEP"]) });

// Reply buttons in the thread go through the same handler as Telegram replies.
export const POST = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  if (!(await rateLimit(`cmd:${user.id}`, 30, 60))) throw new HttpError(429, "Too many tries. Wait a minute.");
  const id = z.uuid().parse((await params).id);
  const { answer } = Body.parse(await request.json());
  await handleCommand(user.id, answer, "app", { promptId: id });
  return { ok: true };
});
