/**
 * The wire contract between the rig's three cloud-facing pieces (D142,
 * docs/RIG.md sections 3.3-3.5): the edge (`loonext-rig-edge`, workers.dev),
 * the guard (`loonext-telnyx-guard`, service binding only) and the rig box
 * (`rigd`, the local API, the robot). Each piece imports these names instead
 * of spelling them, so a renamed path breaks the build rather than a call.
 *
 * Nothing here is a secret or an id. Tokens, account ids and phone numbers
 * live in Worker secrets and the rig's secret store.
 */

/**
 * Who is calling the guard. The edge derives the class from the bearer token
 * and is the only writer of {@link HEADER.callerClass}: it strips any copy a
 * caller sends. The guard trusts the header because the service binding is
 * its only way in.
 */
export const CALLER_CLASSES = ["rig-api", "robot", "diag", "admin"] as const;
export type CallerClass = (typeof CALLER_CLASSES)[number];

/** Bearer-token classes for the edge's own control paths (`/ctl/*`). */
export const CONTROL_CLASSES = ["rig", "triage"] as const;
export type ControlClass = (typeof CONTROL_CLASSES)[number];

/**
 * The {@link HEADER.callerClass} value on the edge's own guard calls. Not a
 * token class, and distinct from every {@link CallerClass}: a `rig-api` caller
 * that could POST /legs could register a production call's id and then
 * command it. The edge overwrites the header on every forward, so only the
 * edge can send this value.
 */
export const EDGE_CALLER = "edge";
export type EdgeCaller = typeof EDGE_CALLER;

export const HEADER = {
  callerClass: "x-rig-caller",
  /**
   * Run-lease id. A dial, transfer or bridge needs a live lease: test code
   * names it here, and a `rig-api` request without the header runs under the
   * one live lease. A header naming any other lease is refused.
   */
  lease: "x-rig-lease",
  scenario: "x-rig-scenario",
  /** Set by the guard on every refusal, so a caller can tell a policy 403 from Telnyx's. */
  refusedBy: "x-rig-refused-by",
} as const;

/** Paths the internet can reach on the edge. Everything else is an empty 404. */
export const EDGE_PATHS = {
  telnyxVoice: "/t/v",
  telnyxVoiceFailover: "/t/v2",
  telnyxWebrtc: "/t/w",
  telnyxMessaging: "/t/m",
  telnyxRobot: "/t/r",
  /** Followed by a secret segment: account notifications may be unsigned. */
  telnyxNotificationsPrefix: "/t/n/",
  /** Telnyx fetches of MMS and greeting media, relayed to the rig's storage. */
  mediaPrefix: "/m/",
  /**
   * Customer webhooks from the rig's API, delivered to the robot's sink. The
   * next segment is a secret. `RIG_ROBOT_WEBHOOK_ORIGIN` is the edge's origin,
   * because the app refuses `*.internal` webhook hosts.
   */
  robotWebhookPrefix: "/w/",
  /** Authenticated callers forwarded to the guard; the edge strips `/g`. */
  guardPrefix: "/g",
  ctlUplink: "/ctl/uplink",
  ctlRpc: "/ctl/rpc",
  ctlSecrets: "/ctl/secrets",
} as const;

/** Media buckets the edge will relay, and the most it relays per fetch. */
export const MEDIA_BUCKETS = ["mms-media", "voicemail-greetings"] as const;
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Routes on the guard, as the edge forwards them (the `/g` prefix removed).
 * The rig's seams point under these:
 *   TELNYX_API_BASE      = <edge>/g/telnyx        (the app appends /v2/...)
 *   RESEND_API_BASE      = <edge>/g/resend        (the app appends /emails)
 *   FCM_API_BASE         = <edge>/g/fcm           (the app appends /v1/projects/...)
 *   FCM_OAUTH_TOKEN_URL  = <edge>/g/fcm-token     (never contacted in rig mode)
 */
export const GUARD_ROUTES = {
  telnyx: "/telnyx",
  resend: "/resend",
  fcm: "/fcm",
  fcmToken: "/fcm-token",
  /** POST /ai/run/<model>: the rig's AI shim. */
  ai: "/ai",
  /** GET-only production reads for workstation agents, redacted. */
  diag: "/diag",
  /** The setup routine and number lifecycle. `admin` callers only. */
  admin: "/admin",
  /** POST {@link LegRegistration}: the edge registers a call control id it has relayed. */
  legs: "/legs",
  /** POST {@link LegRegistration}: the edge asks the guard to reject a stranger's call, which is never registered. */
  reject: "/reject",
  /** POST {@link DetachRequest}: strangers flooded an owned number. */
  detach: "/detach",
  /** POST {@link HaltRequest}: a corroborated account signal. */
  halt: "/halt",
  /** GET {@link Partition}: owned numbers, nonprod profile and connection ids, standing roles. */
  partition: "/partition",
  /** POST acquires, DELETE /lease/<id> releases. */
  lease: "/lease",
  /** GET {@link GuardHealth}. */
  health: "/health",
  version: "/version",
} as const;

/**
 * Routes only {@link EDGE_CALLER} may call. The edge refuses a forwarded
 * request for any of them, in every spelling a router might fold together,
 * and the guard admits nobody else on them.
 */
export const EDGE_ONLY_ROUTES = [GUARD_ROUTES.legs, GUARD_ROUTES.reject, GUARD_ROUTES.detach, GUARD_ROUTES.halt] as const;

/**
 * The edge's named entrypoint, which the guard binds as `EDGE`
 * (tools/guard/wrangler.jsonc). Reachable only over a service binding.
 */
export const EDGE_GUARD_ENTRYPOINT = "EdgeForGuard";

/** What {@link EDGE_GUARD_ENTRYPOINT} answers over the binding. */
export interface EdgeForGuardMethods {
  /** The robot mailbox's heartbeat, read before the guard sends to it (S34). */
  mailStatus(): Promise<MailStatus>;
}

export interface MailStatus {
  /** The mailbox's last proven write: a stored mail or the cron's self-test. */
  heartbeat_at: string | null;
  last_received_at: string | null;
  received: number;
  stored: number;
  /** Mail that arrived while storage was failing, counted on the uplink. */
  store_failed: number;
  /** The newest mail by `+tag`, so a sender can confirm one specific arrival. */
  recent: { tag: string | null; received_at: string }[];
}

export const LEASE_MAX_MS = 15 * 60 * 1000;
export const LEG_REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;
export const PARTITION_CACHE_MS = 5 * 60 * 1000;

/** The JSON body of every guard refusal. Status is 403, or 429 for a spent budget. */
export interface GuardRefusal {
  error: "guard_refused";
  /** A stable rule name, for example `dial.to_not_owned` or `class.not_allowed`. */
  rule: string;
}

export interface LegRegistration {
  call_control_id: string;
  connection_id: string;
  /** Which edge path the event that carried it arrived on. */
  via: "voice" | "webrtc" | "robot";
}

export interface LeaseGrant {
  lease_id: string;
  scenario: string;
  expires_at: string;
}

export interface Partition {
  billing_group_id: string;
  /** E.164 numbers in the nonprod billing group, from the live listing. */
  owned_e164: string[];
  standing_e164: string[];
  connection_ids: { voice: string; robot: string; webrtc: string; sentinel: string };
  messaging_profile_ids: string[];
  fetched_at: string;
  /** The standing numbers by role, in {@link STANDING_ROLES} order. The guard always sends it. */
  standing?: StandingEntry[];
}

/** The numbers the rig keeps for good; every other owned number is short-lived. */
export const STANDING_ROLES = [
  "ROBOT-1",
  "ROBOT-2",
  "STRANGER-1",
  "DEV-W1",
  "DEV-W2",
  "DEV-A1",
  "DEV-C1",
  "DEV-E1",
] as const;
export type StandingRole = (typeof STANDING_ROLES)[number];

export interface StandingEntry {
  role: StandingRole;
  e164: string;
  telnyx_phone_number_id: string;
  messaging_profile_id: string | null;
}

/** The body of {@link GUARD_ROUTES.detach}. */
export interface DetachRequest {
  e164: string;
  /** Stranger calls and texts to it inside the window. */
  strangers: number;
  window_ms: number;
}

/**
 * How the edge corroborated an account notice before asking for a halt:
 *   - `balance`: a balance notice, and the balance read through the guard agrees;
 *   - `signature`: Telnyx signed the notice within five minutes, and it names
 *     a notification type enabled on the account;
 *   - `account_refused`: Telnyx refuses the account's own reads.
 */
export const HALT_CORROBORATIONS = ["balance", "signature", "account_refused"] as const;
export type HaltCorroboration = (typeof HALT_CORROBORATIONS)[number];

/** The body of {@link GUARD_ROUTES.halt}. */
export interface HaltRequest {
  signal: string;
  notice_id: string | null;
  corroborated_by: HaltCorroboration;
  received_at: string;
}

/**
 * The guard's start-up checks as /health reports them. `unchecked` means they
 * have not run on this deployment: no Telnyx key, or the run itself failed.
 */
export type GuardSafety =
  | {
      state: "ok" | "unsafe" | "unconfigured";
      /** Stable reason codes; counts and names, never ids or numbers. */
      reasons: string[];
      /** Epoch ms. */
      checked_at: number;
    }
  | { state: "unchecked"; reasons: string[] };

/**
 * GET {@link GUARD_ROUTES.health}, for every caller class but the edge. The
 * fields typed here are the ones other pieces read; the rest is the guard's
 * own detail (money, lease, signals, mail, vendors) for whoever reads it.
 */
export interface GuardHealth {
  /** The Telnyx key is present and the start-up checks passed on this deployment. */
  ok: boolean;
  balance_above_floor: boolean;
  /** Test legs the account's limit leaves after production's reserve; absent while either is unknown. */
  room?: number;
  version_id: string;
  telnyx: { key: "present" | "absent"; rule?: string; safety: GuardSafety };
  paid_dials: {
    enabled: boolean;
    /** Refusal rules that would stop a paid dial now. */
    blockers: string[];
    room: number | null;
    /** The dial window's first UTC hour: the measured one while fresh, else the default. */
    window_start_hour_utc: number;
    /** When the window in force was measured, or null when the default applies. */
    window_measured_at: string | null;
    in_window: boolean;
  };
  [detail: string]: unknown;
}

/**
 * Frames on the rig's uplink, one JSON object per WebSocket message. The edge's
 * Durable Object holds the socket (hibernating); `rigd` dials out to it, so
 * nothing on the rig listens on the internet.
 */
export type EdgeToRig =
  | {
      t: "webhook";
      id: string;
      /**
       * `call` and `robot-call`: answered synchronously with a `webhook-result`
       * inside {@link CALL_EVENT_RELAY_TIMEOUT_MS}. `message` and
       * `robot-webhook`: queued at the edge, and acked by the rig once taken.
       */
      kind: WebhookKind;
      /**
       * The edge path the event arrived on (`/t/v`, `/t/r`, ...). For
       * `robot-webhook`, `/w/<rest>` with the secret segment removed, query
       * string included.
       */
      path: string;
      /**
       * The headers the rig's handlers verify, and nothing else: the Telnyx
       * signature pair and content-type, or for `robot-webhook` content-type
       * and the app's `loonext-*` headers.
       */
      headers: Record<string, string>;
      body: string;
      /**
       * Delivery attempt, from 1; a call event is always 1. A text carries
       * Telnyx's signature, which the rig's API accepts for
       * {@link TELNYX_SIGNATURE_WINDOW_S}, so it is retried only while that
       * holds, offered once more, then dropped. Robot webhooks and mail are
       * retried for up to {@link QUEUED_DELIVERY_MAX_AGE_MS}.
       */
      attempt: number;
    }
  | {
      t: "media";
      id: string;
      /**
       * Relative to `<storage>/storage/v1`, query string included:
       * `/object/sign/<bucket>/<path>?token=<jwt>`, the bucket one of
       * {@link MEDIA_BUCKETS}.
       */
      path: string;
    }
  | { t: "mail"; id: string; to: string; from: string; subject: string; raw: string }
  | {
      t: "rpc";
      id: string;
      method: string;
      params: unknown;
      /** The control class the edge admitted the caller as; rigd holds each method to the classes it names. */
      caller: ControlClass;
    }
  | { t: "ping"; at: string };

export const WEBHOOK_KINDS = ["call", "message", "robot-call", "robot-webhook"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export type RigToEdge =
  | { t: "webhook-result"; id: string; status: number; body?: string }
  | { t: "ack"; id: string }
  | {
      t: "media-result";
      id: string;
      status: number;
      content_type?: string;
      /** Base64; at most {@link MEDIA_MAX_BYTES} decoded. */
      body_b64?: string;
    }
  | { t: "rpc-result"; id: string; ok: true; result: unknown }
  | { t: "rpc-result"; id: string; ok: false; error: string }
  | {
      t: "heartbeat";
      component: HeartbeatComponent;
      /** When the component last did its work, not when the beat was sent; the edge never counts it later than arrival. */
      at: string;
    };

/** The dead-man's three heartbeats (section 3.10). */
export const HEARTBEAT_COMPONENTS = ["rig", "suite", "triage"] as const;
export type HeartbeatComponent = (typeof HEARTBEAT_COMPONENTS)[number];

/** A call event must be answered inside the app's 10-second webhook timeout. */
export const CALL_EVENT_RELAY_TIMEOUT_MS = 9_000;
export const QUEUED_DELIVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How far `telnyx-timestamp` may be from now, at the edge and in the rig's
 * API. Keep equal to TIMESTAMP_TOLERANCE_SECONDS in apps/api/src/telnyx/verify.ts.
 */
export const TELNYX_SIGNATURE_WINDOW_S = 5 * 60;
