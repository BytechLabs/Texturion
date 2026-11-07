/**
 * D146: the Durable Object reports to PostHog itself, with its own env and its
 * own `waitUntil`, so a warning raised through RPC, which is how call events
 * arrive, is reported like one raised in fetch or alarm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Env } from "../env";
import { buildMemberRingState } from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";
import { captured, exceptionsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv } from "../test/support";

import type { SessionRuntime } from "./runtime";
import { CallSessionDO } from "./session-do";
import { ctx, makeRuntime, makeStorage, SESSION } from "./session-do-fake";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const bindings = { ...completeEnv(), POSTHOG_API_KEY: "phc_do_test_key" };

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
function withRealReporting(instance: CallSessionDO) {
  const rt = (instance as unknown as { rt: SessionRuntime }).rt;
  const { warn, reportError } = rt;
  const fake = makeRuntime({ initiated: ctx() });
  Object.assign(rt, fake.runtime, { warn, reportError });
  return fake.calls;
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
