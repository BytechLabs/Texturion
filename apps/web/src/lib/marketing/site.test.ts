import { describe, expect, it } from "vitest";

import { APP_LINKS, appLinkBase } from "./site";

/**
 * #115: app links must be absolute when the marketing/app host split is
 * active, or the Next router RSC-prefetches /signup and /login on loonext.com,
 * follows the cross-host 30x, and fails CORS on every marketing page.
 */
describe("appLinkBase", () => {
  it("returns the origin when the app origin is configured", () => {
    expect(appLinkBase("https://app.loonext.com")).toBe(
      "https://app.loonext.com",
    );
  });

  it("normalizes a trailing slash / path to the bare origin", () => {
    expect(appLinkBase("https://app.loonext.com/")).toBe(
      "https://app.loonext.com",
    );
    expect(appLinkBase("https://app.loonext.com/base")).toBe(
      "https://app.loonext.com",
    );
  });

  it("returns empty (relative links) when unset — dev, CI, previews", () => {
    expect(appLinkBase(undefined)).toBe("");
    expect(appLinkBase("")).toBe("");
  });

  it("returns empty on a malformed origin instead of breaking the nav", () => {
    expect(appLinkBase("not a url")).toBe("");
  });
});

describe("APP_LINKS", () => {
  it("always ends with the app paths, absolute or relative", () => {
    expect(APP_LINKS.login.endsWith("/login")).toBe(true);
    expect(APP_LINKS.signup.endsWith("/signup")).toBe(true);
  });
});
