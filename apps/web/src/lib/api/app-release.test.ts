import type { AppReleasePolicy } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { requirementFor } from "./app-release";

const NO_DEMANDS: AppReleasePolicy = {
  platform: "web",
  recommended_version: null,
  minimum_version: null,
  message: null,
  update_url: null,
};

describe("requirementFor (#710)", () => {
  it("offers a reload when the server is serving a newer web build", () => {
    expect(requirementFor("0.25.0", NO_DEMANDS, "0.26.0")).toBe("soft");
    expect(requirementFor("0.25.0", null, "0.25.1")).toBe("soft");
  });

  it("says nothing when this tab is the live build, or either version is unknown", () => {
    expect(requirementFor("0.26.0", NO_DEMANDS, "0.26.0")).toBe("none");
    expect(requirementFor("0.26.0", NO_DEMANDS, null)).toBe("none");
    expect(requirementFor(null, NO_DEMANDS, "0.26.0")).toBe("none");
  });

  it("never turns a newer deploy into a block, and keeps the policy's block", () => {
    expect(requirementFor("0.25.0", { ...NO_DEMANDS, minimum_version: "0.26.0" }, "0.25.0")).toBe(
      "block",
    );
    expect(requirementFor("0.25.0", NO_DEMANDS, "9.0.0")).toBe("soft");
  });
});
