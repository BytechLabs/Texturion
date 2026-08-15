import { describe, expect, it } from "vitest";

import {
  capLabel,
  capSegments,
  describeCapChange,
  normalizeMultiplier,
} from "./cap-control";

import { EN as WEB_EN, FR_CA as WEB_FR } from "@/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function resolver(table: unknown) {
  return (key: string, vars: Record<string, string>): string => {
    const [section, name] = key.split(".");
    const text = (table as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof text !== "string") throw new Error(`no entry for ${key}`);
    return Object.entries(vars).reduce(
      (out, [token, value]) => out.split(`{${token}}`).join(value),
      text,
    );
  };
}

const sayEn = resolver(WEB_EN);
const sayFr = resolver(WEB_FR);

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
    expect(describeCapChange(3, 3, 500, sayEn)).toEqual({
      kind: "same",
      requiresConfirmation: false,
      summary: "",
    });
  });

  it("treats legacy null and the 10× ceiling as the same value", () => {
    expect(describeCapChange(null, null, 500, sayEn).requiresConfirmation).toBe(false);
    expect(describeCapChange(null, 10, 500, sayEn).requiresConfirmation).toBe(false);
    expect(describeCapChange(10, null, 500, sayEn).requiresConfirmation).toBe(false);
  });

  it("raising the cap is confirmed with the new pause point", () => {
    const change = describeCapChange(2, 5, 500, sayEn);
    expect(change.kind).toBe("raise");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("2,500");
    expect(change.summary).toContain("1,000");
  });

  it("raising to the ceiling states the real 10× pause point — never 'never pauses'", () => {
    const change = describeCapChange(3, 10, 2500, sayEn);
    expect(change.kind).toBe("raise");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("25,000");
    expect(change.summary).toContain("highest the cap goes");
    expect(change.summary).toContain("2,500");
    expect(change.summary).not.toContain("never pauses");
  });

  it("lowering the cap warns that sends may pause immediately", () => {
    const change = describeCapChange(5, 2, 500, sayEn);
    expect(change.kind).toBe("lower");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("1,000");
    expect(change.summary).toContain("pause right away");
  });

  it("moving off a legacy null compares against the 10× ceiling", () => {
    const change = describeCapChange(null, 2, 2500, sayEn);
    expect(change.kind).toBe("lower");
    expect(change.requiresConfirmation).toBe(true);
    expect(change.summary).toContain("5,000");
  });
});

describe("#228 the same cap change, read in French", () => {
  it("keeps both pause points, and the numbers that are the promise", () => {
    // The number IS the promise here. A sentence that lost {next} would ask
    // somebody to approve a spending change with the amount missing.
    const change = describeCapChange(2, 3, 500, sayFr);
    expect(change.summary).toContain((1500).toLocaleString());
    expect(change.summary).toContain((1000).toLocaleString());
    expect(change.summary).not.toMatch(/\{/);
    expect(change.summary).not.toContain("settings.");
  });

  it("still names the overage rate at the ceiling", () => {
    // The only one of the three that says money changes hands.
    const change = describeCapChange(3, 10, 2500, sayFr);
    expect(change.summary).toMatch(/dépassement/);
    expect(change.summary).toContain((2500).toLocaleString());
  });

  it("still warns that lowering can stop sending at once", () => {
    const change = describeCapChange(5, 2, 500, sayFr);
    expect(change.summary).toContain("tout de suite");
  });

  it("says the same thing in English through the same path", () => {
    // Both halves resolve, so a missing key fails here rather than rendering
    // its own name on somebody's screen.
    for (const say of [sayEn, sayFr]) {
      for (const [from, to] of [[2, 3], [3, 10], [5, 2]] as const) {
        const summary = describeCapChange(from, to, 2500, say).summary;
        expect(summary).not.toContain("settings.");
        expect(summary).not.toMatch(/\{/);
      }
    }
  });
});
