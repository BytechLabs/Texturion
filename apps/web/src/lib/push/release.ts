/**
 * Hand this browser's push subscription back at sign-out (#264).
 *
 * A Web Push subscription belongs to the BROWSER, not the account: the
 * `push_subscriptions` row is keyed on (user_id, endpoint) with no session
 * binding, so it outlives the session that created it. Every web sign-out used
 * to leave that row in place, and the shop's front-desk laptop kept ringing
 * with the previous member's customer messages — contact name and message text
 * on the next person's screen. Worse, the on-load reconcile in
 * subscription-machine.ts re-saves the SAME endpoint under whoever signs in
 * next, so one browser ends up on two people's rows without anybody choosing
 * that. Both native clients already DELETE their token before clearing the
 * session; the web client was the outlier.
 *
 * Run this BEFORE `auth.signOut()` — the DELETE needs the session it is
 * ending. It never throws: nobody may be trapped in an account because the
 * network blipped on the way out.
 *
 * The browser-side `unsubscribe()` runs whatever happened to the API calls,
 * and is what makes this safe rather than merely tidy: a dead endpoint answers
 * the next send with 404/410, which the server prunes on the spot. So even a
 * failed DELETE stops the leak on the very next message.
 */
import type { PushSubscriptionRow } from "@/lib/api/types";

import { ensureServiceWorkerRegistration, pushSupported } from "./register";
import { subscriptionToKeys } from "./subscription-machine";

/**
 * How long sign-out will wait for this. Leaving is not a moment to be held on
 * a spinner over housekeeping, and the browser unsubscribe already guarantees
 * the outcome — a stalled request just means the row is pruned as dead on the
 * next send instead of deleted now.
 */
const RELEASE_TIMEOUT_MS = 3_000;

export async function releasePushOnThisDevice(
  /** Active workspace, for the X-Company-Id header. Null skips the API half. */
  companyId: string | null,
): Promise<void> {
  await Promise.race([
    release(companyId),
    new Promise<void>((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS)),
  ]);
}

async function release(companyId: string | null): Promise<void> {
  if (!pushSupported()) return;
  let subscription: PushSubscription | null = null;
  try {
    const registration = await ensureServiceWorkerRegistration();
    subscription = await registration.pushManager.getSubscription();
    if (!subscription || companyId === null) return;
    // Loaded on the click, not with the shell: the API client validates the
    // public env at import time, and every component carrying a sign-out
    // control would otherwise drag that in just to render.
    const { apiFetch } = await import("@/lib/api/client");
    // The POST is an upsert on (user_id, endpoint): it is how we learn the row
    // id without keeping any client-side record of it (the settings toggle
    // does the same).
    const { id } = await apiFetch<PushSubscriptionRow>(
      "/v1/push-subscriptions",
      {
        method: "POST",
        companyId,
        body: subscriptionToKeys(subscription),
      },
    );
    await apiFetch<void>(`/v1/push-subscriptions/${id}`, {
      method: "DELETE",
      companyId,
    });
  } catch {
    /* Signing out always wins; the unsubscribe below still closes the leak. */
  } finally {
    try {
      await subscription?.unsubscribe();
    } catch {
      /* Nothing left to do — the row is gone or will be pruned as dead. */
    }
  }
}
