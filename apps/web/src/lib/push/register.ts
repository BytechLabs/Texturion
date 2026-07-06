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
 *
 * PRODUCTION ONLY. In development the offline-fallback worker does more harm
 * than good: `next dev` recompiles routes on first hit and drops the HMR
 * socket when a tab returns from an external redirect (e.g. Stripe Checkout),
 * so the SW's network-first navigation handler catches the transient failure
 * and serves offline.html — the spurious "You're offline" screen QA hit after
 * paying. It also caches an app shell that goes stale between edits. So in dev
 * we actively UNREGISTER any worker a prior prod-like build left behind and
 * drop its caches, healing machines that already registered it.
 */
export function registerServiceWorker(): void {
  if (!serviceWorkerSupported()) return;
  if (process.env.NODE_ENV !== "production") {
    void unregisterServiceWorkers();
    return;
  }
  void navigator.serviceWorker.register(SW_URL).catch((cause) => {
    console.warn("Loonext service worker registration failed:", cause);
  });
}

/**
 * Tear down every registered worker + its caches on this origin. Used in dev
 * (see {@link registerServiceWorker}) so a developer who once ran a production
 * build isn't stranded behind a stale/offline-serving worker. Best-effort.
 */
async function unregisterServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // A browser that blocks SW/cache access in dev is fine — nothing to heal.
  }
}
