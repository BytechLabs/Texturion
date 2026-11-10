/**
 * #731: a group heading in the settings navigation never looks like a link.
 * Size alone is not enough (the founder could not tell them apart in dark
 * mode), so the two must also differ in colour and weight.
 */
import { describe, expect, it } from "vitest";

import { GROUP_HEADING_CLASS, NAV_LINK_CLASS } from "./settings-nav";

const token = (classes: string, prefix: RegExp) =>
  classes.split(/\s+/).find((name) => prefix.test(name));

describe("#731 settings navigation hierarchy", () => {
  it("headings and links differ in colour", () => {
    const heading = token(GROUP_HEADING_CLASS, /^text-(app-|muted|foreground)/);
    const link = token(NAV_LINK_CLASS, /^text-(app-|muted|foreground)/);
    expect(heading).toBeTruthy();
    expect(link).toBeTruthy();
    expect(heading).not.toBe(link);
  });

  it("headings and links differ in weight and case", () => {
    expect(token(GROUP_HEADING_CLASS, /^font-/)).not.toBe(token(NAV_LINK_CLASS, /^font-/));
    expect(GROUP_HEADING_CLASS).toContain("uppercase");
    expect(NAV_LINK_CLASS).not.toContain("uppercase");
  });
});
