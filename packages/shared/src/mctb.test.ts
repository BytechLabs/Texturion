/**
 * #192: the missed-call text-back fallback rule — a non-blank owner message
 * overrides; anything blank falls back to the product default.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_MCTB_MESSAGE, effectiveMctbMessage } from "./mctb";

describe("effectiveMctbMessage — the #192 fallback rule", () => {
  it("a non-blank owner message wins, trimmed, and reads as custom", () => {
    expect(effectiveMctbMessage("  Call you right back!  ")).toEqual({
      message: "Call you right back!",
      custom: true,
    });
  });

  it("null / empty / whitespace all fall back to the product default", () => {
    for (const blank of [null, undefined, "", "   ", "\n\t "]) {
      expect(effectiveMctbMessage(blank)).toEqual({
        message: DEFAULT_MCTB_MESSAGE,
        custom: false,
      });
    }
  });

  it("the default is concrete product copy with the business-name merge field and no em dashes", () => {
    expect(DEFAULT_MCTB_MESSAGE).toContain("{business_name}");
    expect(DEFAULT_MCTB_MESSAGE).not.toContain("—");
    expect(DEFAULT_MCTB_MESSAGE.trim().length).toBeGreaterThan(0);
  });
});
