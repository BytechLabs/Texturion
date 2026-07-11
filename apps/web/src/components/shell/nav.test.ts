/**
 * Nav registry pins (#129 + #100): Calls is a desktop/palette surface; the
 * mobile tab bar's four-links-plus-avatar shape is a shipped decision that
 * a nav addition must never silently widen.
 */
import { describe, expect, it } from "vitest";

import { MOBILE_NAV, PRIMARY_NAV } from "./nav";

describe("nav registries", () => {
  it("PRIMARY_NAV carries the #129 Calls surface", () => {
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/for-you",
      "/inbox",
      "/calls",
      "/tasks",
      "/contacts",
    ]);
  });

  it("MOBILE_NAV stays locked at four links — no fifth tab (#100)", () => {
    expect(MOBILE_NAV).toHaveLength(4);
    expect(MOBILE_NAV.map((item) => item.href)).not.toContain("/calls");
  });
});
