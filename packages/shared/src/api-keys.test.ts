import { describe, expect, it } from "vitest";

import {
  API_KEY_CAP,
  API_KEY_DISPLAY_CHARS,
  API_KEY_PREFIX,
  API_KEY_REQUESTS_PER_MINUTE,
  API_KEY_SCOPES,
  API_KEY_SECRET_BYTES,
  PUBLIC_API_BASE,
  PUBLIC_API_VERSION,
  apiKeyAllows,
  apiKeyScopeLabelKey,
  isApiKeyScope,
} from "./api-keys";

describe("the scope vocabulary", () => {
  it("names exactly the seven scopes, and no bearer of full account power", () => {
    // Set equality in both directions. The assertion that matters is the
    // ABSENCE: #243's constraint is that a key is never a bearer of full
    // account power, and the way that stops being true is somebody adding an
    // `admin` or a `*` to a list nobody was checking.
    expect([...API_KEY_SCOPES].sort()).toEqual(
      [
        "contacts:read",
        "contacts:write",
        "conversations:read",
        "messages:read",
        "messages:send",
        "tasks:read",
        "tasks:write",
      ].sort(),
    );
  });

  it("reaches nothing that could take the account over", () => {
    // Named individually rather than by pattern, so the test says WHAT must
    // stay out of reach: the money, the roster, the numbers, the settings.
    const forbidden = ["billing", "team", "members", "numbers", "settings", "admin", "*"];
    for (const scope of API_KEY_SCOPES) {
      for (const word of forbidden) {
        expect(scope, `${scope} reaches ${word}`).not.toContain(word);
      }
    }
  });

  it("recognises its own scopes and refuses near-misses", () => {
    for (const scope of API_KEY_SCOPES) expect(isApiKeyScope(scope)).toBe(true);
    expect(isApiKeyScope("contacts:delete")).toBe(false);
    expect(isApiKeyScope("Contacts:Read")).toBe(false);
    expect(isApiKeyScope("*")).toBe(false);
    expect(isApiKeyScope("")).toBe(false);
  });

  it("derives a distinct label key per scope", () => {
    expect(apiKeyScopeLabelKey("messages:send")).toBe("apiKeys.scope.messagesSend");
    expect(apiKeyScopeLabelKey("contacts:read")).toBe("apiKeys.scope.contactsRead");
    const keys = API_KEY_SCOPES.map(apiKeyScopeLabelKey);
    expect(new Set(keys).size).toBe(API_KEY_SCOPES.length);
  });
});

describe("what a key is allowed to do", () => {
  it("permits exactly what was granted", () => {
    expect(apiKeyAllows(["tasks:write"], "tasks:write")).toBe(true);
    expect(apiKeyAllows(["tasks:write", "contacts:read"], "contacts:read")).toBe(true);
    expect(apiKeyAllows([], "tasks:write")).toBe(false);
  });

  it("does not let write imply read, or read imply anything", () => {
    // THE ONE THAT MATTERS. An implication table is where least privilege
    // quietly stops being least: a key that may create a contact has no
    // business enumerating the customer list.
    expect(apiKeyAllows(["contacts:write"], "contacts:read")).toBe(false);
    expect(apiKeyAllows(["contacts:read"], "contacts:write")).toBe(false);
    // And reading threads must never imply speaking on the workspace's number.
    expect(apiKeyAllows(["conversations:read", "messages:read"], "messages:send")).toBe(
      false,
    );
  });
});

describe("the token shape", () => {
  it("carries a prefix a scanner can find", () => {
    expect(API_KEY_PREFIX).toBe("lnx_");
    // The displayed stub is long enough to tell three keys apart and far short
    // of enough to guess the rest.
    expect(API_KEY_DISPLAY_CHARS).toBe(12);
    expect(API_KEY_DISPLAY_CHARS).toBeLessThan(API_KEY_SECRET_BYTES);
  });

  it("has enough entropy that guessing is not a threat", () => {
    expect(API_KEY_SECRET_BYTES).toBeGreaterThanOrEqual(32);
  });

  it("keeps the caps meaningful rather than decorative", () => {
    expect(API_KEY_CAP).toBe(10);
    expect(API_KEY_REQUESTS_PER_MINUTE).toBeGreaterThan(0);
  });
});

describe("the version promise", () => {
  it("puts the version in the path, so a v2 can exist beside v1", () => {
    // A public API without a stated compatibility policy makes the first
    // breaking change a support incident. The path is the cheapest half of the
    // policy, and it has to be there from the first request.
    expect(PUBLIC_API_VERSION).toBe("v1");
    expect(PUBLIC_API_BASE).toBe("/public/v1");
    expect(PUBLIC_API_BASE.endsWith(PUBLIC_API_VERSION)).toBe(true);
  });

  it("does not collide with the first-party surface", () => {
    // `/v1` is the app's own API, authenticated with a member session. The
    // public surface is a different door with a different credential, and a
    // shared prefix is how a key ends up reaching a route nobody scoped.
    expect(PUBLIC_API_BASE.startsWith("/v1")).toBe(false);
  });
});
