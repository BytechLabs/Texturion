import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captured, eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv, stubFetch } from "../test/support";
import {
  SUPABASE_INCLUDED_STORAGE_GB,
  fleetStoredBytes,
  sendFleetStorageGauge,
} from "./fleet-storage";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

/**
 * #240 item 2: the number that stands in for a tiering implementation.
 *
 * Supabase Storage supports neither lifecycle rules nor storage classes
 * (checked 2026-08-04), so what got built instead is the number that says when
 * that answer expires. It goes to PostHog as a gauge against the allowance,
 * and the threshold lives in the PostHog alert (D146).
 */
const env = completeEnv();
const GIB = 1024 ** 3;

function world(options: { fleetBytes?: number; readFails?: boolean }): void {
  stubFetch(async (url) => {
    if (url.pathname !== "/rest/v1/rpc/api_fleet_stored_bytes") return undefined;
    if (options.readFails) {
      return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    }
    return Response.json(options.fleetBytes ?? 0);
  });
}

beforeEach(() => {
  resetCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the fleet storage gauge", () => {
  it("sends the fleet's stored gigabytes against the included allowance", async () => {
    world({ fleetBytes: 2.5 * GIB });
    expect(await sendFleetStorageGauge(env)).toBe(2.5);
    expect(eventsCaptured("ops_gauge")).toEqual([
      {
        event: "ops_gauge",
        distinctId: "loonext-api",
        properties: {
          key: "supabase-storage",
          value: 2.5,
          limit: SUPABASE_INCLUDED_STORAGE_GB,
          unit: "gb",
        },
      },
    ]);
  });

  it("decides nothing: past the allowance is the same one event", async () => {
    world({ fleetBytes: (SUPABASE_INCLUDED_STORAGE_GB + 20) * GIB });
    await sendFleetStorageGauge(env);
    expect(captured).toHaveLength(1);
    expect(eventsCaptured("ops_gauge")[0].properties.value).toBe(
      SUPABASE_INCLUDED_STORAGE_GB + 20,
    );
  });

  it("throws on a failed read rather than reporting zero", async () => {
    world({ readFails: true });
    await expect(fleetStoredBytes(env)).rejects.toThrow(/fleet storage read failed/);
    await expect(sendFleetStorageGauge(env)).rejects.toThrow(/fleet storage read failed/);
    expect(captured).toEqual([]);
  });
});
