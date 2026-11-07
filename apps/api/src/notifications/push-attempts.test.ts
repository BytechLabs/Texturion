/**
 * D142: the push_attempt event, including the rule that the evidence can
 * never be the reason a push fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scrubProperties } from "../observability/scrub";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv } from "../test/support";
import {
  classifyPushResponse,
  recordPushAttempts,
  timedPush,
  type PushAttempt,
  type PushTarget,
} from "./push-attempts";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const env = completeEnv();

const TARGET: PushTarget = {
  companyId: "c1000000-0000-4000-8000-00000000000c",
  userId: "a1000000-0000-4000-8000-00000000000a",
  callSessionId: "4f6a1c2e-8b3d-4e5f-9a0b-1c2d3e4f5a6b",
  purpose: "ring",
  channel: "fcm",
  platform: "android",
  priority: "high",
};

beforeEach(() => {
  resetCaptures();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyPushResponse", () => {
  it.each([
    [{ ok: true, status: 201, gone: false }, "accepted"],
    [{ ok: false, status: 410, gone: true }, "gone"],
    [{ ok: false, status: 404, gone: true }, "gone"],
    [{ ok: false, status: 401, gone: false }, "unauthorized"],
    [{ ok: false, status: 403, gone: false }, "unauthorized"],
    [{ ok: false, status: 429, gone: false }, "throttled"],
    [{ ok: false, status: 400, gone: false }, "rejected"],
    [{ ok: false, status: 413, gone: false }, "rejected"],
    [{ ok: false, status: 503, gone: false }, "provider_error"],
  ] as const)("%o is %s", (outcome, expected) => {
    expect(classifyPushResponse(outcome)).toBe(expected);
  });
});

describe("timedPush", () => {
  it("records the outcome and latency, and hands the result back untouched", async () => {
    const log: PushAttempt[] = [];
    const result = { ok: true, status: 200, gone: false, errorBody: "" };
    const returned = await timedPush(log, TARGET, async () => result);
    expect(returned).toBe(result);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ ...TARGET, responseClass: "accepted", httpStatus: 200 });
    expect(log[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("stamps the moment the send started, not the moment it answered", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T14:00:00.000Z") });
    try {
      const log: PushAttempt[] = [];
      await timedPush(log, TARGET, async () => {
        vi.setSystemTime(new Date("2026-10-31T14:00:04.000Z"));
        return { ok: true, status: 200, gone: false };
      });
      expect(log[0]).toMatchObject({
        startedAt: Date.parse("2026-10-31T14:00:00.000Z"),
        latencyMs: 4_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a throw as transport_error and rethrows the same error", async () => {
    const log: PushAttempt[] = [];
    const boom = new Error("socket hang up");
    await expect(
      timedPush(log, TARGET, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(log).toEqual([
      expect.objectContaining({ responseClass: "transport_error", httpStatus: null }),
    ]);
  });

  it("records nothing for a send that was never made (status 0)", async () => {
    const log: PushAttempt[] = [];
    await timedPush(log, TARGET, async () => ({ ok: true, status: 0, gone: false }));
    expect(log).toEqual([]);
  });
});

describe("recordPushAttempts", () => {
  const attempt: PushAttempt = {
    ...TARGET,
    responseClass: "accepted",
    httpStatus: 200,
    latencyMs: 87.6,
    startedAt: Date.parse("2026-10-31T14:00:00.000Z"),
  };

  it("sends one push_attempt per attempt, under the workspace, with the contract's fields", () => {
    recordPushAttempts(env, [attempt, { ...attempt, platform: "ios", httpStatus: null }]);

    expect(eventsCaptured("push_attempt")).toEqual([
      {
        event: "push_attempt",
        distinctId: TARGET.companyId,
        properties: {
          purpose: "ring",
          channel: "fcm",
          platform: "android",
          priority: "high",
          response_class: "accepted",
          http_status: 200,
          latency_ms: 88,
          call_session_id: TARGET.callSessionId,
          user_id: TARGET.userId,
          attempted_at: "2026-10-31T14:00:00.000Z",
        },
      },
      expect.objectContaining({
        properties: expect.objectContaining({ platform: "ios", http_status: null }),
      }),
    ]);
  });

  it("keeps an alert's missing call session as null", () => {
    recordPushAttempts(env, [{ ...attempt, purpose: "alert", callSessionId: null }]);

    const [{ properties }] = eventsCaptured("push_attempt");
    expect(properties).toMatchObject({ purpose: "alert", call_session_id: null });
  });

  it("sends nothing for an empty fan-out", () => {
    recordPushAttempts(env, []);
    expect(eventsCaptured()).toEqual([]);
  });

  it("never sends a negative latency", () => {
    recordPushAttempts(env, [{ ...attempt, latencyMs: -3 }]);
    expect(eventsCaptured("push_attempt")[0].properties.latency_ms).toBe(0);
  });

  it("sends every field through the PostHog scrubber unchanged", () => {
    recordPushAttempts(env, [attempt, { ...attempt, callSessionId: null, httpStatus: null }]);

    for (const { properties } of eventsCaptured("push_attempt")) {
      const report = vi.fn();
      expect(scrubProperties("push_attempt", properties, report)).toEqual(properties);
      expect(report).not.toHaveBeenCalled();
    }
  });
});
