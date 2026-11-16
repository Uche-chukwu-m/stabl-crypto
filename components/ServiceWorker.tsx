"use client";

import { useEffect } from "react";

// Registers the service worker for the whole site. Push permission is never asked
// here; iPhones only allow it from a button tap (see PushToggle).
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/serwist/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
