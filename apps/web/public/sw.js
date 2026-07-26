/*
 * Loonext service worker.
 *
 * Four jobs, nothing speculative:
 *   1. push              -> show "contact name + snippet" notifications from
 *                           the server payload ({ title, body, url }).
 *   2. push kind:call_end-> the ring-retirement push (#170 CALLS-V3 §9.2):
 *                           close the ringing-call notification for the
 *                           session and show the call's outcome on the same
 *                           tag (#265 — a Web Push that displays nothing
 *                           costs the subscription its userVisibleOnly
 *                           budget, and eventually the subscription itself).
 *   3. notificationclick -> focus an open Loonext tab on the deep-linked
 *                           thread, or open one.
 *   4. offline           -> precached app-shell fallback (offline.html) for
 *                           navigations that can't reach the network. No other
 *                           caching: the app is realtime, staleness is worse
 *                           than a spinner.
 */
"use strict";

/** Bump when the precache list or offline.html changes. */
const SHELL_CACHE = "loonext-shell-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/favicon.svg"];

/**
 * Map a notification deep link onto an app path on THIS origin.
 *
 * The push payload links to `/conversations/{id}`; the thread route in the app
 * is `/inbox/{id}`, so normalize here so a tap always lands on the real screen.
 * Foreign or unparseable URLs fall back to the inbox rather than opening an
 * arbitrary destination from a push payload.
 */
function normalizeNotificationUrl(rawUrl, origin) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return "/inbox";
  let url;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return "/inbox";
  }
  if (url.origin !== origin) return "/inbox";
  const thread = url.pathname.match(/^\/conversations\/([^/]+)\/?$/);
  const path = thread ? `/inbox/${thread[1]}` : url.pathname;
  if (!path.startsWith("/")) return "/inbox";
  // Preserve the query for non-thread links — the incoming-call push carries
  // `/calls?call=<session>`, which the app needs to re-ring the right call.
  return thread ? path : path + url.search;
}

/**
 * Pure formatter: raw push payload text -> showNotification arguments.
 * Payload shape: { title, body, url, kind? }. `kind: "call"` (#135 push-to-wake)
 * renders an URGENT, persistent alert — a ringing call is not a message: it must
 * stay on screen until acted on, vibrate, and never collapse onto a thread
 * notification. Anything malformed still produces a calm, honest notification;
 * a subscribed push should never be silently dropped.
 */
function formatPushNotification(rawText, origin) {
  let payload = null;
  if (typeof rawText === "string" && rawText.length > 0) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }
  const isCall = Boolean(payload) && payload.kind === "call";
  const title =
    payload && typeof payload.title === "string" && payload.title.trim() !== ""
      ? payload.title
      : "Loonext";
  const body =
    payload && typeof payload.body === "string" && payload.body.trim() !== ""
      ? payload.body
      : isCall
        ? "Someone is calling your business number."
        : "You have a new message.";
  const url = normalizeNotificationUrl(payload ? payload.url : null, origin);
  return {
    title,
    options: {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // A call is one live alert PER SESSION, kept on screen until acted on and
      // buzzing; a message is one-per-thread and quiet. Scoping a call's tag to
      // its session (#149) keeps two concurrent inbound calls on two different
      // numbers as DISTINCT notifications — a shared 'loonext:call' tag would let
      // the second silently overwrite the first, hiding a still-live call — while
      // repeat pushes for the SAME call still coalesce.
      tag: isCall ? callTag(url, origin) : coalescingTag(payload, url),
      renotify: true,
      requireInteraction: isCall,
      vibrate: isCall ? [200, 100, 200, 100, 200] : undefined,
      data: { url },
    },
  };
}

/**
 * Coalescing tag for a non-call notification (#266).
 *
 * The server decides what "the same subject" means and sends it as `tag`: a
 * mention keys on the NOTE, so two asks in one thread stay two alerts, while
 * repeat texts key on the conversation and collapse. Deriving it from the url
 * here — which is what this did — silently rewrote every one of those keys to
 * "per thread", so a customer's text could replace a teammate's direct ask.
 * The url stays the fallback for a payload sent by an older server.
 */
function coalescingTag(payload, url) {
  const tag =
    payload && typeof payload.tag === "string" ? payload.tag.trim() : "";
  return `loonext:${tag !== "" ? tag : url}`;
}

/**
 * Per-session tag for a ringing-call notification. The session rides on the
 * push url as `?call=<session>`; scope the tag to it so concurrent calls don't
 * collapse. Falls back to the constant `loonext:call` when absent/unparseable
 * so a malformed payload behaves exactly as before.
 */
function callTag(url, origin) {
  try {
    const session = new URL(url, origin).searchParams.get("call");
    return session ? `loonext:call:${session}` : "loonext:call";
  } catch {
    return "loonext:call";
  }
}

/**
 * kind:'call_end' (#170 CALLS-V3 §9.2/§10.3): the server revokes a ring on
 * every exit from `ringing` (answered elsewhere / voicemail / missed). The
 * payload carries the same `/calls?call=<session>` url as the ring push, so
 * deriving the tag through the SAME normalize+callTag pipeline guarantees the
 * revocation always names the exact notification the ring created.
 *
 * Returns `{ tag, title, options }` for the outcome card, or null when the
 * push is not a call_end. Delivery is capability-gated server-side — only
 * subscriptions that declared caps:["call_end"] receive one — so this handler
 * ships in the same deploy as the cap declaration (subscription-machine.ts)
 * and no un-updated worker ever sees the kind (it would render a stray generic
 * notification, §8.5.4).
 */
function callEndNotification(rawText, origin) {
  if (typeof rawText !== "string" || rawText.length === 0) return null;
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!payload || payload.kind !== "call_end") return null;
  const url = normalizeNotificationUrl(payload.url, origin);
  const tag = callTag(url, origin);
  return {
    tag,
    title:
      typeof payload.title === "string" && payload.title.trim() !== ""
        ? payload.title
        : "Call ended",
    options: {
      body:
        typeof payload.body === "string" && payload.body.trim() !== ""
          ? payload.body
          : "The call is over.",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // The ring's own tag, so this REPLACES it in place — one card per call,
      // never a ring sitting beside its own obituary.
      tag,
      // It replaces an alert the member has already heard: no second buzz, and
      // no staying on screen the way a live call does.
      renotify: false,
      silent: true,
      requireInteraction: false,
      data: { url: "/calls" },
    },
  };
}

/**
 * Close the ring, then render the outcome in its place.
 *
 * Rendering NOTHING here was the tidier behaviour and the browsers do not
 * allow it (#265): a Web Push subscription is created `userVisibleOnly: true`,
 * and Firefox unsubscribes an endpoint that keeps pushing silently — a member
 * losing every ring, text and missed-call alert with no way to find out why —
 * while Chrome eventually posts its own "site updated in the background"
 * notice, which is exactly the ghost we were avoiding. Showing the outcome on
 * the ring's tag honors the contract AND answers the member's actual question:
 * did anyone get that call?
 */
async function showCallEnd(alert) {
  const notifications = await self.registration.getNotifications({
    tag: alert.tag,
  });
  for (const notification of notifications) {
    notification.close();
  }
  await self.registration.showNotification(alert.title, alert.options);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Drop EVERY prior cache but the current shell, including this app's
        // own superseded versions and any caches a long-lived install may still
        // hold. The origin is single-tenant, so a blanket sweep is safe and
        // keeps no ghosts around.
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let rawText = null;
  if (event.data) {
    try {
      rawText = event.data.text();
    } catch {
      rawText = null;
    }
  }
  // A call_end retires the ring (#170 CALLS-V3 §10.3): close the session's
  // ring notification and put the outcome in its place on the same tag.
  const callEnd = callEndNotification(rawText, self.location.origin);
  if (callEnd !== null) {
    event.waitUntil(showCallEnd(callEnd));
    return;
  }
  const { title, options } = formatPushNotification(
    rawText,
    self.location.origin,
  );
  event.waitUntil(self.registration.showNotification(title, options));
});

/** Focus a tab already on the thread, else refocus + navigate, else open. */
async function openThread(path) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    let clientPath = null;
    try {
      clientPath = new URL(client.url).pathname;
    } catch {
      clientPath = null;
    }
    if (clientPath === path && "focus" in client) {
      return client.focus();
    }
  }
  for (const client of windows) {
    if ("navigate" in client && "focus" in client) {
      await client.focus();
      return client.navigate(path);
    }
  }
  return self.clients.openWindow(path);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/inbox";
  event.waitUntil(openThread(path));
});

/**
 * Push capabilities THIS worker build implements (#170 CALLS-V3 §9.2).
 * 'call_end' attests the push handler above dismisses the ring notification —
 * the server sends kind:'call_end' only to subscription rows declaring it.
 * Must stay in lockstep with PUSH_SUBSCRIPTION_CAPS in the page's
 * subscription-machine.ts (same deploy unit).
 */
const PUSH_CAPS = ["call_end"];

/**
 * Shape a browser PushSubscription.toJSON() into the /v1/push-subscriptions
 * body (incl. the caps declaration), or null when it is incomplete. Pure —
 * asserted by the unit tests.
 */
function subscriptionSaveBody(json) {
  if (!json || typeof json.endpoint !== "string") return null;
  const keys = json.keys || {};
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    return null;
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    caps: PUSH_CAPS.slice(),
  };
}

/**
 * `pushsubscriptionchange` (#143): the browser rotated our push endpoint (or
 * dropped it after a server-side 404/410 prune). Web Push subscriptions rotate
 * silently and this event is not fired reliably across browsers, so it is a
 * best-effort renewal, NOT the primary repair — the client's on-load reconcile
 * (subscription-machine init) is the reliable backstop.
 *
 * We cannot POST to the Bearer-authenticated API from here (a service worker
 * holds no session token), so we do the two things a worker can: (1) re-subscribe
 * with the SAME VAPID application key so a VALID browser subscription exists for
 * the on-load reconcile to save, and (2) message any open tab so it re-saves
 * immediately through the authenticated client instead of waiting for a reload.
 */
async function handlePushSubscriptionChange(event) {
  let subscription = event && event.newSubscription ? event.newSubscription : null;
  if (!subscription) {
    const old = event && event.oldSubscription;
    const applicationServerKey =
      old && old.options ? old.options.applicationServerKey : undefined;
    if (!applicationServerKey) return; // no key to renew with — reconcile handles it
    try {
      subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch {
      return; // renewal failed — the on-load reconcile is the backstop
    }
  }
  const body = subscriptionSaveBody(subscription.toJSON());
  if (!body) return;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    if (typeof client.postMessage === "function") {
      client.postMessage({ type: "loonext:push-subscription-changed" });
    }
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(handlePushSubscriptionChange(event));
});

self.addEventListener("fetch", (event) => {
  // App-shell fallback for page loads only. Everything else (API calls,
  // realtime, assets) goes straight to the network untouched.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.match(OFFLINE_URL))
        .then(
          (cached) =>
            cached ??
            new Response("You're offline. Loonext needs a connection.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        ),
    ),
  );
});

// Test seam: the pure helpers above are asserted directly by the unit tests,
// which evaluate this file in a VM with a stubbed `self`. Harmless in
// production (an extra property on the worker global).
self.__loonextSw = {
  SHELL_CACHE,
  OFFLINE_URL,
  PRECACHE,
  normalizeNotificationUrl,
  formatPushNotification,
  callEndNotification,
  subscriptionSaveBody,
};
