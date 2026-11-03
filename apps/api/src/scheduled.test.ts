/**
 * D146: what a cron trigger reports. The trigger sends its own `ops_heartbeat`
 * whatever its jobs do, each failing job is one exception naming it, and the
 * six-hourly trigger asks the call Durable Object for its heartbeat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Bindings, type Env } from "./env";
import { handler, runScheduledJobs } from "./index";
import { HEARTBEAT_SESSION_NAME, pingCallSessionObject } from "./observability/heartbeat";
import { captured, eventsCaptured, exceptionsCaptured, resetCaptures } from "./test/capture-mock";
import { testExecutionContext } from "./test/messaging-support";
import { supabaseStub } from "./test/routes-harness";
import { rigEnv } from "./test/rig-env";
import { completeEnv, stubFetch } from "./test/support";

vi.mock("./observability/capture", async () =>
  (await import("./test/capture-mock")).captureModuleMock(),
);

beforeEach(() => {
  resetCaptures();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a cron trigger", () => {
  it("sends its heartbeat even when its jobs do not run", async () => {
    // A rig whose database gate is off refuses every job, and the trigger
    // still fired, which is all the heartbeat says.
    const bindings = rigEnv();
    const sb = supabaseStub(getEnv(bindings));
    sb.on("POST", "/rest/v1/rpc/rig_database_posture", () => ({ deploy_env: "", endpoints: 0 }));
    stubFetch(sb.route);
    const { ctx } = testExecutionContext();

    await expect(
      handler.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry: () => {} },
        bindings,
        ctx,
      ),
    ).rejects.toThrow(/rig cron not run/);

    expect(eventsCaptured("ops_heartbeat")).toEqual([
      {
        event: "ops_heartbeat",
        distinctId: "loonext-api",
        properties: { key: "cron:*/5_*_*_*_*", grace_minutes: 30 },
      },
    ]);
  });

  it("refuses a schedule it has no jobs for, reporting it instead of saying it fired", async () => {
    const { ctx } = testExecutionContext();
    await expect(
      handler.scheduled(
        { cron: "1 2 3 4 5", scheduledTime: Date.now(), noRetry: () => {} },
        completeEnv() as Bindings,
        ctx,
      ),
    ).rejects.toThrow(/No scheduled jobs are mapped/);
    expect(eventsCaptured("ops_heartbeat")).toEqual([]);
    expect(captured).toHaveLength(1);
    const [failure] = exceptionsCaptured();
    expect(String(failure.error)).toContain("No scheduled jobs are mapped");
    expect(failure.context).toEqual({ source: "cron", cron: "1 2 3 4 5" });
  });

  it("reports a failed environment check from the raw bindings, since nothing else will", async () => {
    const { ctx } = testExecutionContext();
    const broken = { ...completeEnv(), SUPABASE_URL: undefined } as unknown as Bindings;
    await expect(
      handler.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry: () => {} },
        broken,
        ctx,
      ),
    ).rejects.toThrow(/Environment validation failed/);
    expect(eventsCaptured("ops_heartbeat")).toEqual([]);
    const [failure] = exceptionsCaptured();
    expect(String(failure.error)).toContain("Environment validation failed");
    expect(failure.context).toEqual({ source: "cron", cron: "*/5 * * * *" });
    expect(captured[0].env).toBe(broken);
  });
});

describe("runScheduledJobs", () => {
  const env = getEnv(completeEnv());
  const now = new Date("2026-11-02T13:00:00Z");

  it("reports each failing job as one exception naming it, and still runs the rest", async () => {
    const ran: string[] = [];
    const boom = new Error("boom");
    const jobs = [
      { key: "job:first" as const, run: async () => void ran.push("first") },
      {
        key: "job:broken" as const,
        run: async () => {
          throw boom;
        },
      },
      { key: "job:last" as const, run: async () => void ran.push("last") },
    ];

    await expect(runScheduledJobs(env, "0 13 * * *", jobs, now)).rejects.toThrow(
      /1 of 3 job\(s\) failed/,
    );

    expect(ran).toEqual(["first", "last"]);
    expect(exceptionsCaptured()).toEqual([
      { error: boom, context: { source: "cron", cron: "0 13 * * *", job: "job:broken" } },
    ]);
  });

  it("reports each failure a job collected on its own, since PostHog reads no AggregateError's errors", async () => {
    const first = new Error("first port");
    const second = new Error("second port");
    const inner = new AggregateError([second], "1 release failed");
    const jobs = [
      {
        key: "job:collects" as const,
        run: async () => {
          throw new AggregateError([first, inner], "2 failed");
        },
      },
    ];

    await expect(runScheduledJobs(env, "10 13 * * *", jobs, now)).rejects.toThrow(AggregateError);

    expect(exceptionsCaptured()).toEqual([
      { error: first, context: { source: "cron", cron: "10 13 * * *", job: "job:collects" } },
      { error: second, context: { source: "cron", cron: "10 13 * * *", job: "job:collects" } },
    ]);
  });

  it("reports nothing when every job succeeds", async () => {
    await runScheduledJobs(env, "0 13 * * *", [{ key: "job:fine", run: async () => {} }], now);
    expect(captured).toEqual([]);
  });
});

describe("the call Durable Object's heartbeat", () => {
  it("asks the reserved instance, never a session's", async () => {
    const heartbeat = vi.fn(async () => {});
    const names: string[] = [];
    const namespace = {
      idFromName: (name: string) => {
        names.push(name);
        return { name };
      },
      get: () => ({ heartbeat }),
    };
    const env = { ...getEnv(completeEnv()), CALL_SESSIONS: namespace } as unknown as Env;

    await pingCallSessionObject(env);

    expect(names).toEqual([HEARTBEAT_SESSION_NAME]);
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("fails the run when the object does not answer, so the missing beat is not the only trace", async () => {
    const namespace = {
      idFromName: () => ({}),
      get: () => ({
        heartbeat: async () => {
          throw new Error("object unavailable");
        },
      }),
    };
    const env = { ...getEnv(completeEnv()), CALL_SESSIONS: namespace } as unknown as Env;

    await expect(pingCallSessionObject(env)).rejects.toThrow(/object unavailable/);
  });

  it("does nothing where the binding is absent", async () => {
    await expect(pingCallSessionObject(getEnv(completeEnv()))).resolves.toBeUndefined();
  });
});
