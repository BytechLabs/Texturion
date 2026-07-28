/**
 * #382 — the pre-fill is the feature.
 *
 * "My texts aren't working" costs a round trip before anyone can act. The same
 * message carrying a workspace id does not.
 */
import { describe, expect, it } from "vitest";

import { SUPPORT_EMAIL, supportBody, supportMailto } from "./support";

const CTX = {
  companyId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  companyName: "Ace Plumbing",
  plan: "starter",
  platform: "web",
  appVersion: "1.4.0",
};

describe("what we ask the customer to send us", () => {
  it("carries the workspace, plan and platform", () => {
    const body = supportBody(CTX);
    expect(body).toContain("Ace Plumbing");
    expect(body).toContain(CTX.companyId);
    expect(body).toContain("starter");
    expect(body).toContain("web 1.4.0");
  });

  it("puts the customer's own words above our diagnostics", () => {
    // Nobody should have to scroll past our fields to write the sentence they
    // opened the app to write.
    const body = supportBody(CTX);
    expect(body.startsWith("\n\n")).toBe(true);
    expect(body.indexOf("---")).toBeLessThan(body.indexOf("Workspace:"));
  });

  it("still works for a workspace with no name or plan", () => {
    const body = supportBody({ companyId: "abc", platform: "ios" });
    expect(body).toContain("(unnamed)");
    expect(body).toContain("abc");
    expect(body).not.toContain("Plan:");
    expect(body).toContain("App: ios");
  });

  it("builds a mailto the mail client can actually open", () => {
    const url = supportMailto(CTX);
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    expect(params.get("subject")).toBe("Help with my Loonext workspace");
    expect(params.get("body")).toContain(CTX.companyId);
  });

  it("survives a workspace name with an apostrophe and an ampersand", () => {
    // A truncated body is a support request with no diagnostics in it.
    const url = supportMailto({
      ...CTX,
      companyName: "Bob's Heating & Air",
    });
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("body")).toContain("Bob's Heating & Air");
  });

  it("lets a screen seed its own subject", () => {
    // The close-workspace card asks about ONE thing, and the subject should
    // say so rather than making a worried owner explain it.
    const url = supportMailto({ ...CTX, subject: "Please undo my closure" });
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("subject")).toBe("Please undo my closure");
  });
});
