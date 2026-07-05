import { describe, expect, it } from "vitest";

import {
  OAUTH_ERROR_REDIRECT,
  resolveCallbackRedirect,
} from "./callback-routing";
import { AUTH_CALLBACK_PATH, oauthRedirectTo } from "./oauth";

describe("resolveCallbackRedirect (D18 OAuth callback routing)", () => {
  it("sends a successful exchange to the sanitized next", () => {
    expect(
      resolveCallbackRedirect({
        code: "pkce-code",
        next: "/tasks",
        exchangeOk: true,
      }),
    ).toBe("/tasks");
  });

  it("defaults a successful exchange to /for-you when next is absent", () => {
    expect(
      resolveCallbackRedirect({ code: "pkce-code", next: null, exchangeOk: true }),
    ).toBe("/for-you");
  });

  it("routes to the error page when the provider returned an error", () => {
    expect(
      resolveCallbackRedirect({
        code: "pkce-code",
        next: "/tasks",
        providerError: "access_denied",
        exchangeOk: true,
      }),
    ).toBe(OAUTH_ERROR_REDIRECT);
  });

  it("routes to the error page when there is no code", () => {
    expect(
      resolveCallbackRedirect({ code: null, next: "/tasks", exchangeOk: true }),
    ).toBe(OAUTH_ERROR_REDIRECT);
  });

  it("routes to the error page when the code exchange failed", () => {
    expect(
      resolveCallbackRedirect({
        code: "pkce-code",
        next: "/tasks",
        exchangeOk: false,
      }),
    ).toBe(OAUTH_ERROR_REDIRECT);
  });

  it("rejects an off-site next even on a successful exchange (open-redirect guard)", () => {
    expect(
      resolveCallbackRedirect({
        code: "pkce-code",
        next: "https://evil.example.com/steal",
        exchangeOk: true,
      }),
    ).toBe("/for-you");
    expect(
      resolveCallbackRedirect({
        code: "pkce-code",
        next: "//evil.example.com",
        exchangeOk: true,
      }),
    ).toBe("/for-you");
  });

  it("keeps a relative next but not a protocol-relative one", () => {
    expect(
      resolveCallbackRedirect({
        code: "c",
        next: "/contacts",
        exchangeOk: true,
      }),
    ).toBe("/contacts");
  });
});

describe("oauthRedirectTo (signInWithOAuth redirectTo builder)", () => {
  it("targets the callback route on the given origin with a safe next", () => {
    const url = oauthRedirectTo("https://app.loonext.com", "/tasks");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.loonext.com");
    expect(parsed.pathname).toBe(AUTH_CALLBACK_PATH);
    expect(parsed.searchParams.get("next")).toBe("/tasks");
  });

  it("falls back to /for-you for a missing or unsafe next", () => {
    expect(
      new URL(oauthRedirectTo("https://app.loonext.com", null)).searchParams.get(
        "next",
      ),
    ).toBe("/for-you");
    expect(
      new URL(
        oauthRedirectTo("https://app.loonext.com", "https://evil.com"),
      ).searchParams.get("next"),
    ).toBe("/for-you");
  });
});
