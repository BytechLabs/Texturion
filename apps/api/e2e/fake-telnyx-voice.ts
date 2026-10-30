/**
 * The call half of the fake Telnyx: legs, the commands that move them, the
 * webhooks those commands cause, and the telephony credentials a softphone
 * logs in with.
 *
 * Telnyx answers a command with a 200 and tells you what happened later, by
 * webhook. So does this: every command that changes a leg appends the events
 * Telnyx would send to an outbox, which the harness delivers oldest first.
 * Nothing here calls the Worker.
 *
 * The far end (a customer's phone, a member's softphone) is driven by the
 * journey through `answer` / `hangup` / `ringOut` / `decline` /
 * `leaveMessage`, because on a real call those are people, not commands.
 *
 * Bridged legs follow the bridge command's documented default
 * (`park_after_unbridge` unset): when one side hangs up or is transferred
 * away, the other side is hung up too. A pending transfer target is cancelled
 * when the leg it was transferring dies. Both are modelled from the API
 * reference, not observed; the rig's S07 and S08 are where they meet the
 * real switch.
 *
 * The ledger exists for docs/RIG.md's dial budget: Telnyx limits count dials,
 * and ring legs, ring-me legs and transfer legs are all dials.
 */
import { randomUUID } from "node:crypto";

/** One request as the fake server saw it (structurally `TelnyxCall`). */
export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  raw: string;
}

export interface FakeResponse {
  status?: number;
  /** JSON body; `null` with no `text`/`bytes` means an empty response. */
  body?: unknown;
  /** Plain-text body (the credential token endpoint answers in text). */
  text?: string;
  /** Binary body (recording media). */
  bytes?: Uint8Array;
  contentType?: string;
}

export interface FakeHandler {
  method: string;
  pattern: RegExp;
  respond: (request: FakeRequest, match: RegExpMatchArray) => FakeResponse;
}

export type LegOrigin = "far-end" | "dial" | "transfer";
export type LegState = "ringing" | "answered" | "ended";

export interface FakeLeg {
  callControlId: string;
  callLegId: string;
  callSessionId: string;
  connectionId: string;
  direction: "incoming" | "outgoing";
  /** Who created the leg: a far end calling in, our dial, or our transfer. */
  origin: LegOrigin;
  from: string;
  to: string;
  clientState: string | null;
  customHeaders: { name: string; value: string }[];
  state: LegState;
  bridgedWith: string | null;
  /** Set on a bridge's issuing leg when it asked to be parked, not hung up. */
  parkAfterUnbridge: boolean;
  /** For a transfer target: the leg it bridges onto when it answers. */
  transferOf: string | null;
  hangupCause: string | null;
  startedAtMs: number;
  answeredAtMs: number | null;
  endedAtMs: number | null;
  recording: { id: string; startedAtMs: number } | null;
  /** Seconds the far end speaks into a recording before hanging up. */
  messageSeconds: number;
  /** The fake credential a `sip:` destination names, when it is one. */
  credentialId: string | null;
  commandIds: Set<string>;
}

export interface FakeCredential {
  id: string;
  sipUsername: string;
  connectionId: string;
  name: string | null;
  tag: string | null;
  tokensIssued: number;
}

export interface FakeRecording {
  id: string;
  callSessionId: string;
  callLegId: string;
  deleted: boolean;
}

/** The numbers the rig's dial budget is computed from, for one journey. */
export interface CallLedger {
  /** Legs Loonext created: POST /v2/calls plus transfer targets. */
  dials: number;
  /** Legs a far end created. On the rig every one is a robot dial. */
  farEndLegs: number;
  /** Most legs alive at once, whoever made them. */
  peakConcurrentLegs: number;
  /** Most Loonext-created legs alive at once. */
  peakConcurrentOutboundLegs: number;
}

export interface TelnyxWebhookEvent {
  data: {
    record_type: "event";
    id: string;
    event_type: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  };
  meta: { attempt: number; delivered_to: string };
}

export interface FakeVoice {
  /** Every leg this fake has seen since the last reset, oldest first. */
  legs(): FakeLeg[];
  leg(callControlId: string): FakeLeg | undefined;
  live(): FakeLeg[];
  /** A far end dials one of our numbers. */
  incoming(input: {
    from: string;
    to: string;
    connectionId?: string;
    callerIdName?: string;
  }): FakeLeg;
  /** The far end of an outgoing leg picks up. */
  answer(callControlId: string): void;
  /** The far end hangs up. */
  hangup(callControlId: string, cause?: string): void;
  /** Nobody picked up before the leg's own timeout. */
  ringOut(callControlId: string): void;
  /** The far end pressed decline. */
  decline(callControlId: string): void;
  /** The far end talks for this long into a recording, then hangs up. */
  leaveMessage(callControlId: string, seconds: number): void;
  takeEvent(): TelnyxWebhookEvent | undefined;
  pendingEvents(): number;
  ledger(): CallLedger;
  credentials(): FakeCredential[];
  credentialForSipUsername(sipUsername: string): FakeCredential | undefined;
  recordings(): FakeRecording[];
  /** Forget legs, events, recordings and the ledger; keep credentials. */
  resetCalls(): void;
}

export interface VoiceModel {
  voice: FakeVoice;
  handlers: FakeHandler[];
  setOrigin(origin: string): void;
}

const SIP_DOMAIN = "sip.telnyx.com";
const DEFAULT_INBOUND_CONNECTION = "fake-inbound-connection";

/** A few bytes that start like an MP3 (ID3 tag), enough for a store-and-forward. */
const RECORDING_BYTES = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb,
  0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function telnyxError(
  status: number,
  title: string,
  code?: string,
): FakeResponse {
  return {
    status,
    body: { errors: [{ ...(code ? { code } : {}), title, detail: title }] },
  };
}

const NOT_FOUND = () => telnyxError(404, "Resource not found", "10005");
const ALREADY_ENDED = () => telnyxError(422, "Call has already ended", "90018");

function sipUsernameOf(destination: string): string | null {
  const match = /^sip:([^@]+)@([^:;]+)/i.exec(destination.trim());
  if (!match || match[2].toLowerCase() !== SIP_DOMAIN) return null;
  return match[1];
}

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

function asHeaders(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (header): header is { name: string; value: string } =>
        header !== null &&
        typeof header === "object" &&
        typeof (header as { name?: unknown }).name === "string" &&
        typeof (header as { value?: unknown }).value === "string",
    )
    .map((header) => ({ name: header.name, value: header.value }));
}

/** A JWT-shaped token. Never verified by anything; the SDK is not in the loop. */
function credentialToken(sipUsername: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSec = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({ iss: "fake-telnyx", sub: sipUsername, iat: nowSec, exp: nowSec + 86_400 }),
    Buffer.from("unsigned").toString("base64url"),
  ].join(".");
}

export function createVoiceModel(): VoiceModel {
  let origin = "http://127.0.0.1";
  const legs = new Map<string, FakeLeg>();
  const outbox: TelnyxWebhookEvent[] = [];
  const credentials = new Map<string, FakeCredential>();
  const recordings = new Map<string, FakeRecording>();
  const dialsByCommandId = new Map<string, string>();
  let ledger: CallLedger = emptyLedger();
  let credentialSeq = 0;

  function emptyLedger(): CallLedger {
    return {
      dials: 0,
      farEndLegs: 0,
      peakConcurrentLegs: 0,
      peakConcurrentOutboundLegs: 0,
    };
  }

  function liveLegs(): FakeLeg[] {
    return [...legs.values()].filter((leg) => leg.state !== "ended");
  }

  function notePeaks(): void {
    const live = liveLegs();
    const outbound = live.filter((leg) => leg.origin !== "far-end").length;
    ledger.peakConcurrentLegs = Math.max(ledger.peakConcurrentLegs, live.length);
    ledger.peakConcurrentOutboundLegs = Math.max(
      ledger.peakConcurrentOutboundLegs,
      outbound,
    );
  }

  function basePayload(leg: FakeLeg): Record<string, unknown> {
    return {
      call_control_id: leg.callControlId,
      call_leg_id: leg.callLegId,
      call_session_id: leg.callSessionId,
      connection_id: leg.connectionId,
      direction: leg.direction,
      from: leg.from,
      to: leg.to,
      ...(leg.clientState !== null ? { client_state: leg.clientState } : {}),
    };
  }

  function emit(eventType: string, payload: Record<string, unknown>): void {
    outbox.push({
      data: {
        record_type: "event",
        id: randomUUID(),
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        payload,
      },
      meta: { attempt: 1, delivered_to: "fake-telnyx" },
    });
  }

  function createLeg(input: {
    origin: LegOrigin;
    direction: "incoming" | "outgoing";
    from: string;
    to: string;
    connectionId: string;
    clientState: string | null;
    customHeaders: { name: string; value: string }[];
    transferOf?: string | null;
  }): FakeLeg {
    const sipUsername = sipUsernameOf(input.to);
    const credential = sipUsername
      ? [...credentials.values()].find((c) => c.sipUsername === sipUsername)
      : undefined;
    const leg: FakeLeg = {
      callControlId: `v3:fake-${randomUUID()}`,
      callLegId: randomUUID(),
      callSessionId: randomUUID(),
      connectionId: input.connectionId,
      direction: input.direction,
      origin: input.origin,
      from: input.from,
      to: input.to,
      clientState: input.clientState,
      customHeaders: input.customHeaders,
      state: "ringing",
      bridgedWith: null,
      parkAfterUnbridge: false,
      transferOf: input.transferOf ?? null,
      hangupCause: null,
      startedAtMs: Date.now(),
      answeredAtMs: null,
      endedAtMs: null,
      recording: null,
      messageSeconds: 0,
      credentialId: credential?.id ?? null,
      commandIds: new Set(),
    };
    legs.set(leg.callControlId, leg);
    if (input.origin === "far-end") ledger.farEndLegs += 1;
    else ledger.dials += 1;
    notePeaks();
    emit("call.initiated", {
      ...basePayload(leg),
      state: input.direction === "incoming" ? "parked" : "bridging",
      start_time: new Date(leg.startedAtMs).toISOString(),
      ...(leg.customHeaders.length > 0
        ? { custom_headers: leg.customHeaders }
        : {}),
    });
    return leg;
  }

  /** Split a bridge; the partner is hung up unless it asked to be parked. */
  function unbridge(leg: FakeLeg): void {
    const partnerId = leg.bridgedWith;
    if (!partnerId) return;
    leg.bridgedWith = null;
    const partner = legs.get(partnerId);
    if (!partner || partner.bridgedWith !== leg.callControlId) return;
    partner.bridgedWith = null;
    if (partner.state !== "ended" && !partner.parkAfterUnbridge) {
      endLeg(partner, "normal_clearing", "unknown");
    }
  }

  function endLeg(leg: FakeLeg, cause: string, source: string): void {
    if (leg.state === "ended") return;
    leg.state = "ended";
    leg.hangupCause = cause;
    leg.endedAtMs = Date.now();
    emit("call.hangup", {
      ...basePayload(leg),
      hangup_cause: cause,
      hangup_source: source,
      sip_hangup_cause: sipCauseFor(cause),
      start_time: new Date(leg.startedAtMs).toISOString(),
      end_time: new Date(leg.endedAtMs).toISOString(),
    });
    if (leg.recording) saveRecording(leg);
    unbridge(leg);
    for (const pending of legs.values()) {
      if (pending.transferOf === leg.callControlId && pending.state === "ringing") {
        endLeg(pending, "originator_cancel", "caller");
      }
    }
  }

  function sipCauseFor(cause: string): string {
    switch (cause) {
      case "timeout":
        return "480";
      case "call_rejected":
        return "603";
      case "user_busy":
        return "486";
      case "originator_cancel":
        return "487";
      default:
        return "200";
    }
  }

  function saveRecording(leg: FakeLeg): void {
    const recording = leg.recording;
    if (!recording) return;
    leg.recording = null;
    recordings.set(recording.id, {
      id: recording.id,
      callSessionId: leg.callSessionId,
      callLegId: leg.callLegId,
      deleted: false,
    });
    const startedAt = new Date(recording.startedAtMs);
    const endedAt = new Date(recording.startedAtMs + leg.messageSeconds * 1000);
    emit("call.recording.saved", {
      ...basePayload(leg),
      channels: "single",
      format: "mp3",
      recording_id: recording.id,
      recording_started_at: startedAt.toISOString(),
      recording_ended_at: endedAt.toISOString(),
      recording_urls: { mp3: `${origin}/media/recordings/${recording.id}.mp3` },
      public_recording_urls: {},
    });
  }

  function bridge(leg: FakeLeg, partner: FakeLeg): void {
    if (leg.bridgedWith === partner.callControlId) return;
    for (const side of [leg, partner]) {
      if (side.bridgedWith) unbridge(side);
    }
    if (leg.state === "ended" || partner.state === "ended") return;
    leg.bridgedWith = partner.callControlId;
    partner.bridgedWith = leg.callControlId;
    emit("call.bridged", basePayload(leg));
    emit("call.bridged", basePayload(partner));
  }

  function answerLeg(leg: FakeLeg, clientState?: string): void {
    if (clientState !== undefined) leg.clientState = clientState;
    leg.state = "answered";
    leg.answeredAtMs = Date.now();
    emit("call.answered", {
      ...basePayload(leg),
      start_time: new Date(leg.startedAtMs).toISOString(),
    });
  }

  function farEndLeg(callControlId: string): FakeLeg {
    const leg = legs.get(callControlId);
    if (!leg) throw new Error(`fake-telnyx: no leg ${callControlId}`);
    if (leg.state === "ended") {
      throw new Error(`fake-telnyx: leg ${callControlId} has already ended`);
    }
    return leg;
  }

  const voice: FakeVoice = {
    legs: () => [...legs.values()],
    leg: (id) => legs.get(id),
    live: liveLegs,
    incoming(input) {
      const leg = createLeg({
        origin: "far-end",
        direction: "incoming",
        from: input.from,
        to: input.to,
        connectionId: input.connectionId ?? DEFAULT_INBOUND_CONNECTION,
        clientState: null,
        customHeaders: [],
      });
      if (input.callerIdName) {
        // Telnyx carries the dipped name on the initiated event only.
        const initiated = outbox[outbox.length - 1];
        initiated.data.payload.caller_id_name = input.callerIdName;
      }
      return leg;
    },
    answer(callControlId) {
      const leg = farEndLeg(callControlId);
      if (leg.direction !== "outgoing") {
        throw new Error("fake-telnyx: an incoming leg is answered by a command, not its far end");
      }
      if (leg.state === "answered") return;
      answerLeg(leg);
      if (leg.transferOf) {
        const transferred = legs.get(leg.transferOf);
        if (transferred && transferred.state !== "ended") bridge(transferred, leg);
      }
    },
    hangup(callControlId, cause = "normal_clearing") {
      const leg = farEndLeg(callControlId);
      endLeg(leg, cause, leg.direction === "incoming" ? "caller" : "callee");
    },
    ringOut(callControlId) {
      const leg = farEndLeg(callControlId);
      if (leg.state !== "ringing") {
        throw new Error("fake-telnyx: only a ringing leg can ring out");
      }
      endLeg(leg, "timeout", "unknown");
    },
    decline(callControlId) {
      const leg = farEndLeg(callControlId);
      if (leg.state !== "ringing") {
        throw new Error("fake-telnyx: only a ringing leg can be declined");
      }
      endLeg(leg, "call_rejected", "callee");
    },
    leaveMessage(callControlId, seconds) {
      const leg = farEndLeg(callControlId);
      if (!leg.recording) {
        throw new Error("fake-telnyx: nothing is recording on this leg");
      }
      leg.messageSeconds = seconds;
      endLeg(leg, "normal_clearing", "caller");
    },
    takeEvent: () => outbox.shift(),
    pendingEvents: () => outbox.length,
    ledger: () => ({ ...ledger }),
    credentials: () => [...credentials.values()],
    credentialForSipUsername: (sipUsername) =>
      [...credentials.values()].find((c) => c.sipUsername === sipUsername),
    recordings: () => [...recordings.values()],
    resetCalls() {
      legs.clear();
      outbox.length = 0;
      recordings.clear();
      dialsByCommandId.clear();
      ledger = emptyLedger();
    },
  };

  /** The live leg a command names, or the error Telnyx gives instead. */
  function commandTarget(id: string): FakeLeg | FakeResponse {
    const leg = legs.get(id);
    if (!leg) return NOT_FOUND();
    if (leg.state === "ended") return ALREADY_ENDED();
    return leg;
  }

  function isLeg(value: FakeLeg | FakeResponse): value is FakeLeg {
    return "callControlId" in value;
  }

  const ok = (): FakeResponse => ({ body: { data: { result: "ok" } } });

  function runAction(
    leg: FakeLeg,
    action: string,
    body: Record<string, unknown>,
  ): FakeResponse {
    const clientState =
      typeof body.client_state === "string" ? body.client_state : undefined;
    switch (action) {
      case "answer": {
        if (leg.direction !== "incoming" || leg.state !== "ringing") {
          return telnyxError(422, "Call is not in a state that can be answered");
        }
        answerLeg(leg, clientState);
        return ok();
      }
      case "reject": {
        if (leg.direction !== "incoming" || leg.state !== "ringing") {
          return telnyxError(422, "Call is not in a state that can be rejected");
        }
        const cause =
          typeof body.cause === "string" ? body.cause.toLowerCase() : "call_rejected";
        endLeg(leg, cause, "callee");
        return ok();
      }
      case "hangup": {
        if (clientState !== undefined) leg.clientState = clientState;
        endLeg(
          leg,
          leg.state === "ringing" && leg.direction === "outgoing"
            ? "originator_cancel"
            : "normal_clearing",
          "caller",
        );
        return ok();
      }
      case "bridge": {
        const partnerId =
          typeof body.call_control_id === "string" ? body.call_control_id : "";
        const partner = commandTarget(partnerId);
        if (!isLeg(partner)) return partner;
        if (clientState !== undefined) leg.clientState = clientState;
        leg.parkAfterUnbridge = body.park_after_unbridge === "self";
        bridge(leg, partner);
        return ok();
      }
      case "transfer": {
        const to = typeof body.to === "string" ? body.to : "";
        if (!to) return telnyxError(422, "to is required", "10015");
        if (clientState !== undefined) leg.clientState = clientState;
        if (leg.bridgedWith) unbridge(leg);
        createLeg({
          origin: "transfer",
          direction: "outgoing",
          from: typeof body.from === "string" ? body.from : leg.to,
          to,
          connectionId: leg.connectionId,
          clientState:
            typeof body.target_leg_client_state === "string"
              ? body.target_leg_client_state
              : null,
          customHeaders: asHeaders(body.custom_headers),
          transferOf: leg.callControlId,
        });
        return ok();
      }
      case "speak":
      case "playback_start": {
        if (leg.state !== "answered") {
          return telnyxError(422, "Call must be answered first");
        }
        if (clientState !== undefined) leg.clientState = clientState;
        const family = action === "speak" ? "speak" : "playback";
        emit(`call.${family}.started`, basePayload(leg));
        emit(`call.${family}.ended`, {
          ...basePayload(leg),
          ...(family === "playback" ? { status: "completed" } : {}),
        });
        return ok();
      }
      case "record_start": {
        if (leg.state !== "answered") {
          return telnyxError(422, "Call must be answered first");
        }
        if (clientState !== undefined) leg.clientState = clientState;
        leg.recording = { id: randomUUID(), startedAtMs: Date.now() };
        return ok();
      }
      case "record_stop": {
        saveRecording(leg);
        return ok();
      }
      default:
        if (clientState !== undefined) leg.clientState = clientState;
        return ok();
    }
  }

  const handlers: FakeHandler[] = [
    {
      method: "POST",
      pattern: /^\/v2\/calls$/,
      respond: (request) => {
        const body = asRecord(request.body);
        const connectionId = body.connection_id;
        const to = body.to;
        const from = body.from;
        if (
          typeof connectionId !== "string" ||
          typeof to !== "string" ||
          typeof from !== "string" ||
          !connectionId ||
          !to ||
          !from
        ) {
          return telnyxError(422, "connection_id, to and from are required", "10015");
        }
        // A replayed command_id answers with the original leg instead of
        // ringing a second one; the runtime's journal-resume relies on it.
        const commandId =
          typeof body.command_id === "string" ? body.command_id : null;
        const replayOf = commandId ? dialsByCommandId.get(commandId) : undefined;
        const replayed = replayOf ? legs.get(replayOf) : undefined;
        const leg =
          replayed ??
          createLeg({
            origin: "dial",
            direction: "outgoing",
            from,
            to,
            connectionId,
            clientState:
              typeof body.client_state === "string" ? body.client_state : null,
            customHeaders: asHeaders(body.custom_headers),
          });
        if (commandId) dialsByCommandId.set(commandId, leg.callControlId);
        return {
          status: replayed ? 202 : 200,
          body: {
            data: {
              call_control_id: leg.callControlId,
              call_leg_id: leg.callLegId,
              call_session_id: leg.callSessionId,
              is_alive: leg.state !== "ended",
              record_type: "call",
            },
          },
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/calls\/([^/]+)$/,
      respond: (_request, match) => {
        const leg = legs.get(decodeURIComponent(match[1]));
        if (!leg) return NOT_FOUND();
        return {
          body: {
            data: {
              call_control_id: leg.callControlId,
              call_leg_id: leg.callLegId,
              call_session_id: leg.callSessionId,
              is_alive: leg.state !== "ended",
              record_type: "call",
            },
          },
        };
      },
    },
    {
      method: "POST",
      pattern: /^\/v2\/calls\/([^/]+)\/actions\/([a-z_]+)$/,
      respond: (request, match) => {
        const target = commandTarget(decodeURIComponent(match[1]));
        if (!isLeg(target)) return target;
        const body = asRecord(request.body);
        const commandId =
          typeof body.command_id === "string" ? body.command_id : null;
        if (commandId) {
          if (target.commandIds.has(commandId)) return ok();
          target.commandIds.add(commandId);
        }
        return runAction(target, match[2], body);
      },
    },

    {
      method: "GET",
      pattern: /^\/v2\/recordings$/,
      respond: (request) => {
        const session = request.query.get("filter[call_session_id]");
        const data = [...recordings.values()]
          .filter((r) => !r.deleted && (!session || r.callSessionId === session))
          .map((r) => ({
            id: r.id,
            call_session_id: r.callSessionId,
            call_leg_id: r.callLegId,
            record_type: "recording",
          }));
        return { body: { data, meta: { total_pages: 1 } } };
      },
    },
    {
      method: "DELETE",
      pattern: /^\/v2\/recordings\/([^/]+)$/,
      respond: (_request, match) => {
        const recording = recordings.get(match[1]);
        if (!recording || recording.deleted) return NOT_FOUND();
        recording.deleted = true;
        return { body: { data: { id: recording.id, record_type: "recording" } } };
      },
    },
    {
      // The presigned media URL a recording.saved event carries. Not under
      // /v2: it is storage, fetched without the API key.
      method: "GET",
      pattern: /^\/media\/recordings\/([^/]+)\.mp3$/,
      respond: (_request, match) => {
        const recording = recordings.get(match[1]);
        if (!recording || recording.deleted) {
          return { status: 404, text: "not found", contentType: "text/plain" };
        }
        return { bytes: RECORDING_BYTES, contentType: "audio/mpeg" };
      },
    },

    {
      method: "POST",
      pattern: /^\/v2\/telephony_credentials$/,
      respond: (request) => {
        const body = asRecord(request.body);
        if (typeof body.connection_id !== "string" || !body.connection_id) {
          return telnyxError(422, "connection_id is required", "10015");
        }
        credentialSeq += 1;
        const credential: FakeCredential = {
          id: randomUUID(),
          // Generated usernames start with letters, which is what the
          // dial-target gate's credential-URI rule expects of ours.
          sipUsername: `gencredfake${credentialSeq}${randomUUID().slice(0, 8)}`,
          connectionId: body.connection_id,
          name: typeof body.name === "string" ? body.name : null,
          tag: typeof body.tag === "string" ? body.tag : null,
          tokensIssued: 0,
        };
        credentials.set(credential.id, credential);
        return { status: 201, body: { data: credentialBody(credential) } };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/telephony_credentials\/([^/]+)$/,
      respond: (_request, match) => {
        const credential = credentials.get(match[1]);
        return credential
          ? { body: { data: credentialBody(credential) } }
          : NOT_FOUND();
      },
    },
    {
      method: "DELETE",
      pattern: /^\/v2\/telephony_credentials\/([^/]+)$/,
      respond: (_request, match) => {
        const credential = credentials.get(match[1]);
        if (!credential) return NOT_FOUND();
        credentials.delete(credential.id);
        return { body: { data: credentialBody(credential) } };
      },
    },
    {
      method: "POST",
      pattern: /^\/v2\/telephony_credentials\/([^/]+)\/token$/,
      respond: (_request, match) => {
        const credential = credentials.get(match[1]);
        if (!credential) return NOT_FOUND();
        credential.tokensIssued += 1;
        return {
          status: 201,
          text: credentialToken(credential.sipUsername),
          contentType: "text/plain",
        };
      },
    },
  ];

  function credentialBody(credential: FakeCredential): Record<string, unknown> {
    return {
      id: credential.id,
      record_type: "credential",
      sip_username: credential.sipUsername,
      connection_id: credential.connectionId,
      name: credential.name,
      tag: credential.tag,
      expired: false,
    };
  }

  return {
    voice,
    handlers,
    setOrigin(value) {
      origin = value;
    },
  };
}
