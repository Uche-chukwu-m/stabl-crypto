import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

export const ADMIN_COOKIE = "stabl_admin";

// The cookie holds a keyed hash of ADMIN_KEY, never the key itself.
export function adminCookieValue(): string {
  return createHmac("sha256", process.env.ADMIN_KEY ?? "").update("stabl-admin-v1").digest("hex");
}

export async function isAdmin(request?: Request): Promise<boolean> {
  if (!env.adminEnabled) return false;
  const header = request?.headers.get("x-admin-key");
  if (header && safeEqual(header, process.env.ADMIN_KEY ?? "")) return true;
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  return Boolean(cookie && safeEqual(cookie, adminCookieValue()));
}
