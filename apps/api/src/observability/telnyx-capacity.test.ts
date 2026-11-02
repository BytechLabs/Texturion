/**
 * #643: production's ring audience plus its concurrent calls, against Telnyx's
 * concurrent call limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { TELNYX_CONCURRENT_CALL_LIMIT } from "../telnyx/account-limits";
import { rigEnv } from "../test/rig-env";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import { completeEnv, stubFetch } from "../test/support";
import { judgeCapacity, legsNeeded, runTelnyxCapacityWatch } from "./telnyx-capacity";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const production = () => getEnv({ ...completeEnv(), DEPLOY_ENV: "production" });
const NOW = new Date("2026-11-01T13:00:00Z");

let requests: string[];

function capacity(row: Record<string, unknown> | null) {
  stubFetch(async (url, request) => {
    requests.push(`${request.method} ${url.href}`);
    if (url.host === "api.resend.com") return Response.json({ id: "email-1" });
    if (url.pathname === "/rest/v1/rpc/api_voice_capacity_read") {
      return Response.json(row === null ? [] : [row]);
    }
    return undefined;
  });
}

const read = (largest_audience: number, peak_concurrent_calls: number) => ({
  numbers: 1,
  largest_audience,
  peak_concurrent_calls,
});

beforeEach(() => {
  resetSentryCaptures();
  requests = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the worst case", () => {
  it("is the new call's leg, every ring leg, and two legs per call already up", () => {
    expect(legsNeeded(read(5, 2))).toBe(1 + 5 + 4);
    expect(legsNeeded(read(0, 0))).toBe(1);
  });

  it("is judged against the measured limit of 10", () => {
    expect(TELNYX_CONCURRENT_CALL_LIMIT).toBe(10);
    expect(judgeCapacity(read(5, 2)).verdict).toBe("at_limit");
    expect(judgeCapacity(read(4, 2)).verdict).toBe("ok");
    expect(judgeCapacity(read(6, 2)).verdict).toBe("over");
  });
});

describe("the capacity watch", () => {
  it("is quiet for a small crew", async () => {
    capacity(read(3, 1));
    const report = await runTelnyxCapacityWatch(production(), NOW);
    expect(report?.verdict).toBe("ok");
    expect(opsCaptures()).toEqual([]);
  });

  it("warns, before the limit can be exceeded, when the worst case just fits", async () => {
    capacity(read(5, 2));
    await runTelnyxCapacityWatch(production(), NOW);
    const [alert] = opsCaptures("telnyx-concurrency-capacity");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-concurrency-capacity"]);
    expect(alert.level).toBe("warning");
    expect(alert.message).toContain("can reach");
  });

  it("raises an error when the worst case exceeds the limit", async () => {
    capacity(read(8, 2));
    const report = await runTelnyxCapacityWatch(production(), NOW);
    expect(report).toMatchObject({ legsNeeded: 13, limit: 10, verdict: "over" });
    const [alert] = opsCaptures("telnyx-concurrency-capacity");
    expect(alert.level).toBe("error");
    expect(String(alert.extra.detail)).toContain("= 13, against a limit of 10");
  });

  it("fails on a read that returns nothing usable rather than passing it", async () => {
    capacity(null);
    await expect(runTelnyxCapacityWatch(production(), NOW)).rejects.toThrow(/no usable counts/);
    expect(opsCaptures()).toEqual([]);
  });

  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("does not run on %s", async (_name, build) => {
    capacity(read(9, 9));
    expect(await runTelnyxCapacityWatch(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
  });
});
