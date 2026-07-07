import { describe, expect, it } from "vitest";

import {
  CAP_PRESETS,
  MAX_CAP_MULTIPLIER,
  capLabel,
  capSegments,
  describeCapChange,
  normalizeMultiplier,
} from "./cap-control";

describe("CAP_PRESETS (#42)", () => {
  it("offers no uncapped option — the top preset is the 10× hard ceiling", () => {
    expect(CAP_PRESETS).toEqual([2, 3, 5, 10]);
    expect(CAP_PRESETS.at(-1)).toBe(MAX_CAP_MULTIPLIER);
  });
});

describe("normalizeMultiplier", () => {
  it("passes numbers through and parses Postgres numeric strings", () => {
    expect(normalizeMultiplier(3)).toBe(3);
    expect(normalizeMultiplier("3.00")).toBe(3);
    expect(normalizeMultiplier("2.5")).toBe(2.5);
  });

  it("resolves null/undefined/garbage to the 10× ceiling, like the API clamp", () => {
    expect(normalizeMultiplier(null)).toBe(10);
    expect(normalizeMultiplier(undefined)).toBe(10);
    expect(normalizeMultiplier("not-a-number")).toBe(10);
    expect(normalizeMultiplier(-1)).toBe(10);
  });

  it("clamps anything above the DB CHECK ceiling down to 10", () => {
    expect(normalizeMultiplier(25)).toBe(10);
    expect(normalizeMultiplier("11")).toBe(10);
  });
});

describe("capLabel", () => {
  it("renders presets, and the ceiling as an explicit maximum", () => {
    expect(capLabel(2)).toBe("2×");
    expect(capLabel(2.5)).toBe("2.5×");
    expect(capLabel(10)).toBe("Maximum (10×)");
  });

  it("labels a legacy null the same as the ceiling — 'no cap' no longer exists", () => {
    expect(capLabel(null)).toBe("Maximum (10×)");
    expect(capLabel(null)).not.toContain("No cap");
  });
});

describe("capSegments", () => {
  it("mirrors the API: round(included × multiplier)", () => {
    expect(capSegments(500, 3)).toBe(1500);
    expect(capSegments(500, 2.5)).toBe(1250);
    expect(capSegments(2500, 2)).toBe(5000);
  });

  it("resolves a legacy null to the 10× ceiling — never unlimited", () => {
    expect(capSegments(500, null)).toBe(5000);
    expect(capSegments(2500, null)).toBe(25000);
  });
});

describe("describeCapChange (confirmation flow)", () => {
  it("selecting the current value needs no confirmation", () => {
    expect(describeCapChange(3, 3, 500)).toEqual({
      kind: "same",
      requiresConfirmation: false,
      summary: "",
    });
  });

  it("treats legacy null and the 10× ceiling as the same value", () => {
    expect(describeCapChange(null, null, 500).requiresConfirmation).toBe(false);
    expect(describeCapChange(null, 10, 500).requiresConfirmation).toBe(false);
    expect(describeCapChange(10, null, 500).requiresConfirmation).toBe(false);
  });

  it("raising the cap is confirmed with the new pause point", () => {
    const change = describeCapChange(2, 5, 500);
    expect(change.kind).toBe("raise");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("2,500");
    expect(change.summary).toContain("1,000");
  });

  it("raising to the ceiling states the real 10× pause point — never 'never pauses'", () => {
    const change = describeCapChange(3, 10, 2500);
    expect(change.kind).toBe("raise");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("25,000");
    expect(change.summary).toContain("highest the cap goes");
    expect(change.summary).toContain("2,500");
    expect(change.summary).not.toContain("never pauses");
  });

  it("lowering the cap warns that sends may pause immediately", () => {
    const change = describeCapChange(5, 2, 500);
    expect(change.kind).toBe("lower");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("1,000");
    expect(change.summary).toContain("pause right away");
  });

  it("moving off a legacy null compares against the 10× ceiling", () => {
    const change = describeCapChange(null, 2, 2500);
    expect(change.kind).toBe("lower");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("5,000");
  });
});
