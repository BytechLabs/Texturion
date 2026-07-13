/*
 * Loonext service worker.
 *
 * Three jobs, nothing speculative:
 *   1. push              -> show "contact name + snippet" notifications from
 *                           the server payload ({ title, body, url }).
 *   2. notificationclick -> focus an open Loonext tab on the deep-linked
 *                           thread, or open one.
 *   3. offline           -> precached app-shell fallback (offline.html) for
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
  return path.startsWith("/") ? path : "/inbox";
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
      // A call is one live alert (tag 'loonext:call'), kept on screen until
      // acted on and buzzing; a message is one-per-thread and quiet.
      tag: isCall ? "loonext:call" : `loonext:${url}`,
      renotify: true,
      requireInteraction: isCall,
      vibrate: isCall ? [200, 100, 200, 100, 200] : undefined,
      data: { url },
    },
  };
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
};
