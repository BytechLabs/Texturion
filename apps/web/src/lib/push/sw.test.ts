/**
 * Service-worker suite (G9): evaluates the REAL public/sw.js in a VM sandbox
 * with a stubbed worker global, then asserts the push payload → notification
 * mapping (the pure formatter the file factors out), the deep-link
 * normalization, and the notificationclick focus/open behavior. What ships
 * is what's tested — no parallel reimplementation.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);

const ORIGIN = "https://app.loonext.com";

interface WindowClientStub {
  url: string;
  focus?: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

/** A displayed notification the harness can hand back from getNotifications. */
interface NotificationStub {
  tag: string;
  close: ReturnType<typeof vi.fn>;
}

function loadServiceWorker(
  clients: WindowClientStub[] = [],
  notifications: NotificationStub[] = [],
) {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve(null));
  const getNotifications = vi.fn((filter?: { tag?: string }) =>
    Promise.resolve(
      notifications.filter((n) => !filter?.tag || n.tag === filter.tag),
    ),
  );
  const pushSubscribe = vi.fn(() =>
    Promise.resolve({
      toJSON: () => ({
        endpoint: "https://push.example.net/renewed",
        keys: { p256dh: "P256DH", auth: "AUTH" },
      }),
    }),
  );

  const self: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    location: { origin: ORIGIN },
    registration: {
      showNotification,
      getNotifications,
      pushManager: { subscribe: pushSubscribe },
    },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(clients)),
      openWindow,
      claim: vi.fn(() => Promise.resolve()),
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
  };

  const sandbox = {
    self,
    console,
    URL,
    Response: class {},
    caches: {
      open: vi.fn(() =>
        Promise.resolve({
          addAll: vi.fn(() => Promise.resolve()),
          match: vi.fn(() => Promise.resolve(undefined)),
        }),
      ),
      keys: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() => Promise.resolve(true)),
    },
    fetch: vi.fn(),
  };
  createContext(sandbox);
  runInContext(SW_SOURCE, sandbox);

  const exposed = (self as { __loonextSw?: Record<string, unknown> }).__loonextSw;
  if (!exposed) throw new Error("sw.js did not expose its test seam");
  return {
    listeners,
    showNotification,
    getNotifications,
    openWindow,
    pushSubscribe,
    formatPushNotification: exposed.formatPushNotification as (
      rawText: string | null,
      origin: string,
    ) => { title: string; options: Record<string, unknown> },
    normalizeNotificationUrl: exposed.normalizeNotificationUrl as (
      rawUrl: unknown,
      origin: string,
    ) => string,
    callEndDismissTag: exposed.callEndDismissTag as (
      rawText: string | null,
      origin: string,
    ) => string | null,
    subscriptionSaveBody: exposed.subscriptionSaveBody as (json: unknown) => {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      caps: string[];
    } | null,
  };
}

/** Run a listener with a waitUntil-capturing event and settle its work. */
async function dispatch(
  listeners: Map<string, (event: unknown) => void>,
  type: string,
  event: Record<string, unknown>,
) {
  const pending: Promise<unknown>[] = [];
  const listener = listeners.get(type);
  if (!listener) throw new Error(`no ${type} listener registered`);
  listener({
    ...event,
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work);
    },
  });
  await Promise.all(pending);
}

describe("push payload → notification mapping (SPEC §8 payload)", () => {
  const sw = loadServiceWorker();

  it("maps the server payload to contact name + snippet + thread link", () => {
    // Exact payload shape sent by apps/api/src/notifications/inbound.ts.
    const raw = JSON.stringify({
      title: "Dana Miller",
      body: "Can you come by Tuesday morning instead?",
      url: `${ORIGIN}/conversations/7c9e6679-7425-40de-944b-e07fc1f90ae7`,
    });
    const { title, options } = sw.formatPushNotification(raw, ORIGIN);
    expect(title).toBe("Dana Miller");
    expect(options).toMatchObject({
      body: "Can you come by Tuesday morning instead?",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      renotify: true,
      data: { url: "/inbox/7c9e6679-7425-40de-944b-e07fc1f90ae7" },
    });
    // Same-thread pushes collapse into one notification.
    expect(options.tag).toBe(
      "loonext:/inbox/7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
    // A message is not persistent and does not buzz.
    expect(options.requireInteraction).toBe(false);
    expect(options.vibrate).toBeUndefined();
  });

  it("renders a kind:'call' push as an urgent, persistent, buzzing alert (#135 push-to-wake)", () => {
    // Exact payload shape sent by apps/api/src/notifications/incoming-call.ts.
    const raw = JSON.stringify({
      kind: "call",
      title: "Incoming call",
      body: "+16135551000",
      url: "/calls",
    });
    const { title, options } = sw.formatPushNotification(raw, ORIGIN);
    expect(title).toBe("Incoming call");
    expect(options).toMatchObject({
      body: "+16135551000",
      tag: "loonext:call", // no session in the url → the constant fallback
      requireInteraction: true, // stays on screen until acted on
      data: { url: "/calls" },
    });
    expect(Array.isArray(options.vibrate)).toBe(true);
  });

  it("scopes a call notification's tag to its session so concurrent calls don't collapse (#149)", () => {
    const one = sw.formatPushNotification(
      JSON.stringify({ kind: "call", title: "Call", url: "/calls?call=sess-A" }),
      ORIGIN,
    );
    const two = sw.formatPushNotification(
      JSON.stringify({ kind: "call", title: "Call", url: "/calls?call=sess-B" }),
      ORIGIN,
    );
    expect(one.options.tag).toBe("loonext:call:sess-A");
    expect(two.options.tag).toBe("loonext:call:sess-B");
    // Two live calls on two numbers render as DISTINCT notifications.
    expect(one.options.tag).not.toBe(two.options.tag);
    // A repeat push for the SAME call still coalesces (same tag).
    const repeat = sw.formatPushNotification(
      JSON.stringify({ kind: "call", title: "Call", url: "/calls?call=sess-A" }),
      ORIGIN,
    );
    expect(repeat.options.tag).toBe(one.options.tag);
  });

  it("still shows a calm generic notification for empty or garbage payloads", () => {
    for (const raw of [null, "", "not-json", "{}"]) {
      const { title, options } = sw.formatPushNotification(raw, ORIGIN);
      expect(title).toBe("Loonext");
      expect(options.body).toBe("You have a new message.");
      expect((options.data as { url: string }).url).toBe("/inbox");
    }
  });

  it("never deep-links off-origin from a push payload", () => {
    const raw = JSON.stringify({
      title: "x",
      body: "y",
      url: "https://evil.example.com/inbox/123",
    });
    const { options } = sw.formatPushNotification(raw, ORIGIN);
    expect((options.data as { url: string }).url).toBe("/inbox");
  });
});

describe("normalizeNotificationUrl", () => {
  const sw = loadServiceWorker();

  it("rewrites the API's /conversations/:id link to the app's thread route (G3)", () => {
    expect(
      sw.normalizeNotificationUrl(`${ORIGIN}/conversations/abc-123`, ORIGIN),
    ).toBe("/inbox/abc-123");
    expect(
      sw.normalizeNotificationUrl(`${ORIGIN}/conversations/abc-123/`, ORIGIN),
    ).toBe("/inbox/abc-123");
  });

  it("preserves the query on the incoming-call push URL (#135 push-to-wake)", () => {
    expect(
      sw.normalizeNotificationUrl("/calls?call=sess-abc-123", ORIGIN),
    ).toBe("/calls?call=sess-abc-123");
  });

  it("keeps already-correct same-origin paths", () => {
    expect(sw.normalizeNotificationUrl(`${ORIGIN}/inbox/abc`, ORIGIN)).toBe(
      "/inbox/abc",
    );
    expect(sw.normalizeNotificationUrl("/inbox/abc", ORIGIN)).toBe(
      "/inbox/abc",
    );
  });

  it("falls back to /inbox for foreign, missing, or malformed URLs", () => {
    expect(
      sw.normalizeNotificationUrl("https://evil.example.com/x", ORIGIN),
    ).toBe("/inbox");
    expect(sw.normalizeNotificationUrl(undefined, ORIGIN)).toBe("/inbox");
    expect(sw.normalizeNotificationUrl("", ORIGIN)).toBe("/inbox");
    expect(sw.normalizeNotificationUrl(42, ORIGIN)).toBe("/inbox");
  });
});

describe("push event listener", () => {
  it("shows the formatted notification from the event payload", async () => {
    const sw = loadServiceWorker();
    const raw = JSON.stringify({
      title: "Dana Miller",
      body: "On my way.",
      url: `${ORIGIN}/conversations/thread-1`,
    });
    await dispatch(sw.listeners, "push", { data: { text: () => raw } });
    expect(sw.showNotification).toHaveBeenCalledExactlyOnceWith(
      "Dana Miller",
      expect.objectContaining({
        body: "On my way.",
        data: { url: "/inbox/thread-1" },
      }),
    );
  });

  it("shows the generic notification when the push carries no data", async () => {
    const sw = loadServiceWorker();
    await dispatch(sw.listeners, "push", { data: null });
    expect(sw.showNotification).toHaveBeenCalledExactlyOnceWith(
      "Loonext",
      expect.objectContaining({ body: "You have a new message." }),
    );
  });
});

describe("kind:'call_end' revocation push (#170 CALLS-V3 §9.2/§10.3)", () => {
  const callEndRaw = (url: string) =>
    JSON.stringify({ kind: "call_end", url, reason: "answered" });

  it("closes the session's ring notification by tag and renders NOTHING", async () => {
    const ringing = { tag: "loonext:call:sess-A", close: vi.fn() };
    const otherCall = { tag: "loonext:call:sess-B", close: vi.fn() };
    const thread = { tag: "loonext:/inbox/t-1", close: vi.fn() };
    const sw = loadServiceWorker([], [ringing, otherCall, thread]);

    await dispatch(sw.listeners, "push", {
      data: { text: () => callEndRaw("/calls?call=sess-A") },
    });

    // The revoked session's alert is gone; a CONCURRENT live call's alert and
    // message notifications are untouched.
    expect(ringing.close).toHaveBeenCalled();
    expect(otherCall.close).not.toHaveBeenCalled();
    expect(thread.close).not.toHaveBeenCalled();
    // A revocation is not an alert — no notification of any kind is shown
    // (rendering one would recreate the stray-tray ghost, §8.5.4).
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(sw.getNotifications).toHaveBeenCalledWith({
      tag: "loonext:call:sess-A",
    });
  });

  it("derives the tag through the SAME pipeline as the ring push, so they always match", () => {
    const sw = loadServiceWorker();
    const ring = sw.formatPushNotification(
      JSON.stringify({ kind: "call", title: "Call", url: "/calls?call=sess-X" }),
      ORIGIN,
    );
    expect(sw.callEndDismissTag(callEndRaw("/calls?call=sess-X"), ORIGIN)).toBe(
      ring.options.tag,
    );
    // Session-less urls fall back to the SAME constant tag the ring used.
    const fallbackRing = sw.formatPushNotification(
      JSON.stringify({ kind: "call", title: "Call", url: "/calls" }),
      ORIGIN,
    );
    expect(sw.callEndDismissTag(callEndRaw("/calls"), ORIGIN)).toBe(
      fallbackRing.options.tag,
    );
  });

  it("is a quiet no-op when the notification was already gone (tapped/timed out)", async () => {
    const sw = loadServiceWorker([], []);
    await dispatch(sw.listeners, "push", {
      data: { text: () => callEndRaw("/calls?call=sess-A") },
    });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("never treats other kinds (or garbage) as a revocation", () => {
    const sw = loadServiceWorker();
    for (const raw of [
      JSON.stringify({ kind: "call", url: "/calls?call=sess-A" }),
      JSON.stringify({ title: "Dana", body: "hi", url: "/conversations/t-1" }),
      "not-json",
      "",
      null,
    ]) {
      expect(sw.callEndDismissTag(raw, ORIGIN)).toBeNull();
    }
  });
});

describe("notificationclick listener", () => {
  const clickEvent = (url: string) => ({
    notification: { close: vi.fn(), data: { url } },
  });

  it("focuses a tab already on the thread", async () => {
    const onThread = {
      url: `${ORIGIN}/inbox/thread-1`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(),
    };
    const elsewhere = {
      url: `${ORIGIN}/contacts`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(),
    };
    const sw = loadServiceWorker([elsewhere, onThread]);
    const event = clickEvent("/inbox/thread-1");
    await dispatch(sw.listeners, "notificationclick", event);

    expect(event.notification.close).toHaveBeenCalled();
    expect(onThread.focus).toHaveBeenCalled();
    expect(elsewhere.navigate).not.toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("refocuses an open tab and navigates it to the thread", async () => {
    const elsewhere = {
      url: `${ORIGIN}/contacts`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.resolve()),
    };
    const sw = loadServiceWorker([elsewhere]);
    await dispatch(sw.listeners, "notificationclick", clickEvent("/inbox/t-2"));

    expect(elsewhere.focus).toHaveBeenCalled();
    expect(elsewhere.navigate).toHaveBeenCalledWith("/inbox/t-2");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when no tab exists", async () => {
    const sw = loadServiceWorker([]);
    await dispatch(sw.listeners, "notificationclick", clickEvent("/inbox/t-3"));
    expect(sw.openWindow).toHaveBeenCalledWith("/inbox/t-3");
  });

  it("falls back to the inbox when the notification carries no URL", async () => {
    const sw = loadServiceWorker([]);
    await dispatch(sw.listeners, "notificationclick", {
      notification: { close: vi.fn(), data: null },
    });
    expect(sw.openWindow).toHaveBeenCalledWith("/inbox");
  });
});

describe("offline fallback wiring", () => {
  it("precaches offline.html on install", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const addAll = vi.fn(() => Promise.resolve());
    const sandboxSelf: Record<string, unknown> = {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      location: { origin: ORIGIN },
      registration: {},
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(() => Promise.resolve()),
    };
    const sandbox = {
      self: sandboxSelf,
      console,
      URL,
      Response: class {},
      caches: {
        open: vi.fn(() => Promise.resolve({ addAll })),
        keys: vi.fn(() => Promise.resolve([])),
        delete: vi.fn(() => Promise.resolve(true)),
      },
      fetch: vi.fn(),
    };
    createContext(sandbox);
    runInContext(SW_SOURCE, sandbox);
    await dispatch(listeners, "install", {});
    expect(addAll).toHaveBeenCalledWith(
      expect.arrayContaining(["/offline.html"]),
    );
  });

  it("serves the cached offline page when a navigation fetch fails", async () => {
    const sw = loadServiceWorker();
    const offlinePage = { offline: true };
    const cache = {
      addAll: vi.fn(() => Promise.resolve()),
      match: vi.fn(() => Promise.resolve(offlinePage)),
    };

    // Re-evaluate with a failing network + a stocked cache.
    const listeners = new Map<string, (event: unknown) => void>();
    const sandbox = {
      self: {
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
        location: { origin: ORIGIN },
        registration: {},
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(() => Promise.resolve()),
      },
      console,
      URL,
      Response: class {},
      caches: {
        open: vi.fn(() => Promise.resolve(cache)),
        keys: vi.fn(() => Promise.resolve([])),
        delete: vi.fn(() => Promise.resolve(true)),
      },
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
    };
    createContext(sandbox);
    runInContext(SW_SOURCE, sandbox);

    let responded: unknown = null;
    const listener = listeners.get("fetch");
    if (!listener) throw new Error("no fetch listener");
    listener({
      request: { mode: "navigate", url: `${ORIGIN}/inbox` },
      respondWith: (value: Promise<unknown>) => {
        responded = value;
      },
    });
    await expect(responded).resolves.toBe(offlinePage);
    expect(cache.match).toHaveBeenCalledWith("/offline.html");
    void sw; // first instance only proves double-evaluation is safe
  });

  it("never intercepts non-navigation requests (API, realtime, assets)", () => {
    const sw = loadServiceWorker();
    const respondWith = vi.fn();
    const listener = sw.listeners.get("fetch");
    if (!listener) throw new Error("no fetch listener");
    listener({
      request: { mode: "cors", url: `${ORIGIN}/v1/conversations` },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});

describe("subscriptionSaveBody", () => {
  const sw = loadServiceWorker();

  it("shapes a complete subscription into the POST body, declaring this build's caps", () => {
    expect(
      sw.subscriptionSaveBody({
        endpoint: "https://push.example.net/x",
        keys: { p256dh: "P", auth: "A" },
      }),
    ).toEqual({
      endpoint: "https://push.example.net/x",
      keys: { p256dh: "P", auth: "A" },
      // #170 CALLS-V3 §9.2: this worker build handles kind:'call_end', so the
      // body it shapes attests it.
      caps: ["call_end"],
    });
  });

  it("returns null for missing endpoint or keys", () => {
    expect(sw.subscriptionSaveBody(null)).toBeNull();
    expect(sw.subscriptionSaveBody({ keys: { p256dh: "P", auth: "A" } })).toBeNull();
    expect(
      sw.subscriptionSaveBody({ endpoint: "https://x", keys: { p256dh: "P" } }),
    ).toBeNull();
    expect(sw.subscriptionSaveBody({ endpoint: "https://x" })).toBeNull();
  });
});

describe("pushsubscriptionchange listener (#143)", () => {
  it("re-subscribes with the old VAPID key and messages every open tab to re-save", async () => {
    const tab = { url: `${ORIGIN}/calls`, postMessage: vi.fn() };
    const sw = loadServiceWorker([tab]);
    const applicationServerKey = new Uint8Array([4, 1, 2, 3]);

    await dispatch(sw.listeners, "pushsubscriptionchange", {
      oldSubscription: { options: { applicationServerKey } },
      newSubscription: null,
    });

    // Renewed with the SAME key the browser used before.
    expect(sw.pushSubscribe).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey,
    });
    // Open tabs are told to re-save through the authenticated client.
    expect(tab.postMessage).toHaveBeenCalledWith({
      type: "loonext:push-subscription-changed",
    });
  });

  it("uses the browser-provided newSubscription without re-subscribing", async () => {
    const tab = { url: `${ORIGIN}/inbox`, postMessage: vi.fn() };
    const sw = loadServiceWorker([tab]);

    await dispatch(sw.listeners, "pushsubscriptionchange", {
      newSubscription: {
        toJSON: () => ({
          endpoint: "https://push.example.net/new",
          keys: { p256dh: "P", auth: "A" },
        }),
      },
    });

    expect(sw.pushSubscribe).not.toHaveBeenCalled();
    expect(tab.postMessage).toHaveBeenCalledWith({
      type: "loonext:push-subscription-changed",
    });
  });

  it("no-ops when there is no key to renew with (reconcile is the backstop)", async () => {
    const tab = { url: `${ORIGIN}/inbox`, postMessage: vi.fn() };
    const sw = loadServiceWorker([tab]);

    await dispatch(sw.listeners, "pushsubscriptionchange", {
      oldSubscription: { options: {} },
      newSubscription: null,
    });

    expect(sw.pushSubscribe).not.toHaveBeenCalled();
    expect(tab.postMessage).not.toHaveBeenCalled();
  });
});
