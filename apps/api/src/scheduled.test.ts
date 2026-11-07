/**
 * D146: what a cron trigger reports. Each failing job is one exception naming
 * it, and a trigger refused before its jobs run is one exception naming the
 * cron. Cloudflare records every invocation itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Bindings } from "./env";
import { handler, runScheduledJobs } from "./index";
import { captured, exceptionsCaptured, resetCaptures } from "./test/capture-mock";
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
  it("runs no job on a rig whose database is not in rig mode", async () => {
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

    expect(captured).toEqual([]);
  });

  it("refuses a schedule it has no jobs for, and reports it", async () => {
    const { ctx } = testExecutionContext();
    await expect(
      handler.scheduled(
        { cron: "1 2 3 4 5", scheduledTime: Date.now(), noRetry: () => {} },
        completeEnv() as Bindings,
        ctx,
      ),
    ).rejects.toThrow(/No scheduled jobs are mapped/);
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
