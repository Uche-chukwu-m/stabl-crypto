import { z } from "zod";
import { route } from "@/lib/api";
import { stopBuffer } from "@/lib/moves";
import { recordUserMessage } from "@/lib/notify";
import { apiUser, HttpError } from "@/lib/session";

// Cancel an announced buffer before it settles.
export const POST = route(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  const id = z.uuid().parse((await params).id);
  await recordUserMessage(user.id, "STOP");
  if (!(await stopBuffer(user.id, id))) throw new HttpError(409, "That move already settled or was stopped.");
  return { ok: true };
});
