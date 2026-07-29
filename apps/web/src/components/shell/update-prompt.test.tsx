import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppReleasePolicy, UpdateRequirement } from "@loonext/shared";

/**
 * #339 — the update surfaces, and mostly the one property that matters:
 * NOTHING appears unless the server said something.
 *
 * A false block is the worst outcome this feature can produce — every
 * customer's business phone at once, per the issue's devil's advocate — so the
 * assertions that earn their place are the ones proving silence (no policy, a
 * current build) and the ones proving the block always carries its reason and
 * its way out.
 */

let requirement: UpdateRequirement = "none";
let policy: AppReleasePolicy | null = {
  platform: "web",
  recommended_version: "1.1.0",
  minimum_version: null,
  message: null,
  update_url: null,
};

vi.mock("@/lib/api/app-release", () => ({
  APP_VERSION: "1.0.0",
  useUpdateRequirement: () => requirement,
  useAppRelease: () => ({ data: policy }),
}));

const { UpdatePrompt, dismissKey } = await import("./update-prompt");

function markup(): string {
  return renderToStaticMarkup(<UpdatePrompt />);
}

describe("UpdatePrompt", () => {
  it("renders nothing when the build is current", () => {
    requirement = "none";
    expect(markup()).toBe("");
  });

  it("renders nothing when the policy could not be fetched", () => {
    // A network blip must never become an update wall.
    requirement = "none";
    policy = null;
    expect(markup()).toBe("");
    policy = {
      platform: "web",
      recommended_version: "1.1.0",
      minimum_version: null,
      message: null,
      update_url: null,
    };
  });

  it("offers a dismissible card below the recommended version", () => {
    requirement = "soft";
    const html = markup();

    expect(html).toContain("A newer version of Loonext is ready");
    expect(html).toContain("Reload now");
    // Ambient, never blocking: it must be possible to make it go away.
    expect(html).toContain("Dismiss update notice");
    // A status region, not an alert — it interrupts nothing.
    expect(html).toContain('role="status"');
  });

  it("carries the server's own reason rather than inventing one", () => {
    requirement = "soft";
    policy = { ...policy!, message: "Threads load faster now" };
    expect(markup()).toContain("Threads load faster now");
    policy = { ...policy, message: null };
  });

  it("falls back to a plain sentence when the server gave no reason", () => {
    requirement = "soft";
    expect(markup()).toContain("Reload to pick up the latest fixes.");
  });

  it("blocks below the floor, with the reason and no way past it", () => {
    requirement = "block";
    policy = { ...policy!, minimum_version: "2.0.0", message: "A security fix" };
    const html = markup();

    expect(html).toContain("Loonext needs an update");
    expect(html).toContain("A security fix");
    // A block somebody can click past is not a block.
    expect(html).not.toContain("Dismiss update notice");
    // Support's first question, answered on the screen the person is stuck on.
    expect(html).toContain("You are on 1.0.0");
    expect(html).toContain("2.0.0 or newer is required");
  });

  it("explains itself even when the server set a floor with no message", () => {
    requirement = "block";
    policy = { ...policy!, minimum_version: "2.0.0", message: null };
    // Being stopped with no explanation reads as a hijack, so there is always
    // a sentence — the server's when it has one, ours when it does not.
    expect(markup()).toContain("can no longer connect safely");
  });
});

describe("dismissKey", () => {
  it("is per recommended version, so the next release is not pre-dismissed", () => {
    expect(dismissKey("1.1.0")).not.toBe(dismissKey("1.2.0"));
  });

  it("is stable for the same version", () => {
    expect(dismissKey("1.1.0")).toBe(dismissKey("1.1.0"));
  });

  it("has an answer when there is no recommended version at all", () => {
    expect(dismissKey(null)).toContain("unknown");
  });
});
