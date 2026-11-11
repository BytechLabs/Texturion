import { describe, expect, it } from "vitest";

import { pauseQueryEnabled } from "@/components/settings/pause-plan";

import { companyAllows } from "./company-actions";

describe("companyAllows (#722)", () => {
  it("follows the server's list", () => {
    expect(companyAllows({ allowed_actions: ["pause", "close"] }, "pause")).toBe(true);
    expect(companyAllows({ allowed_actions: ["pause", "close"] }, "resume")).toBe(false);
    expect(companyAllows({ allowed_actions: [] }, "close")).toBe(false);
  });

  it("falls back to showing the control when an older server sends no list", () => {
    expect(companyAllows({}, "resume")).toBe(true);
    expect(companyAllows(undefined, "resume")).toBe(true);
  });

  it("asks the pause question only where a pause or a resume is allowed", () => {
    const base = { plan: "pro", subscription_status: "active" } as const;
    expect(pauseQueryEnabled(true, { ...base, allowed_actions: ["pause"] })).toBe(true);
    expect(pauseQueryEnabled(true, { ...base, allowed_actions: ["resume"] })).toBe(true);
    expect(pauseQueryEnabled(true, { ...base, allowed_actions: [] })).toBe(false);
    expect(pauseQueryEnabled(true, base)).toBe(true);
  });
});
