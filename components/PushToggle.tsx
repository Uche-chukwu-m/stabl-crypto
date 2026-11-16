"use client";

import { useEffect, useState } from "react";
import { post } from "./api";

function key(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "install" | "off" | "on" | "denied";

// Phone alerts. Permission is asked only from this button tap, which iPhones
// require; and on iPhone, push works only from the Home Screen app (iOS 16.4+).
export function PushToggle({ subscribed }: { subscribed: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read the browser's push support once mounted; it is unknown on the server.
    void (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      try {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        setState(sub && subscribed ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, [subscribed]);

  async function turnOn() {
    setError(null);
    try {
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid) throw new Error("Phone alerts are not set up on this server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(vapid) }));
      await post("/api/push/subscribe", { subscription: sub.toJSON() });
      setState("on");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function turnOff() {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    await post("/api/push/subscribe", {}, "DELETE");
    setState("off");
  }

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      {state === "on" && (
        <button type="button" className="btn btn-quiet px-3" onClick={turnOff}>
          On
        </button>
      )}
      {state === "off" && (
        <button type="button" className="btn btn-primary px-3" onClick={turnOn}>
          Turn on
        </button>
      )}
      {state === "install" && (
        <p className="text-caption">
          Add to Home Screen first
        </p>
      )}
      {state === "denied" && <p className="text-caption">Blocked in phone settings</p>}
      {state === "unsupported" && <p className="text-caption">Not available here</p>}
      {error && (
        <p role="alert" className="text-caption text-fast">
          {error}
        </p>
      )}
    </div>
  );
}
