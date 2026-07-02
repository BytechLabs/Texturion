/**
 * Service-worker registration for the G9 PWA surface (push notifications +
 * offline app-shell fallback). Registration is safe to run on every page
 * load — the browser no-ops when /sw.js is unchanged. Requesting NOTIFICATION
 * PERMISSION is a separate, user-initiated act (G8) that lives in
 * use-push-subscription.ts; registering the worker never prompts anyone.
 */

const SW_URL = "/sw.js";

/** Whether this browser can register a service worker at all. */
export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Whether the full Web Push stack (SW + Push + Notification) exists here. */
export function pushSupported(): boolean {
  return (
    serviceWorkerSupported() &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Register /sw.js (idempotent) and resolve the active registration. Used by
 * the subscription flow, which needs `registration.pushManager`.
 */
export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!serviceWorkerSupported()) {
    throw new Error("Service workers are not supported in this browser.");
  }
  await navigator.serviceWorker.register(SW_URL);
  return navigator.serviceWorker.ready;
}

/**
 * Fire-and-forget boot registration (mounted once in the root layout via
 * components/notifications/service-worker-registrar.tsx). A failure only
 * costs the offline fallback — never block or crash the app for it.
 */
export function registerServiceWorker(): void {
  if (!serviceWorkerSupported()) return;
  void navigator.serviceWorker.register(SW_URL).catch((cause) => {
    console.warn("JobText service worker registration failed:", cause);
  });
}
