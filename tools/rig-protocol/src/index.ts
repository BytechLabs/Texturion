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

export const HEADER = {
  callerClass: "x-rig-caller",
  /** Run-lease id. The guard refuses a dial, transfer or bridge without a live one. */
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
  /** POST: the edge registers a call control id it has relayed. */
  legs: "/legs",
  /** POST: the edge asks the guard to reject a stranger's call. */
  reject: "/reject",
  /** GET: the live partition: owned numbers, nonprod profile and connection ids. */
  partition: "/partition",
  /** POST acquires, DELETE /lease/<id> releases. */
  lease: "/lease",
  health: "/health",
  version: "/version",
} as const;

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
      /** call: answered synchronously. message/robot-webhook: queued, acked by the rig. */
      kind: "call" | "message" | "robot-call" | "robot-webhook";
      path: string;
      /** Only the headers the rig's handlers verify: the Telnyx signature pair and content-type. */
      headers: Record<string, string>;
      body: string;
      /** Delivery attempt, from 1. Queued kinds are retried for up to 24 hours. */
      attempt: number;
    }
  | { t: "media"; id: string; path: string }
  | { t: "mail"; id: string; to: string; from: string; subject: string; raw: string }
  | { t: "rpc"; id: string; method: string; params: unknown }
  | { t: "ping"; at: string };

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
  | { t: "heartbeat"; component: HeartbeatComponent; at: string };

/** The dead-man's three heartbeats (section 3.10). */
export const HEARTBEAT_COMPONENTS = ["rig", "suite", "triage"] as const;
export type HeartbeatComponent = (typeof HEARTBEAT_COMPONENTS)[number];

/** A call event must be answered inside the app's 10-second webhook timeout. */
export const CALL_EVENT_RELAY_TIMEOUT_MS = 9_000;
export const QUEUED_DELIVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
