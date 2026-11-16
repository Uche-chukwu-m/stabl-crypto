"use client";

// Small fetch helper for client components. Throws the server's plain error
// message so screens can show it as is.
export async function post<T = unknown>(url: string, body: unknown = {}, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Nothing moved.");
  return json;
}
