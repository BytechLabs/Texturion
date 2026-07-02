import { describe, expect, it } from "vitest";

import {
  capLabel,
  capSegments,
  describeCapChange,
  normalizeMultiplier,
} from "./cap-control";

describe("normalizeMultiplier", () => {
  it("passes numbers through and parses Postgres numeric strings", () => {
    expect(normalizeMultiplier(3)).toBe(3);
    expect(normalizeMultiplier("3.00")).toBe(3);
    expect(normalizeMultiplier("2.5")).toBe(2.5);
  });

  it("maps null/undefined/garbage to no-cap", () => {
    expect(normalizeMultiplier(null)).toBeNull();
    expect(normalizeMultiplier(undefined)).toBeNull();
    expect(normalizeMultiplier("not-a-number")).toBeNull();
  });
});

describe("capLabel", () => {
  it("renders presets and the no-cap state", () => {
    expect(capLabel(2)).toBe("2×");
    expect(capLabel(2.5)).toBe("2.5×");
    expect(capLabel(null)).toBe("No cap");
  });
});

describe("capSegments", () => {
  it("mirrors the API: round(included × multiplier), null = no cap", () => {
    expect(capSegments(500, 3)).toBe(1500);
    expect(capSegments(500, 2.5)).toBe(1250);
    expect(capSegments(2500, 2)).toBe(5000);
    expect(capSegments(500, null)).toBeNull();
  });
});

describe("describeCapChange (confirmation flow)", () => {
  it("selecting the current value needs no confirmation", () => {
    expect(describeCapChange(3, 3, 500)).toEqual({
      kind: "same",
      requiresConfirmation: false,
      summary: "",
    });
    expect(describeCapChange(null, null, 500).requiresConfirmation).toBe(false);
  });

  it("raising the cap is confirmed with the new pause point", () => {
    const change = describeCapChange(2, 5, 500);
    expect(change.kind).toBe("raise");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("2,500");
    expect(change.summary).toContain("1,000");
  });

  it("lowering the cap warns that sends may pause immediately", () => {
    const change = describeCapChange(5, 2, 500);
    expect(change.kind).toBe("lower");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("1,000");
    expect(change.summary).toContain("pause right away");
  });

  it("removing the cap states the unlimited-billing consequence", () => {
    const change = describeCapChange(3, null, 500);
    expect(change.kind).toBe("remove");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("never pauses");
    expect(change.summary).toContain("500");
  });

  it("adding a cap from no-cap states the new pause point", () => {
    const change = describeCapChange(null, 2, 2500);
    expect(change.kind).toBe("add");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("5,000");
  });
});
