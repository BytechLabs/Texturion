import { describe, expect, it } from "vitest";

import { provisioningWaitCopy, REGISTRATION_COPY } from "./copy";

describe("provisioningWaitCopy — progressive honest wait ladder", () => {
  const base = "2026-07-09T00:00:00.000Z";
  const at = (ms: number) => provisioningWaitCopy(base, Date.parse(base) + ms);

  it("tier 1 (under-a-minute promise) below 90s", () => {
    expect(at(0)).toBe(REGISTRATION_COPY.numberProvisioning);
    expect(at(89_999)).toBe(REGISTRATION_COPY.numberProvisioning);
  });

  it("tier 2 (taking a little longer) from 90s to 4 min", () => {
    expect(at(90_000)).toContain("taking a little longer than usual");
    expect(at(90_000)).toContain("Hang tight");
    expect(at(239_999)).toContain("Hang tight");
  });

  it("tier 3 (you don't have to wait here) from 4 min on", () => {
    expect(at(240_000)).toContain("you don't have to wait here");
    expect(at(599_000)).toContain("you don't have to wait here");
  });

  it("a missing/unparseable created_at reads as tier 1 (never a false escalation)", () => {
    expect(
      provisioningWaitCopy(null, Date.parse(base) + 600_000),
    ).toBe(REGISTRATION_COPY.numberProvisioning);
    expect(provisioningWaitCopy(undefined, 0)).toBe(
      REGISTRATION_COPY.numberProvisioning,
    );
    expect(provisioningWaitCopy("not-a-date", 10_000_000)).toBe(
      REGISTRATION_COPY.numberProvisioning,
    );
  });
});
