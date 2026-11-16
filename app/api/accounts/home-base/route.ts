import { z } from "zod";
import { route } from "@/lib/api";
import { setHomeBase } from "@/lib/security";
import { apiUser, HttpError } from "@/lib/session";

const Body = z.object({ accountId: z.uuid() });

const REASONS = {
  not_found: "That account is not one of yours.",
  not_checking: "Home base has to be a checking account.",
  name_mismatch: "The name on this account does not match your profile name, so it cannot be your home base.",
};

// Set home base, or ask to change it (72 hour wait, alert on every channel).
export const POST = route(async (request) => {
  const user = await apiUser();
  const { accountId } = Body.parse(await request.json());
  const result = await setHomeBase(user.id, accountId);
  if (!result.ok) throw new HttpError(409, REASONS[result.reason]);
  return result;
});
