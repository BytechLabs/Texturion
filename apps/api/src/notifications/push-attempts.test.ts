/**
 * D142: the push_attempts ledger, including the rule that the evidence can
 * never be the reason a push fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import { completeEnv, stubFetch } from "../test/support";
import {
  classifyPushResponse,
  PUSH_ATTEMPTS_WRITE_TIMEOUT_MS,
  recordPushAttempts,
  resetPushAttemptAlertsForTest,
  timedPush,
  type PushAttempt,
  type PushTarget,
} from "./push-attempts";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const env = completeEnv();

const TARGET: PushTarget = {
  companyId: "c1000000-0000-4000-8000-00000000000c",
  userId: "a1000000-0000-4000-8000-00000000000a",
  callSessionId: "v3:session-1",
  purpose: "ring",
  channel: "fcm",
  platform: "android",
  priority: "high",
  targetId: "d1000000-0000-4000-8000-00000000000d",
};

beforeEach(() => {
  resetSentryCaptures();
  resetPushAttemptAlertsForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
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
  };

  it("writes one insert with the table's columns and nothing else", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/push_attempts", () => new Response(null, { status: 201 }));
    stubFetch(sb.route);

    await recordPushAttempts(env, getDb(env), [attempt, { ...attempt, platform: "ios" }]);

    const inserts = sb.find("POST", "/rest/v1/push_attempts");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].body).toEqual([
      {
        company_id: TARGET.companyId,
        user_id: TARGET.userId,
        call_session_id: "v3:session-1",
        purpose: "ring",
        channel: "fcm",
        platform: "android",
        priority: "high",
        response_class: "accepted",
        http_status: 200,
        latency_ms: 88,
        target_id: TARGET.targetId,
      },
      expect.objectContaining({ platform: "ios" }),
    ]);
  });

  it("writes nothing for an empty fan-out", async () => {
    stubFetch(); // any request fails the test
    await recordPushAttempts(env, getDb(env), []);
  });

  it("alerts the operator once on a refusal, with the code and never the row", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/push_attempts", () =>
      Response.json(
        {
          code: "23514",
          message: 'new row violates check constraint; Failing row contains (v3:session-1, +16135550142)',
        },
        { status: 400 },
      ),
    );
    stubFetch(sb.route);

    await recordPushAttempts(env, getDb(env), [attempt]);
    await recordPushAttempts(env, getDb(env), [attempt]);

    const alerts = opsCaptures("push-attempts-ledger");
    expect(alerts).toHaveLength(1);
    const detail = String(alerts[0].extra.detail);
    expect(detail).toContain("23514");
    expect(detail).not.toContain("5550142");
    expect(detail).not.toContain("session-1");
  });

  it("logs a member who left mid-send without alerting: a race, not a broken ledger", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/push_attempts", () =>
      Response.json(
        { code: "23503", message: 'insert violates foreign key constraint "push_attempts_member_fk"' },
        { status: 409 },
      ),
    );
    stubFetch(sb.route);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await recordPushAttempts(env, getDb(env), [attempt]);

    expect(opsCaptures()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("left mid-send"));
  });

  it("records a send slower than the latency ceiling at the ceiling", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/push_attempts", () => new Response(null, { status: 201 }));
    stubFetch(sb.route);

    await recordPushAttempts(env, getDb(env), [{ ...attempt, latencyMs: 900_000 }]);

    const [request] = sb.find("POST", "/rest/v1/push_attempts");
    expect(request.body).toEqual([expect.objectContaining({ latency_ms: 600_000 })]);
  });

  it("logs a transport failure without alerting, and never throws", async () => {
    stubFetch(); // the insert's fetch rejects
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recordPushAttempts(env, getDb(env), [attempt])).resolves.toBeUndefined();

    expect(opsCaptures()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not recorded"));
  });

  it("logs a database's 5xx without alerting: weather, not a refusal", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/push_attempts", () =>
      Response.json({ code: "57014", message: "canceling statement due to statement timeout" }, { status: 503 }),
    );
    stubFetch(sb.route);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await recordPushAttempts(env, getDb(env), [attempt]);

    expect(opsCaptures()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"));
  });

  it("gives up on a write the database never answers", async () => {
    // AbortSignal.timeout is native and fake timers do not drive it, so the
    // deadline is handed a signal the test can fire.
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const asked: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      asked.push(ms);
      return ms === PUSH_ATTEMPTS_WRITE_TIMEOUT_MS ? deadline.signal : timeout(ms);
    });
    let reached = false;
    stubFetch(
      (_url, request) =>
        new Promise<Response>((_resolve, reject) => {
          reached = true;
          request.signal.addEventListener("abort", () => reject(request.signal.reason));
        }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const write = recordPushAttempts(env, getDb(env), [attempt]);
    await vi.waitFor(() => expect(reached).toBe(true));
    expect(asked).toContain(PUSH_ATTEMPTS_WRITE_TIMEOUT_MS);
    deadline.abort(new DOMException("deadline", "TimeoutError"));

    await expect(write).resolves.toBeUndefined();
    expect(opsCaptures()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no answer"));
  });

  it("survives a client that throws outright", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      from: () => {
        throw new Error("not a client");
      },
    } as never;
    await expect(recordPushAttempts(env, broken, [attempt])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
