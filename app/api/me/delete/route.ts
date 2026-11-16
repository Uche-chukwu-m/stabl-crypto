import { z } from "zod";
import { route } from "@/lib/api";
import { deleteUserData } from "@/lib/demo/seed";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({ confirm: z.literal("DELETE") });

// Removes every Plaid Item (/item/remove) and every row, ledger included.
export const POST = route(async (request) => {
  const user = await apiUser();
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) throw new HttpError(400, "Type DELETE to confirm.");
  await deleteUserData(user.id);
  return { ok: true };
});
