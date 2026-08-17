/**
 * Framework-free Web Push subscription state machine (G8/G9, SPEC §8).
 *
 * All browser and network access is injected through `PushEnvironment`, so
 * the whole permission → subscribe → save / unsubscribe → delete flow is a
 * plain-function unit (subscription-machine.test.ts drives it with a stubbed
 * PushManager). use-push-subscription.ts binds it to React and the real
 * browser/API.
 *
 * Server contract (read from apps/api/src/routes/notifications.ts):
 *   GET    /v1/notification-prefs        → { …, vapid_public_key }
 *   POST   /v1/push-subscriptions        { endpoint, keys, caps, locale? }
 *                                       → { id, … }
 *          (upsert on (user_id, endpoint) — re-posting is how we learn the
 *          row id at unsubscribe time without any client-side persistence;
 *          `caps` is the #170 CALLS-V3 §9.2 capability declaration, `locale`
 *          the #228 device language)
 *   DELETE /v1/push-subscriptions/:id
 */
import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";

export type PushPermission = "default" | "granted" | "denied";

export type PushPhase =
  /** First inspection (existing subscription lookup) still running. */
  | "initializing"
  /** No SW/Push/Notification stack in this browser (e.g. iOS Safari tab). */
  | "unsupported"
  /** Supported, not subscribed on this device; subscribe() is available. */
  | "idle"
  /** Browser permission is denied — only browser settings can undo that. */
  | "denied"
  | "subscribing"
  | "subscribed"
  | "unsubscribing";

export interface PushSnapshot {
  phase: PushPhase;
  permission: PushPermission;
  /** Customer-facing sentence for the last failed action (G10), or null. */
  error: string | null;
}

/** The slice of a browser PushSubscription the machine touches. */
export interface BrowserPushSubscription {
  toJSON(): { endpoint?: string; keys?: Record<string, string | undefined> };
  unsubscribe(): Promise<boolean>;
}

/** The slice of PushManager the machine touches (stubbed in tests). */
export interface PushManagerLike {
  getSubscription(): Promise<BrowserPushSubscription | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    // ArrayBuffer-backed (not ArrayBufferLike) so the real PushManager's
    // BufferSource parameter accepts it under TS 5.9's generic typed arrays.
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<BrowserPushSubscription>;
}

/**
 * Push capabilities this web client declares on EVERY push-subscription save
 * (#170 CALLS-V3 §9.2): 'call_end' attests the deployed sw.js dismisses the
 * `loonext:call:<session>` ring notification when the server revokes a ring.
 * The server sends kind:'call_end' ONLY to subscription rows declaring the
 * cap, so an un-updated browser (whose worker would render the kind as a
 * stray generic notification, §8.5.4) never receives one. Ships in the same
 * deploy as the sw.js handler; the on-load reconcile upsert (init) is what
 * upgrades pre-existing rows. Keep in lockstep with PUSH_CAPS in
 * public/sw.js.
 */
export const PUSH_SUBSCRIPTION_CAPS = ["call_end"];

export interface SubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Capability declaration — see {@link PUSH_SUBSCRIPTION_CAPS}. */
  caps: string[];
  /**
   * #228 — the language THIS browser reads, so a push can be composed in it.
   *
   * A notification is written on the server, hours after anyone was looking at
   * the app, so the reader's language has to be a fact the row already carries.
   * `resolveUiLocale` reads it as the DEVICE rung, below the member's own
   * setting and above the workspace's. Optional: see {@link deviceLocaleTag}.
   */
  locale?: string;
}

export interface PushEnvironment {
  supported: boolean;
  getPermission(): PushPermission;
  /** Prompts the user — the machine only calls this inside subscribe() (G8). */
  requestPermission(): Promise<PushPermission>;
  /** Resolve the registered service worker's PushManager. */
  getPushManager(): Promise<PushManagerLike>;
  /** GET /v1/notification-prefs → vapid_public_key. */
  fetchVapidPublicKey(): Promise<string>;
  /** POST /v1/push-subscriptions (upsert) → server row. */
  saveSubscription(input: SubscriptionKeys): Promise<{ id: string }>;
  /** DELETE /v1/push-subscriptions/:id. */
  deleteSubscription(id: string): Promise<void>;
}

/**
 * Decode a standard base64url VAPID public key into the Uint8Array Chrome
 * requires as `applicationServerKey` (65-byte uncompressed P-256 point).
 */
export function vapidKeyToApplicationServerKey(
  key: string,
): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, "+").replace(/_/g, "/");
  let binary: string;
  try {
    binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    throw new Error("VAPID public key is not base64url.");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("VAPID public key is not an uncompressed P-256 point.");
  }
  return bytes;
}

/**
 * What language this browser says it is in ("fr-CA", "en-US"), or null where
 * there is nothing to ask — a server render, or a browser that reports "".
 *
 * Reported RAW, on purpose. Which tags count as French, and which are stored
 * as silence, is the server's decision (#228) — kept in one place so this
 * client and the two phones cannot quietly disagree about it. Normalising here
 * would give three hand-ported answers to one question.
 *
 * The same read the app's own language resolution makes in
 * lib/company/provider.tsx; the browser is the whole helper, there is nothing
 * shared to import.
 */
export function deviceLocaleTag(): string | null {
  if (typeof navigator === "undefined") return null;
  return navigator.language || null;
}

/** Extract the API body from a browser subscription; throws when malformed.
 *  Always carries the caps declaration — every save path (subscribe, the
 *  on-load reconcile, the unsubscribe row-id upsert, the sign-out release)
 *  goes through here, which is exactly how existing rows learn 'call_end'
 *  after this deploy. The device language rides along the same way, and for
 *  the same reason: whichever save happens first is what teaches an existing
 *  row which language to write in. */
export function subscriptionToKeys(
  subscription: BrowserPushSubscription,
  /**
   * Defaulted rather than read inline so this stays a pure shaper under test —
   * the browser is the only caller that ever passes nothing.
   */
  locale: string | null = deviceLocaleTag(),
): SubscriptionKeys {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Browser returned an incomplete push subscription.");
  }
  return {
    endpoint,
    keys: { p256dh, auth },
    caps: [...PUSH_SUBSCRIPTION_CAPS],
    // Omitted, never sent empty, when the browser will not say: the server
    // spreads this field, so an absent one leaves whatever an earlier
    // registration reported alone rather than blanking it. Same as caps.
    ...(locale ? { locale } : {}),
  };
}

/** ApiError messages are customer-facing (G10); DOM errors are not. */
function errorSentence(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

export interface PushMachine {
  snapshot(): PushSnapshot;
  /** Inspect support/permission/existing subscription. Run once on mount. */
  init(): Promise<void>;
  /**
   * Permission prompt (when needed) + PushManager.subscribe + server save.
   * Only ever call from an explicit user action (G8 — no ambushes).
   */
  subscribe(): Promise<void>;
  /** Server delete + browser unsubscribe. */
  unsubscribe(): Promise<void>;
}

export function createPushMachine(
  env: PushEnvironment,
  onChange: (snapshot: PushSnapshot) => void = () => {},
  /**
   * #228 — the two sentences this machine can put on screen, in the reader's
   * language. Injected like everything else here rather than reached for, which
   * is what keeps the whole flow a plain-function unit; the React binding in
   * `use-push-subscription.ts` passes the member's own.
   */
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): PushMachine {
  let state: PushSnapshot = {
    phase: env.supported ? "initializing" : "unsupported",
    permission: env.supported ? env.getPermission() : "default",
    error: null,
  };

  function set(patch: Partial<PushSnapshot>): void {
    state = { ...state, ...patch };
    onChange(state);
  }

  async function init(): Promise<void> {
    if (!env.supported) {
      // Announce through set() so React bindings that start at
      // "initializing" (SSR-safe) still land on the unsupported state.
      set({ phase: "unsupported", error: null });
      return;
    }
    const permission = env.getPermission();
    if (permission === "denied") {
      set({ phase: "denied", permission, error: null });
      return;
    }
    try {
      const manager = await env.getPushManager();
      const existing = await manager.getSubscription();
      if (existing && permission === "granted") {
        // Reconcile on load (#143): the server may have PRUNED our row after a
        // single FCM 404/410 (the incoming-call push cleanup), or this device's
        // FCM endpoint may have rotated, while the browser still reports us
        // 'subscribed'. Left alone, push-to-wake stays permanently dead and the
        // UI shows 'subscribed', so the user never re-toggles. Re-upsert the
        // current browser subscription so a lost/rotated server row self-heals
        // on the next app open. Best-effort: a failed save still lands us
        // 'subscribed' (the device IS subscribed) and retries next load.
        try {
          await env.saveSubscription(subscriptionToKeys(existing));
        } catch {
          /* keep 'subscribed'; the reconcile retries on the next init() */
        }
        set({ phase: "subscribed", permission, error: null });
        return;
      }
      set({ phase: "idle", permission, error: null });
    } catch {
      // SW registration/lookup failed — offer subscribe(), which retries and
      // surfaces a real sentence if it fails again.
      set({ phase: "idle", permission, error: null });
    }
  }

  async function subscribe(): Promise<void> {
    if (state.phase !== "idle") return;
    set({ phase: "subscribing", error: null });

    let permission = env.getPermission();
    if (permission !== "granted") {
      permission = await env.requestPermission();
    }
    if (permission === "denied") {
      set({ phase: "denied", permission });
      return;
    }
    if (permission !== "granted") {
      // Prompt dismissed — a quiet non-event, not an error (G10).
      set({ phase: "idle", permission });
      return;
    }

    try {
      const manager = await env.getPushManager();
      // An existing browser subscription (e.g. server row lost, or a previous
      // half-finished attempt) is reused — POST is an upsert.
      let subscription = await manager.getSubscription();
      if (!subscription) {
        const key = await env.fetchVapidPublicKey();
        subscription = await manager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToApplicationServerKey(key),
        });
      }
      await env.saveSubscription(subscriptionToKeys(subscription));
      set({ phase: "subscribed", permission, error: null });
    } catch (cause) {
      set({
        phase: "idle",
        permission,
        error: errorSentence(cause, t("misc.pushTurnOnFailed")),
      });
    }
  }

  async function unsubscribe(): Promise<void> {
    if (state.phase !== "subscribed") return;
    set({ phase: "unsubscribing", error: null });
    try {
      const manager = await env.getPushManager();
      const subscription = await manager.getSubscription();
      if (subscription) {
        // Learn the server row id via the (user_id, endpoint) upsert, delete
        // the row, then drop the browser subscription. If the browser step
        // ever failed after the server delete, no row exists to push to —
        // notifications still stop, which is what the user asked for.
        const { id } = await env.saveSubscription(
          subscriptionToKeys(subscription),
        );
        await env.deleteSubscription(id);
        await subscription.unsubscribe();
      }
      set({ phase: "idle", error: null });
    } catch (cause) {
      set({
        phase: "subscribed",
        error: errorSentence(cause, t("misc.pushTurnOffFailed")),
      });
    }
  }

  return { snapshot: () => state, init, subscribe, unsubscribe };
}
