/*
 * JobText service worker (DESIGN.md G9, SPEC §8).
 *
 * Three jobs, nothing speculative:
 *   1. push          → show "contact name + snippet" notifications from the
 *                      server payload (apps/api/src/notifications/inbound.ts
 *                      sends `{ title, body, url }`).
 *   2. notificationclick → focus an open JobText tab on the deep-linked
 *                      thread, or open one.
 *   3. offline       → precached app-shell fallback (offline.html) for
 *                      navigations that can't reach the network. No other
 *                      caching: the app is realtime, staleness is worse than
 *                      a spinner.
 *
 * The pure helpers up top are the unit-tested surface — vitest evaluates this
 * exact file in a VM sandbox (src/lib/push/sw.test.ts) and drives the
 * listeners with fake events, so what ships is what's tested.
 */
"use strict";

/** Bump when the precache list or offline.html changes. */
const SHELL_CACHE = "jobtext-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/favicon.svg"];

/**
 * Map a notification deep link onto an app path on THIS origin.
 *
 * The API's push payload links to `/conversations/{id}` (see
 * apps/api/src/notifications/inbound.ts); the thread route in the app is
 * `/inbox/{id}` (DESIGN.md G3) — normalize here so a tap always lands on the
 * real screen. Foreign or unparseable URLs fall back to the inbox rather
 * than opening an arbitrary destination from a push payload.
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
 * Pure formatter: raw push payload text → showNotification arguments.
 * Payload shape (SPEC §8): { title: contact display name, body: 80-char
 * snippet, url: deep link }. Anything malformed still produces a calm,
 * honest notification — a subscribed push should never be silently dropped.
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
  const title =
    payload && typeof payload.title === "string" && payload.title.trim() !== ""
      ? payload.title
      : "JobText";
  const body =
    payload && typeof payload.body === "string" && payload.body.trim() !== ""
      ? payload.body
      : "You have a new message.";
  const url = normalizeNotificationUrl(payload ? payload.url : null, origin);
  return {
    title,
    options: {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // One notification per thread: a second text from the same customer
      // replaces the first instead of stacking (calm, G1) but still alerts.
      tag: `jobtext:${url}`,
      renotify: true,
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
        Promise.all(
          keys
            .filter((key) => key.startsWith("jobtext-") && key !== SHELL_CACHE)
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
  // App-shell fallback for page loads only (G9). Everything else — API calls,
  // realtime, assets — goes straight to the network untouched.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.match(OFFLINE_URL))
        .then(
          (cached) =>
            cached ??
            new Response("You're offline — JobText needs a connection.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        ),
    ),
  );
});

// Test seam: the pure helpers above are asserted directly by
// src/lib/push/sw.test.ts, which evaluates this file in a VM with a stubbed
// `self`. Harmless in production (an extra property on the worker global).
self.__jobtextSw = {
  SHELL_CACHE,
  OFFLINE_URL,
  PRECACHE,
  normalizeNotificationUrl,
  formatPushNotification,
};
