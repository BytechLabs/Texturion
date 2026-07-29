/**
 * #339 — the version comparison three clients and one SQL constraint share.
 *
 * The table below is the contract. `AppVersionTest.kt` and
 * `AppVersionTests.swift` assert the same cases against their hand-ports,
 * because copied logic drifts silently and a drift here means a client that
 * exempts itself from a floor — or blocks itself against one nobody set.
 */
import { describe, expect, it } from "vitest";

import {
  isOlderThan,
  updateRequirement,
  versionKey,
  type AppReleasePolicy,
} from "./app-version";

const policy = (over: Partial<AppReleasePolicy> = {}): AppReleasePolicy => ({
  platform: "ios",
  recommended_version: null,
  minimum_version: null,
  message: null,
  update_url: null,
  ...over,
});

describe("versionKey", () => {
  it("pads to four segments so 2 and 2.0.0.0 are one build", () => {
    expect(versionKey("2")).toEqual([2, 0, 0, 0]);
    expect(versionKey("2.0.0.0")).toEqual([2, 0, 0, 0]);
  });

  it("returns null for anything that is not a version", () => {
    // Never a number, never a zero. A garbage version that compared as newer
    // would exempt that build from every floor.
    for (const bad of ["1.4.0-beta", "v1", "", "latest", "1..2", "1.2.3.4.5", "99999"]) {
      expect(versionKey(bad), bad).toBeNull();
    }
    expect(versionKey(null)).toBeNull();
    expect(versionKey(undefined)).toBeNull();
  });
});

describe("isOlderThan", () => {
  it("orders by segment, not by string", () => {
    // The trap: "1.10.0" < "1.9.0" as strings, which would tell a user on the
    // newest build that they are behind.
    expect(isOlderThan("1.9.0", "1.10.0")).toBe(true);
    expect(isOlderThan("1.10.0", "1.9.0")).toBe(false);
  });

  it("is false for equal versions, including differently written ones", () => {
    expect(isOlderThan("2.0.0", "2")).toBe(false);
    expect(isOlderThan("2", "2.0.0")).toBe(false);
  });

  it("is false whenever either side is unreadable", () => {
    // The safety property. A parse failure must never read as "behind".
    expect(isOlderThan("garbage", "1.0.0")).toBe(false);
    expect(isOlderThan("1.0.0", "garbage")).toBe(false);
    expect(isOlderThan(null, "1.0.0")).toBe(false);
    expect(isOlderThan("1.0.0", null)).toBe(false);
  });
});

describe("updateRequirement", () => {
  it("says nothing when there is no policy", () => {
    expect(updateRequirement("1.0.0", null)).toBe("none");
    expect(updateRequirement("1.0.0", policy())).toBe("none");
  });

  it("prompts below the recommended version", () => {
    expect(updateRequirement("1.0.0", policy({ recommended_version: "1.1.0" }))).toBe("soft");
  });

  it("says nothing at or above the recommended version", () => {
    expect(updateRequirement("1.1.0", policy({ recommended_version: "1.1.0" }))).toBe("none");
    expect(updateRequirement("1.2.0", policy({ recommended_version: "1.1.0" }))).toBe("none");
  });

  it("blocks below the floor, and the floor outranks the prompt", () => {
    expect(
      updateRequirement("1.0.0", policy({ recommended_version: "1.2.0", minimum_version: "1.1.0" })),
    ).toBe("block");
  });

  it("prompts, not blocks, between the floor and the recommendation", () => {
    expect(
      updateRequirement("1.1.0", policy({ recommended_version: "1.2.0", minimum_version: "1.1.0" })),
    ).toBe("soft");
  });

  it("never blocks a client that does not know its own version", () => {
    // A misconfigured build is our mistake. Blocking it converts that mistake
    // into the customer's outage.
    expect(updateRequirement(null, policy({ minimum_version: "9.0.0" }))).toBe("none");
    expect(updateRequirement("", policy({ minimum_version: "9.0.0" }))).toBe("none");
    expect(updateRequirement("nightly", policy({ minimum_version: "9.0.0" }))).toBe("none");
  });

  it("never blocks against an unreadable floor", () => {
    expect(updateRequirement("1.0.0", policy({ minimum_version: "not-a-version" }))).toBe("none");
  });
});
