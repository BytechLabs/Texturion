/**
 * #303: each workspace's day of sending goes to PostHog as counts and ratios,
 * under its own id, and never with its name. The thresholds live in the
 * PostHog alert (D146).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captured, eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv, stubFetch } from "../test/support";
import { getEnv } from "../env";
import { runAupSignalsJob } from "./aup-watch";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const COMPANY = "cccccccc-0000-4000-8000-00000000000c";
const OTHER = "dddddddd-0000-4000-8000-00000000000d";

function signalsRead(rows: unknown[]) {
  const asked: unknown[] = [];
  stubFetch(async (url, request) => {
    if (url.pathname === "/rest/v1/rpc/api_aup_signals") {
      asked.push(JSON.parse(await request.text()));
      return Response.json(rows);
    }
    return undefined;
  });
  return asked;
}

beforeEach(() => {
  resetCaptures();
});

describe("aup signals", () => {
  it("sends one event per workspace, with its id and never its name", async () => {
    const asked = signalsRead([
      {
        company_id: COMPANY,
        company_name: "Marlow Roofing",
        sent_24h: 900,
        baseline_daily: "40",
        fresh_ratio: "0.950",
        opt_outs_24h: 12,
        spam_blocks_24h: 6,
      },
      {
        company_id: OTHER,
        company_name: "Quiet Co",
        sent_24h: 3,
        baseline_daily: 2,
        fresh_ratio: 0,
        opt_outs_24h: 0,
        spam_blocks_24h: 0,
      },
    ]);

    expect(await runAupSignalsJob(getEnv(completeEnv()))).toBe(2);

    expect(asked).toEqual([{ p_baseline_days: 14 }]);
    expect(eventsCaptured("aup_signals")).toEqual([
      {
        event: "aup_signals",
        distinctId: COMPANY,
        properties: {
          sent_24h: 900,
          baseline_daily: 40,
          fresh_ratio: 0.95,
          opt_outs_24h: 12,
          spam_blocks_24h: 6,
        },
      },
      {
        event: "aup_signals",
        distinctId: OTHER,
        properties: {
          sent_24h: 3,
          baseline_daily: 2,
          fresh_ratio: 0,
          opt_outs_24h: 0,
          spam_blocks_24h: 0,
        },
      },
    ]);
    expect(JSON.stringify(captured)).not.toContain("Roofing");
  });

  it("decides nothing: a quiet day and a blast are the same kind of event", async () => {
    signalsRead([]);
    expect(await runAupSignalsJob(getEnv(completeEnv()))).toBe(0);
    expect(captured).toEqual([]);
  });

  it("fails the run on a read error rather than reporting a clean day", async () => {
    stubFetch(async (url) =>
      url.pathname === "/rest/v1/rpc/api_aup_signals"
        ? Response.json({ message: "boom" }, { status: 500 })
        : undefined,
    );
    await expect(runAupSignalsJob(getEnv(completeEnv()))).rejects.toThrow(/aup signals read failed/);
    expect(captured).toEqual([]);
  });
});
