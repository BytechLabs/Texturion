/**
 * #643: production's ring audience plus its concurrent calls, against Telnyx's
 * concurrent call limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { TELNYX_CONCURRENT_CALL_LIMIT } from "../telnyx/account-limits";
import { rigEnv } from "../test/rig-env";
import { captured, eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv, stubFetch } from "../test/support";
import { judgeCapacity, legsNeeded, runTelnyxCapacityGauge } from "./telnyx-capacity";

vi.mock("./capture", async () => (await import("../test/capture-mock")).captureModuleMock());

const production = () => getEnv({ ...completeEnv(), DEPLOY_ENV: "production", POSTHOG_API_KEY: "phc_production_test_key" });
const NOW = new Date("2026-11-01T13:00:00Z");

let requests: string[];

function capacity(row: Record<string, unknown> | null) {
  stubFetch(async (url, request) => {
    requests.push(`${request.method} ${url.href}`);
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
  resetCaptures();
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

describe("the capacity gauge", () => {
  it("sends the worst case against the limit, whatever it is", async () => {
    capacity(read(3, 1));
    const report = await runTelnyxCapacityGauge(production(), NOW);
    expect(report?.verdict).toBe("ok");
    expect(eventsCaptured("ops_gauge")).toEqual([
      {
        event: "ops_gauge",
        distinctId: "loonext-api",
        properties: {
          key: "telnyx-concurrent-legs",
          value: 6,
          limit: 10,
          unit: "legs",
          largest_audience: 3,
          peak_concurrent_calls: 1,
        },
      },
    ]);
  });

  it("decides nothing itself: a worst case past the limit is the same one event", async () => {
    capacity(read(8, 2));
    const report = await runTelnyxCapacityGauge(production(), NOW);
    expect(report).toMatchObject({ legsNeeded: 13, limit: 10, verdict: "over" });
    expect(captured).toHaveLength(1);
    expect(eventsCaptured("ops_gauge")[0].properties).toMatchObject({ value: 13, limit: 10 });
  });

  it("fails on a read that returns nothing usable rather than passing it", async () => {
    capacity(null);
    await expect(runTelnyxCapacityGauge(production(), NOW)).rejects.toThrow(/no usable counts/);
    expect(captured).toEqual([]);
  });

  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("does not run on %s", async (_name, build) => {
    capacity(read(9, 9));
    expect(await runTelnyxCapacityGauge(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
    expect(captured).toEqual([]);
  });
});
