import { describe, expect, it } from "vitest";

import {
  burstCapacityResult,
  type Report,
} from "../e2e/load-report";

function report(overrides: Partial<Report> = {}): Report {
  return {
    label: "burst",
    count: 2,
    totalMs: 10,
    p50: 4,
    p95: 6,
    max: 6,
    statuses: { "200": 2 },
    hangs: 0,
    throws: 0,
    ...overrides,
  };
}

function payload(value: string): { ceiling_reached: boolean } {
  const json = value.slice(value.indexOf("{"));
  return JSON.parse(json) as { ceiling_reached: boolean };
}

describe("capacity evidence outcome", () => {
  it("marks a fully answered successful burst below the ceiling", () => {
    expect(
      payload(burstCapacityResult("ok", report(), { concurrent_requests: 2 }))
        .ceiling_reached,
    ).toBe(false);
  });

  it.each([
    ["hang", report({ hangs: 1, statuses: { "200": 1 } })],
    ["throw", report({ throws: 1, statuses: { "200": 1 } })],
    ["rate limit", report({ statuses: { "200": 1, "429": 1 } })],
    ["server refusal", report({ statuses: { "200": 1, "503": 1 } })],
  ])("marks a %s as a reached ceiling", (_name, value) => {
    expect(
      payload(burstCapacityResult("limited", value, { concurrent_requests: 2 }))
        .ceiling_reached,
    ).toBe(true);
  });
});
