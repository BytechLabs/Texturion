"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** What sw.js posts when a notification is tapped while this tab is open. */
export const NAVIGATE_MESSAGE = "loonext:navigate";

/** The path when it stays on this origin, otherwise null. */
export function inAppPath(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

/**
 * Takes a notification tap as an in-app route instead of the worker reloading
 * the tab, so the open page and a call ringing in it stay up. Mounted in the
 * signed-in layout only: elsewhere nothing answers and sw.js navigates.
 */
export function NotificationRouter() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const worker = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; path?: unknown } | null;
      if (!data || data.type !== NAVIGATE_MESSAGE) return;
      const path = inAppPath(data.path, window.location.origin);
      if (path) router.push(path);
      event.ports[0]?.postMessage({ ok: path !== null });
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
