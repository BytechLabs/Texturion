/**
 * The Web Push subscription state machine (G8/G9), driven with a stubbed
 * PushManager + API — only the browser/network edge is faked, the machine
 * under test is the exact code the hook binds to React.
 */
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

import {
  createPushMachine,
  subscriptionToKeys,
  vapidKeyToApplicationServerKey,
  type BrowserPushSubscription,
  type PushEnvironment,
  type PushManagerLike,
  type PushPermission,
  type PushSnapshot,
} from "./subscription-machine";

const b64u = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");

/** A structurally valid VAPID public key (65-byte 0x04 P-256 point). */
const VAPID_KEY = b64u(
  Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i)),
);

function fakeSubscription(endpoint = "https://push.example.net/send/dev-1"): {
  subscription: BrowserPushSubscription;
  unsubscribed: () => boolean;
} {
  let unsubscribed = false;
  return {
    subscription: {
      toJSON: () => ({ endpoint, keys: { p256dh: "P256DH", auth: "AUTH" } }),
      unsubscribe: vi.fn(async () => {
        unsubscribed = true;
        return true;
      }),
    },
    unsubscribed: () => unsubscribed,
  };
}

interface HarnessOptions {
  supported?: boolean;
  permission?: PushPermission;
  promptResult?: PushPermission;
  existing?: BrowserPushSubscription | null;
  calls?: string[];
}

function harness(options: HarnessOptions = {}) {
  const {
    supported = true,
    permission = "default",
    promptResult = "granted",
    existing = null,
    calls = [],
  } = options;

  let current: BrowserPushSubscription | null = existing;
  let currentPermission: PushPermission = permission;

  const manager: PushManagerLike = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (opts) => {
      calls.push("pushManager.subscribe");
      // The machine must hand Chrome a decoded 65-byte point, not a string.
      expect(opts.userVisibleOnly).toBe(true);
      expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
      expect(opts.applicationServerKey[0]).toBe(0x04);
      expect(opts.applicationServerKey).toHaveLength(65);
      current = fakeSubscription().subscription;
      return current;
    }),
  };

  const env: PushEnvironment = {
    supported,
    getPermission: () => currentPermission,
    requestPermission: vi.fn(async () => {
      calls.push("requestPermission");
      currentPermission = promptResult;
      return promptResult;
    }),
    getPushManager: vi.fn(async () => manager),
    fetchVapidPublicKey: vi.fn(async () => {
      calls.push("fetchVapidPublicKey");
      return VAPID_KEY;
    }),
    saveSubscription: vi.fn(async () => {
      calls.push("saveSubscription");
      return { id: "row-1" };
    }),
    deleteSubscription: vi.fn(async () => {
      calls.push("deleteSubscription");
    }),
  };

  const phases: string[] = [];
  const machine = createPushMachine(env, (snapshot: PushSnapshot) => {
    phases.push(snapshot.phase);
  });
  return { machine, env, manager, phases, calls };
}

describe("vapidKeyToApplicationServerKey", () => {
  it("decodes a base64url uncompressed P-256 point", () => {
    const bytes = vapidKeyToApplicationServerKey(VAPID_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("rejects wrong-length keys and non-base64url input", () => {
    expect(() => vapidKeyToApplicationServerKey(b64u(new Uint8Array(32)))).toThrow(
      /P-256/,
    );
    expect(() => vapidKeyToApplicationServerKey("!not-base64!")).toThrow();
  });
});

describe("subscriptionToKeys", () => {
  it("shapes PushSubscription.toJSON() into the POST body", () => {
    const { subscription } = fakeSubscription("https://push.example.net/x");
    expect(subscriptionToKeys(subscription)).toEqual({
      endpoint: "https://push.example.net/x",
      keys: { p256dh: "P256DH", auth: "AUTH" },
    });
  });

  it("throws on incomplete browser subscriptions", () => {
    expect(() =>
      subscriptionToKeys({
        toJSON: () => ({ endpoint: "https://push.example.net/x", keys: {} }),
        unsubscribe: async () => true,
      }),
    ).toThrow(/incomplete/);
  });
});

describe("init", () => {
  it("lands on unsupported when the browser lacks the stack", async () => {
    const { machine } = harness({ supported: false });
    await machine.init();
    expect(machine.snapshot().phase).toBe("unsupported");
  });

  it("lands on subscribed for granted permission + existing subscription", async () => {
    const { machine } = harness({
      permission: "granted",
      existing: fakeSubscription().subscription,
    });
    await machine.init();
    expect(machine.snapshot()).toMatchObject({
      phase: "subscribed",
      permission: "granted",
    });
  });

  it("re-upserts the existing subscription on load so a pruned/rotated server row self-heals (#143)", async () => {
    const { machine, env } = harness({
      permission: "granted",
      existing: fakeSubscription("https://push.example.net/rotated").subscription,
    });
    await machine.init();
    expect(machine.snapshot().phase).toBe("subscribed");
    // The reconcile re-POSTs the current browser subscription — so a
    // server-side prune (incoming-call 410 cleanup) is repaired on next open.
    expect(env.saveSubscription).toHaveBeenCalledTimes(1);
    expect(env.saveSubscription).toHaveBeenCalledWith({
      endpoint: "https://push.example.net/rotated",
      keys: { p256dh: "P256DH", auth: "AUTH" },
    });
  });

  it("stays subscribed when the on-load reconcile save fails — best-effort (#143)", async () => {
    const { machine, env } = harness({
      permission: "granted",
      existing: fakeSubscription().subscription,
    });
    vi.mocked(env.saveSubscription).mockRejectedValueOnce(new Error("offline"));
    await machine.init();
    // A failed reconcile must not knock the device out of 'subscribed' — it IS
    // subscribed; the reconcile simply retries on the next init().
    expect(machine.snapshot()).toMatchObject({
      phase: "subscribed",
      error: null,
    });
  });

  it("lands on idle when supported but not subscribed", async () => {
    const { machine } = harness({ permission: "default" });
    await machine.init();
    expect(machine.snapshot().phase).toBe("idle");
  });

  it("lands on denied for blocked permission without touching the SW", async () => {
    const { machine, env } = harness({ permission: "denied" });
    await machine.init();
    expect(machine.snapshot().phase).toBe("denied");
    expect(env.getPushManager).not.toHaveBeenCalled();
  });

  it("degrades to idle when the SW registration lookup fails", async () => {
    const { machine, env } = harness({ permission: "granted" });
    vi.mocked(env.getPushManager).mockRejectedValueOnce(new Error("boom"));
    await machine.init();
    expect(machine.snapshot()).toMatchObject({ phase: "idle", error: null });
  });
});

describe("subscribe", () => {
  it("prompts, subscribes with the decoded VAPID key, saves, → subscribed", async () => {
    const { machine, phases, calls, env } = harness({
      promptResult: "granted",
    });
    await machine.init();
    await machine.subscribe();

    expect(machine.snapshot()).toMatchObject({
      phase: "subscribed",
      permission: "granted",
      error: null,
    });
    // Permission FIRST (from the user's click, G8), then key, then browser
    // subscribe, then the server save.
    expect(calls).toEqual([
      "requestPermission",
      "fetchVapidPublicKey",
      "pushManager.subscribe",
      "saveSubscription",
    ]);
    expect(env.saveSubscription).toHaveBeenCalledWith({
      endpoint: "https://push.example.net/send/dev-1",
      keys: { p256dh: "P256DH", auth: "AUTH" },
    });
    expect(phases).toContain("subscribing");
  });

  it("lands on denied when the prompt is refused — and never subscribes", async () => {
    const { machine, env, manager } = harness({ promptResult: "denied" });
    await machine.init();
    await machine.subscribe();
    expect(machine.snapshot().phase).toBe("denied");
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(env.saveSubscription).not.toHaveBeenCalled();
  });

  it("returns to idle quietly when the prompt is dismissed", async () => {
    const { machine, manager } = harness({ promptResult: "default" });
    await machine.init();
    await machine.subscribe();
    expect(machine.snapshot()).toMatchObject({ phase: "idle", error: null });
    expect(manager.subscribe).not.toHaveBeenCalled();
  });

  it("skips the prompt when permission is already granted", async () => {
    const { machine, env } = harness({ permission: "granted" });
    await machine.init();
    await machine.subscribe();
    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(machine.snapshot().phase).toBe("subscribed");
  });

  it("reuses an existing browser subscription without re-subscribing", async () => {
    // Permission granted + browser subscription present but init saw none
    // (e.g. a previous attempt saved nothing server-side): the POST upsert
    // repairs the server row.
    const { subscription } = fakeSubscription();
    const { machine, env, manager } = harness({ permission: "granted" });
    await machine.init();
    vi.mocked(manager.getSubscription).mockResolvedValue(subscription);
    await machine.subscribe();
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(env.fetchVapidPublicKey).not.toHaveBeenCalled();
    expect(env.saveSubscription).toHaveBeenCalledTimes(1);
    expect(machine.snapshot().phase).toBe("subscribed");
  });

  it("surfaces a browser failure as a calm sentence and returns to idle", async () => {
    const { machine, manager } = harness({ permission: "granted" });
    await machine.init();
    vi.mocked(manager.subscribe).mockRejectedValueOnce(
      new DOMException("Registration failed", "AbortError"),
    );
    await machine.subscribe();
    expect(machine.snapshot()).toMatchObject({
      phase: "idle",
      error: "We couldn't turn on notifications. Try again in a moment.",
    });
  });

  it("passes ApiError messages through verbatim (they are customer-facing)", async () => {
    const { machine, env } = harness({ permission: "granted" });
    await machine.init();
    vi.mocked(env.saveSubscription).mockRejectedValueOnce(
      new ApiError("rate_limited", "Too many attempts. Wait a minute.", 429),
    );
    await machine.subscribe();
    expect(machine.snapshot().error).toBe("Too many attempts. Wait a minute.");
  });

  it("is a no-op outside the idle phase", async () => {
    const { machine, env } = harness({
      permission: "granted",
      existing: fakeSubscription().subscription,
    });
    await machine.init(); // → subscribed (the on-load reconcile saves once here)
    vi.mocked(env.saveSubscription).mockClear();
    await machine.subscribe();
    expect(env.saveSubscription).not.toHaveBeenCalled();
    expect(machine.snapshot().phase).toBe("subscribed");
  });
});

describe("unsubscribe", () => {
  async function subscribedMachine() {
    const { subscription, unsubscribed } = fakeSubscription();
    const h = harness({ permission: "granted", existing: subscription });
    await h.machine.init();
    // Drop the init-time on-load reconcile save (#143) so tests assert only the
    // unsubscribe sequence.
    h.calls.length = 0;
    vi.mocked(h.env.saveSubscription).mockClear();
    return { ...h, subscription, unsubscribed };
  }

  it("learns the row id via the upsert, deletes it, drops the browser sub", async () => {
    const { machine, env, calls, unsubscribed } = await subscribedMachine();
    await machine.unsubscribe();
    expect(machine.snapshot()).toMatchObject({ phase: "idle", error: null });
    // Server row goes first; the browser subscription is dropped last, so a
    // failure can never leave pushes flowing with no way to stop them.
    expect(calls).toEqual(["saveSubscription", "deleteSubscription"]);
    expect(env.deleteSubscription).toHaveBeenCalledWith("row-1");
    expect(unsubscribed()).toBe(true);
  });

  it("stays subscribed (with a sentence) when the server delete fails", async () => {
    const { machine, env, unsubscribed } = await subscribedMachine();
    vi.mocked(env.deleteSubscription).mockRejectedValueOnce(
      new Error("network down"),
    );
    await machine.unsubscribe();
    expect(machine.snapshot()).toMatchObject({
      phase: "subscribed",
      error: "We couldn't turn off notifications. Try again in a moment.",
    });
    expect(unsubscribed()).toBe(false);
  });

  it("settles to idle when the browser subscription already vanished", async () => {
    const { machine, manager, env } = await subscribedMachine();
    vi.mocked(manager.getSubscription).mockResolvedValue(null);
    await machine.unsubscribe();
    expect(machine.snapshot().phase).toBe("idle");
    expect(env.deleteSubscription).not.toHaveBeenCalled();
  });

  it("is a no-op outside the subscribed phase", async () => {
    const { machine, env } = harness();
    await machine.init(); // idle
    await machine.unsubscribe();
    expect(env.getPushManager).toHaveBeenCalledTimes(1); // init only
    expect(machine.snapshot().phase).toBe("idle");
  });
});
