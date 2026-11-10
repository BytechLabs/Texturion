/**
 * D146: the Durable Object reports to PostHog itself, with its own env and its
 * own `waitUntil`, so a warning raised through RPC, which is how call events
 * arrive, is reported like one raised in fetch or alarm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Env } from "../env";
import { buildMemberRingState, buildVoicemailState } from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";
import { buildOutboundState, OUTBOUND_CUSTOMER_STATE } from "../messaging/voice-webhook";
import {
  captured,
  eventsCaptured,
  exceptionsCaptured,
  resetCaptures,
} from "../test/capture-mock";
import { completeEnv } from "../test/support";

import type { SessionRuntime } from "./runtime";
import { CallSessionDO } from "./session-do";
import { ctx, makeRuntime, makeStorage, SESSION, type FakeConfig } from "./session-do-fake";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const bindings = { ...completeEnv(), POSTHOG_API_KEY: "phc_do_test_key" };
const OUTBOUND_SESSION = "22222222-2222-4222-8222-222222222222";

let eventN = 0;

function makeDO() {
  const store = makeStorage();
  const waitUntil = vi.fn();
  const instance = new CallSessionDO(
    { storage: store.storage, waitUntil } as never,
    bindings as never,
  );
  return { instance, waitUntil };
}

/** The object's real runtime, with only its Telnyx and database calls faked. */
function withRealReporting(instance: CallSessionDO, config: FakeConfig = { initiated: ctx() }) {
  const rt = (instance as unknown as { rt: SessionRuntime }).rt;
  const { warn, reportError, capture } = rt;
  const fake = makeRuntime(config);
  Object.assign(rt, fake.runtime, { warn, reportError, capture });
  return fake.calls;
}

function telnyx(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  eventN += 1;
  return { data: { id: `evt-${eventN}`, event_type: eventType, payload: payload as never } };
}

function initiated(): TelnyxEvent {
  return telnyx("call.initiated", {
    call_control_id: "cust-ccid",
    call_session_id: SESSION,
    direction: "incoming",
    to: "+19995000",
    from: "+15551000",
  });
}

/** The caller's own leg, tagged once it was answered into voicemail. */
function callerLeg(eventType: string, clientState?: string): TelnyxEvent {
  return telnyx(eventType, {
    call_control_id: "cust-ccid",
    call_session_id: SESSION,
    direction: "incoming",
    client_state: clientState,
  });
}

function outboundLeg(eventType: string): TelnyxEvent {
  return telnyx(eventType, {
    call_control_id: "oc-ccid",
    call_session_id: "telnyx-leg-session",
    direction: "outgoing",
    to: "+15551234567",
    from: "+19995000",
    client_state: buildOutboundState(
      OUTBOUND_CUSTOMER_STATE,
      "+15551234567",
      "nonce-1",
      OUTBOUND_SESSION,
    ),
  });
}

async function deliver(instance: CallSessionDO, event: TelnyxEvent) {
  await instance.onTelnyxEvent(event);
  await instance.whenIdle();
}

function lifecycle() {
  return eventsCaptured().filter((entry) => entry.event.startsWith("call_"));
}

function expectDurableObjectEnv(env: Env) {
  expect(env).toEqual(getEnv(bindings as never));
}

beforeEach(() => {
  resetCaptures();
});

describe("a warning raised inside onTelnyxEvent", () => {
  it("is one capture with the object's env, handed to its waitUntil", async () => {
    const { instance, waitUntil } = makeDO();
    const calls = withRealReporting(instance);

    await instance.onTelnyxEvent({
      data: {
        id: "e1",
        event_type: "call.initiated",
        payload: {
          call_control_id: "cust-ccid",
          call_session_id: SESSION,
          direction: "incoming",
          to: "+19995000",
          from: "+15551000",
        } as never,
      },
    });
    await instance.whenIdle();
    resetCaptures();

    // A forged member answer: the shell hangs it up and warns.
    const forged: TelnyxEvent = {
      data: {
        id: "f1",
        event_type: "call.answered",
        payload: {
          call_control_id: "forged-ccid",
          client_state: buildMemberRingState({
            sessionId: SESSION,
            userId: "attacker",
            caller: "+15551000",
            inboundCcid: "cust-ccid",
          }),
          to: "sip:evil@sip.telnyx.com",
        } as never,
      },
    };
    await instance.onTelnyxEvent(forged);
    await instance.whenIdle();

    expect(calls.hangups).toContain("forged-ccid");
    expect(captured).toHaveLength(1);
    const [warning] = exceptionsCaptured();
    expect(String(warning.error)).toContain("orphan brm");
    expect(warning.context).toEqual({ source: "call-session-do", level: "warning" });
    const [entry] = captured;
    expectDurableObjectEnv(entry.env);

    const sending = Promise.resolve();
    entry.waitUntil?.(sending);
    expect(waitUntil).toHaveBeenCalledWith(sending);
  });
});

describe("an alarm that throws", () => {
  it("is one exception from the object, and still throws so the platform retries it", async () => {
    const { instance, waitUntil } = makeDO();
    (instance as unknown as { resumeJournalIfAny: () => Promise<void> }).resumeJournalIfAny =
      async () => {
        throw new Error("journal unreadable");
      };

    await expect(instance.alarm()).rejects.toThrow("journal unreadable");

    expect(captured).toHaveLength(1);
    const [failure] = exceptionsCaptured();
    expect(String(failure.error)).toContain("journal unreadable");
    expect(failure.context).toEqual({ source: "call-session-do", extra: { alarm: true } });
    const [entry] = captured;
    expect(entry.env).toBe(bindings);

    const sending = Promise.resolve();
    entry.waitUntil?.(sending);
    expect(waitUntil).toHaveBeenCalledWith(sending);
  });
});

describe("a call's lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an inbound call hung up while ringing is one call_started and one call_ended, from the object", async () => {
    const { instance, waitUntil } = makeDO();
    withRealReporting(instance);

    await deliver(instance, initiated());
    expect(lifecycle()).toEqual([
      {
        event: "call_started",
        distinctId: "co1",
        properties: { direction: "inbound", call_session_id: SESSION, routing: "rang" },
      },
    ]);

    vi.setSystemTime(new Date("2026-11-07T12:00:30Z"));
    const hangup = callerLeg("call.hangup");
    await deliver(instance, hangup);
    // A redelivery of the same webhook, and a second hangup after the end.
    await deliver(instance, hangup);
    await deliver(instance, callerLeg("call.hangup"));

    expect(lifecycle().slice(1)).toEqual([
      {
        event: "call_ended",
        distinctId: "co1",
        properties: {
          direction: "inbound",
          call_session_id: SESSION,
          routing: "rang",
          outcome: "missed",
          duration_seconds: 30,
          ended_by: "inbound-hangup",
        },
      },
    ]);
    for (const entry of captured.filter((c) => c.kind === "event")) {
      expectDurableObjectEnv(entry.env);
      const sending = Promise.resolve();
      entry.waitUntil?.(sending);
      expect(waitUntil).toHaveBeenCalledWith(sending);
    }
  });

  it("a voicemail ends as missed at the hangup and is revised when the recording is saved", async () => {
    const { instance } = makeDO();
    withRealReporting(instance);
    const vmi = buildVoicemailState("+15551000");

    await deliver(instance, initiated());
    vi.setSystemTime(new Date("2026-11-07T12:00:46Z"));
    await instance.alarm();
    await deliver(instance, callerLeg("call.speak.ended", vmi));
    vi.setSystemTime(new Date("2026-11-07T12:01:20Z"));
    await deliver(instance, callerLeg("call.hangup", vmi));
    await deliver(instance, callerLeg("call.recording.saved", vmi));

    expect(lifecycle().map((entry) => [entry.event, entry.properties.outcome])).toEqual([
      ["call_started", undefined],
      ["call_ended", "missed"],
      ["call_outcome_revised", "voicemail"],
    ]);
    expect(lifecycle()[1].properties.duration_seconds).toBe(80);
    expect(lifecycle()[2].properties).toEqual({
      direction: "inbound",
      call_session_id: SESSION,
      routing: "rang",
      outcome: "voicemail",
      previous_outcome: "missed",
    });
  });

  it("an outbound call reports under its own session id, answered, with its length", async () => {
    const { instance } = makeDO();
    withRealReporting(instance, {
      outboundInitiated: {
        callSessionId: OUTBOUND_SESSION,
        customerCcid: "oc-ccid",
        companyId: "co1",
        phoneNumberId: "pn1",
        userId: "placer-1",
        placerSipUsername: "placer-sip",
        customer: "+15551234567",
        businessNumberE164: "+19995000",
      },
    });

    await deliver(instance, outboundLeg("call.initiated"));
    await deliver(instance, outboundLeg("call.answered"));
    vi.setSystemTime(new Date("2026-11-07T12:05:00Z"));
    await deliver(instance, outboundLeg("call.hangup"));

    expect(lifecycle()).toEqual([
      {
        event: "call_started",
        distinctId: "co1",
        properties: { direction: "outbound", call_session_id: OUTBOUND_SESSION, routing: null },
      },
      {
        event: "call_ended",
        distinctId: "co1",
        properties: {
          direction: "outbound",
          call_session_id: OUTBOUND_SESSION,
          routing: null,
          outcome: "answered",
          duration_seconds: 300,
          ended_by: "outbound-hangup",
        },
      },
    ]);
  });

  it("a journal resumed after a crash does not report the start again", async () => {
    let boom = true;
    const store = makeStorage();
    const first = makeRuntime({ initiated: ctx(), pushFanoutThrows: () => boom });
    const crashed = new CallSessionDO({ storage: store.storage } as never, {} as never);
    crashed.installRuntime(first.runtime);
    await crashed.onTelnyxEvent(initiated());
    await crashed.whenIdle();
    expect(store.map.has("journal")).toBe(true);

    boom = false;
    const second = makeRuntime({ initiated: ctx() });
    const revived = new CallSessionDO({ storage: store.storage } as never, {} as never);
    revived.installRuntime(second.runtime);
    expect((await revived.snapshot(SESSION))?.state).toBe("ringing");
    expect(store.map.has("journal")).toBe(false);

    expect(first.calls.events.map((entry) => entry.event)).toEqual(["call_started"]);
    expect(second.calls.events).toEqual([]);
  });
});
