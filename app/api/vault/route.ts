import { route } from "@/lib/api";
import { apiUser, HttpError } from "@/lib/session";
import { vaultView } from "@/lib/views";

export const GET = route(async () => {
  const user = await apiUser();
  const view = await vaultView(user.id);
  if (!view) throw new HttpError(404, "No vault yet.");
  return view;
});
