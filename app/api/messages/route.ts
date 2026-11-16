import { z } from "zod";
import { route } from "@/lib/api";
import { handleCommand } from "@/lib/commands";
import { rateLimit } from "@/lib/rate-limit";
import { apiUser, HttpError } from "@/lib/session";
import { threadFor } from "@/lib/views";

// The in app thread.
export const GET = route(async () => {
  const user = await apiUser();
  return { messages: await threadFor(user.id) };
});

const Body = z.object({ text: z.string().trim().min(1).max(40) });

// A command typed into the thread, handled exactly like a Telegram reply.
export const POST = route(async (request) => {
  const user = await apiUser();
  if (!(await rateLimit(`cmd:${user.id}`, 30, 60))) throw new HttpError(429, "Too many tries. Wait a minute.");
  const { text } = Body.parse(await request.json());
  await handleCommand(user.id, text, "app");
  return { messages: await threadFor(user.id) };
});
