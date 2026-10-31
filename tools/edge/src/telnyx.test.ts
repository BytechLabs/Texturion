import { describe, expect, it } from "vitest";

import { judge, parseEvent, type TelnyxEvent, verifyTelnyxSignature } from "./telnyx";
import {
  CONNECTIONS,
  OWNED_A,
  OWNED_B,
  PARTITION,
  PRODUCTION_CONNECTION,
  PRODUCTION_PROFILE,
  PROFILE_ROBOT,
  PROFILE_TENANT,
  STANDING,
  STRANGER,
  nowSeconds,
  signature,
  telnyxKeys,
} from "./test/support";

/**
 * The signature check against a real Ed25519 pair generated here, signed the
 * way Telnyx signs: over the bytes of `"{timestamp}|{raw_body}"`.
 */
describe("verifyTelnyxSignature", () => {
  const body = JSON.stringify({ data: { id: "evt-1", event_type: "call.initiated", payload: {} } });

  async function headers(timestamp: string, signed = body): Promise<Headers> {
    const { pair } = await telnyxKeys();
    return new Headers({
      "telnyx-timestamp": timestamp,
      "telnyx-signature-ed25519": await signature(pair, timestamp, signed),
    });
  }

  it("accepts a fresh signature over the exact body", async () => {
    const { publicKey } = await telnyxKeys();
    expect(await verifyTelnyxSignature(publicKey, await headers(nowSeconds()), body)).toBe(true);
  });

  it("refuses a signature over a different body", async () => {
    const { publicKey } = await telnyxKeys();
    const forged = await headers(nowSeconds(), `${body} `);
    expect(await verifyTelnyxSignature(publicKey, forged, body)).toBe(false);
  });

  it("refuses a signature from another key", async () => {
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", other.publicKey)) as ArrayBuffer);
    const otherKey = btoa(String.fromCharCode(...raw));
    expect(await verifyTelnyxSignature(otherKey, await headers(nowSeconds()), body)).toBe(false);
  });

  it("refuses a timestamp more than five minutes old or ahead, and accepts one at the edge", async () => {
    const { publicKey } = await telnyxKeys();
    const now = 1_786_000_000_000;
    const at = (offset: number) => String(now / 1000 + offset);
    expect(await verifyTelnyxSignature(publicKey, await headers(at(-301)), body, now)).toBe(false);
    expect(await verifyTelnyxSignature(publicKey, await headers(at(301)), body, now)).toBe(false);
    expect(await verifyTelnyxSignature(publicKey, await headers(at(-300)), body, now)).toBe(true);
  });

  it("refuses missing headers, a malformed timestamp and a missing or malformed key", async () => {
    const { publicKey } = await telnyxKeys();
    const good = await headers(nowSeconds());
    expect(await verifyTelnyxSignature(publicKey, new Headers(), body)).toBe(false);
    const loose = new Headers(good);
    loose.set("telnyx-timestamp", `${nowSeconds()}.5`);
    expect(await verifyTelnyxSignature(publicKey, loose, body)).toBe(false);
    expect(await verifyTelnyxSignature(undefined, good, body)).toBe(false);
    expect(await verifyTelnyxSignature("c2hvcnQ=", good, body)).toBe(false);
  });
});

function event(type: string, payload: Record<string, unknown>): TelnyxEvent {
  return { id: "evt", type, payload };
}

describe("judge: ownership by resource", () => {
  it("relays a call event on a nonprod connection, with its leg", () => {
    const verdict = judge(
      "/t/v",
      event("call.answered", { connection_id: CONNECTIONS.voice, call_control_id: "ccid-1", direction: "incoming", from: OWNED_A }),
      PARTITION,
    );
    expect(verdict).toEqual({
      action: "relay-call",
      kind: "call",
      leg: { call_control_id: "ccid-1", connection_id: CONNECTIONS.voice, via: "voice" },
    });
  });

  it("drops a call event on a production connection, signed or not", () => {
    expect(
      judge("/t/v", event("call.initiated", { connection_id: PRODUCTION_CONNECTION, from: OWNED_A }), PARTITION),
    ).toEqual({ action: "drop", reason: "not_owned" });
  });

  it("pins each path to its own connections", () => {
    const robotOnVoice = event("call.initiated", { connection_id: CONNECTIONS.robot, from: OWNED_A, direction: "incoming" });
    expect(judge("/t/v", robotOnVoice, PARTITION)).toEqual({ action: "drop", reason: "not_owned" });
    expect(judge("/t/r", robotOnVoice, PARTITION)).toMatchObject({ action: "relay-call", kind: "robot-call" });
    const onMessaging = event("call.initiated", { connection_id: CONNECTIONS.voice, from: OWNED_A });
    expect(judge("/t/m", onMessaging, PARTITION)).toEqual({ action: "drop", reason: "not_owned" });
    const sentinel = event("call.initiated", {
      connection_id: CONNECTIONS.sentinel,
      call_control_id: "ccid-g02",
      from: "sip:gencred@sip.telnyx.com",
    });
    expect(judge("/t/w", sentinel, PARTITION)).toMatchObject({ action: "relay-call", leg: null });
    const webrtc = event("call.initiated", { connection_id: CONNECTIONS.webrtc, call_control_id: "ccid-w", from: OWNED_A });
    expect(judge("/t/w", webrtc, PARTITION)).toMatchObject({ action: "relay-call", leg: { via: "webrtc" } });
  });

  it("queues a message event on a live nonprod profile and drops any other", () => {
    expect(judge("/t/m", event("message.sent", { messaging_profile_id: PROFILE_TENANT }), PARTITION)).toEqual({
      action: "queue-message",
    });
    expect(judge("/t/r", event("message.finalized", { messaging_profile_id: PROFILE_ROBOT }), PARTITION)).toEqual({
      action: "queue-message",
    });
    expect(judge("/t/m", event("message.sent", { messaging_profile_id: PRODUCTION_PROFILE }), PARTITION)).toEqual({
      action: "drop",
      reason: "not_owned",
    });
    expect(judge("/t/m", event("message.sent", {}), PARTITION)).toEqual({ action: "drop", reason: "not_owned" });
    expect(judge("/t/v", event("message.sent", { messaging_profile_id: PROFILE_TENANT }), PARTITION)).toEqual({
      action: "drop",
      reason: "not_owned",
    });
  });

  it("drops every other event type", () => {
    expect(judge("/t/m", event("10dlc.brand.update", { messaging_profile_id: PROFILE_TENANT }), PARTITION)).toEqual({
      action: "drop",
      reason: "unknown_type",
    });
  });
});

describe("judge: strangers", () => {
  const initiated = (from: unknown, extra: Record<string, unknown> = {}) =>
    event("call.initiated", {
      connection_id: CONNECTIONS.voice,
      call_control_id: "ccid-s",
      direction: "incoming",
      from,
      to: OWNED_B,
      ...extra,
    });

  it("asks for a reject on a stranger's opening event, naming our number", () => {
    expect(judge("/t/v", initiated(STRANGER), PARTITION)).toEqual({
      action: "stranger-call",
      opens: true,
      reject: { call_control_id: "ccid-s", connection_id: CONNECTIONS.voice, via: "voice" },
      ours: OWNED_B,
      theirs: STRANGER,
    });
  });

  it("names no reject on a stranger leg's later events", () => {
    const hangup = event("call.hangup", { connection_id: CONNECTIONS.voice, call_control_id: "ccid-s", direction: "incoming", from: STRANGER });
    expect(judge("/t/v", hangup, PARTITION)).toMatchObject({ action: "stranger-call", opens: false, reject: null });
  });

  it("treats a withheld caller, a SIP caller off the WebRTC path and a sip-wrapped stranger as strangers", () => {
    expect(judge("/t/v", initiated(undefined), PARTITION)).toMatchObject({ action: "stranger-call", theirs: "withheld" });
    expect(judge("/t/v", initiated("sip:someone@sip.telnyx.com"), PARTITION)).toMatchObject({ action: "stranger-call" });
    expect(judge("/t/v", initiated(`sip:${STRANGER}@sip.telnyx.com`), PARTITION)).toMatchObject({
      action: "stranger-call",
      theirs: STRANGER,
    });
  });

  it("passes owned and standing callers, in any wrapping, and legs we dialled", () => {
    expect(judge("/t/v", initiated(OWNED_A), PARTITION)).toMatchObject({ action: "relay-call" });
    expect(judge("/t/v", initiated(`sip:${STANDING}@sip.telnyx.com;transport=tls`), PARTITION)).toMatchObject({
      action: "relay-call",
    });
    expect(judge("/t/v", initiated(STRANGER, { direction: "outgoing" }), PARTITION)).toMatchObject({
      action: "relay-call",
    });
  });

  it("drops a stranger's text and keeps our number for the detach count", () => {
    const received = event("message.received", {
      messaging_profile_id: PROFILE_TENANT,
      from: { phone_number: STRANGER },
      to: [{ phone_number: OWNED_A }],
    });
    expect(judge("/t/m", received, PARTITION)).toEqual({ action: "stranger-text", ours: OWNED_A, theirs: STRANGER });
  });

  it("queues an owned number's text", () => {
    const received = event("message.received", {
      messaging_profile_id: PROFILE_TENANT,
      from: { phone_number: OWNED_B },
      to: [{ phone_number: OWNED_A }],
    });
    expect(judge("/t/m", received, PARTITION)).toEqual({ action: "queue-message" });
  });
});

describe("parseEvent", () => {
  it("reads the envelope and refuses one without an id or type", () => {
    expect(parseEvent(JSON.stringify({ data: { id: "e", event_type: "call.hangup", payload: { a: 1 } } }))).toEqual({
      id: "e",
      type: "call.hangup",
      payload: { a: 1 },
    });
    expect(parseEvent(JSON.stringify({ data: { event_type: "call.hangup" } }))).toBeNull();
    expect(parseEvent("not json")).toBeNull();
  });
});
