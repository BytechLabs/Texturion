import { EDGE_PATHS, type LegRegistration, type Partition } from "@loonext/rig-protocol";

/**
 * The account has one signing key, shared with production, so a valid
 * signature says an event is Telnyx's and nothing about whose. Ownership is
 * decided by resource instead: a call event by its connection, a message
 * event by its messaging profile, both against the guard's live partition.
 */

/** How far `telnyx-timestamp` may be from now, here and in the rig's API alike. */
export const TELNYX_SIGNATURE_WINDOW_S = 5 * 60;

function decodeBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const importedKeys = new Map<string, CryptoKey>();

async function importPublicKey(base64Key: string): Promise<CryptoKey | null> {
  const cached = importedKeys.get(base64Key);
  if (cached) return cached;
  const raw = decodeBase64(base64Key);
  if (!raw || raw.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    importedKeys.set(base64Key, key);
    return key;
  } catch {
    return null;
  }
}

/**
 * The same check as apps/api/src/telnyx/verify.ts: Ed25519 over
 * `"{timestamp}|{raw_body}"`, the signature from `telnyx-signature-ed25519`,
 * unix seconds from `telnyx-timestamp`, at most 5 minutes off either way.
 */
export async function verifyTelnyxSignature(
  publicKey: string | undefined,
  headers: Headers,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const signatureHeader = headers.get("telnyx-signature-ed25519");
  const timestampHeader = headers.get("telnyx-timestamp");
  if (!publicKey || !signatureHeader || !timestampHeader) return false;
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;
  const skew = Math.abs(Math.floor(nowMs / 1000) - Number(timestampHeader));
  if (skew > TELNYX_SIGNATURE_WINDOW_S) return false;

  const signature = decodeBase64(signatureHeader);
  if (!signature || signature.length === 0) return false;
  const key = await importPublicKey(publicKey);
  if (!key) return false;

  try {
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      new TextEncoder().encode(`${timestampHeader}|${rawBody}`),
    );
  } catch {
    return false;
  }
}

/** The headers the rig's own handlers verify, and nothing else. */
export function relayedTelnyxHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["telnyx-signature-ed25519", "telnyx-timestamp", "content-type"]) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

type ConnectionRole = keyof Partition["connection_ids"];

interface CallPath {
  via: LegRegistration["via"];
  kind: "call" | "robot-call";
  /** The connections whose call events this path may carry. */
  connections: ConnectionRole[];
  /**
   * Whether a caller that is a SIP address rather than a number passes. Only
   * the WebRTC connection's own credentials place calls through it, and G02
   * must see what the SDK path really does, so the edge must not mask it.
   */
  sipCallers: boolean;
}

interface WebhookPath {
  /** Null where no Call Control app or connection posts. */
  calls: CallPath | null;
  /** Whether messaging profiles post here. */
  messages: boolean;
}

const VOICE: CallPath = { via: "voice", kind: "call", connections: ["voice"], sipCallers: false };

export const TELNYX_WEBHOOK_PATHS: Record<string, WebhookPath> = {
  [EDGE_PATHS.telnyxVoice]: { calls: VOICE, messages: false },
  [EDGE_PATHS.telnyxVoiceFailover]: { calls: VOICE, messages: false },
  [EDGE_PATHS.telnyxWebrtc]: {
    calls: { via: "webrtc", kind: "call", connections: ["webrtc", "sentinel"], sipCallers: true },
    messages: false,
  },
  [EDGE_PATHS.telnyxMessaging]: { calls: null, messages: true },
  [EDGE_PATHS.telnyxRobot]: {
    calls: { via: "robot", kind: "robot-call", connections: ["robot"], sipCallers: false },
    messages: true,
  },
};

export interface TelnyxEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

/** The envelope's id, type and payload, or null when any is unusable. */
export function parseEvent(rawBody: string): TelnyxEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const data = (parsed as { data?: unknown } | null)?.data as
    | { id?: unknown; event_type?: unknown; payload?: unknown }
    | undefined;
  if (!data || typeof data.id !== "string" || !data.id) return null;
  if (typeof data.event_type !== "string" || !data.event_type) return null;
  const payload =
    data.payload !== null && typeof data.payload === "object" && !Array.isArray(data.payload)
      ? (data.payload as Record<string, unknown>)
      : {};
  return { id: data.id, type: data.event_type, payload };
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** `sip:+1...@host;x=y` and `tel:+1...` to their address part. */
function addressOf(value: string): string {
  return value.trim().replace(/^(?:sips?|tel):/i, "").split(/[@;]/)[0];
}

function stringField(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === "string" && value ? value : null;
}

/** The numbers the partition owns, from both lists the guard returns. */
export function ownedNumbers(partition: Partition): Set<string> {
  return new Set([...partition.owned_e164, ...partition.standing_e164]);
}

export type Verdict =
  | { action: "drop"; reason: "not_owned" | "unknown_type" }
  | {
      action: "stranger-call";
      /** Whether this is the event that opens the stranger's leg. */
      opens: boolean;
      /** The leg the guard rejects, on the opening event when the guard can take it. */
      reject: LegRegistration | null;
      ours: string | null;
      theirs: string;
    }
  | { action: "stranger-text"; ours: string | null; theirs: string }
  | { action: "relay-call"; leg: LegRegistration | null; kind: "call" | "robot-call" }
  | { action: "queue-message" };

/**
 * Who is calling, for the call events that carry a caller: the same reading as
 * apps/api/src/environments/inbound.ts. Legs we dialled have no caller to
 * judge; an event without a direction is judged only when it states one.
 */
function callerOf(payload: Record<string, unknown>): string | null | undefined {
  if (payload.direction === "outgoing") return undefined;
  const from = stringField(payload, "from");
  if (payload.direction !== "incoming" && from === null) return undefined;
  return from;
}

function callVerdict(
  path: CallPath | null,
  event: TelnyxEvent,
  partition: Partition,
  owned: Set<string>,
): Verdict {
  const connectionId = stringField(event.payload, "connection_id");
  if (!path || !connectionId) return { action: "drop", reason: "not_owned" };
  const role = path.connections.find((r) => partition.connection_ids[r] === connectionId);
  if (!role) return { action: "drop", reason: "not_owned" };
  const ccid = stringField(event.payload, "call_control_id");
  // The sentinel's legs are relayed so G02 sees a ring, but never registered:
  // LegRegistration has no `via` for them, and a credential that must never
  // ring has no leg for anyone to command.
  const leg: LegRegistration | null =
    ccid && role !== "sentinel" ? { call_control_id: ccid, connection_id: connectionId, via: path.via } : null;

  const caller = callerOf(event.payload);
  if (caller !== undefined) {
    const address = caller === null ? "" : addressOf(caller);
    const isNumber = E164.test(address);
    const passes = isNumber ? owned.has(address) : path.sipCallers && address !== "";
    if (!passes) {
      const to = stringField(event.payload, "to");
      const opens = event.type === "call.initiated";
      return {
        action: "stranger-call",
        opens,
        reject: opens ? leg : null,
        ours: to && E164.test(addressOf(to)) ? addressOf(to) : null,
        theirs: address || "withheld",
      };
    }
  }
  return { action: "relay-call", leg, kind: path.kind };
}

function messageVerdict(
  path: WebhookPath,
  event: TelnyxEvent,
  partition: Partition,
  owned: Set<string>,
): Verdict {
  const profile = stringField(event.payload, "messaging_profile_id");
  if (!path.messages || !profile || !partition.messaging_profile_ids.includes(profile)) {
    return { action: "drop", reason: "not_owned" };
  }
  if (event.type === "message.received") {
    const from = (event.payload.from as { phone_number?: unknown } | undefined)?.phone_number;
    const to = (event.payload.to as { phone_number?: unknown }[] | undefined)?.[0]?.phone_number;
    const theirs = typeof from === "string" ? from : "";
    if (!owned.has(theirs)) {
      return {
        action: "stranger-text",
        ours: typeof to === "string" && owned.has(to) ? to : null,
        theirs: theirs || "withheld",
      };
    }
  }
  return { action: "queue-message" };
}

/** What the edge does with a verified event that arrived on `path`. */
export function judge(pathname: string, event: TelnyxEvent, partition: Partition): Verdict {
  const path = TELNYX_WEBHOOK_PATHS[pathname];
  if (!path) return { action: "drop", reason: "not_owned" };
  const owned = ownedNumbers(partition);
  if (event.type.startsWith("call.")) return callVerdict(path.calls, event, partition, owned);
  if (event.type.startsWith("message.")) return messageVerdict(path, event, partition, owned);
  return { action: "drop", reason: "unknown_type" };
}
