/**
 * Env-schema suite for the email-hardening bindings (the broader validation
 * behavior — memoization, loud failures, key naming — is covered in
 * app.test.ts). These two are OPTIONAL by design: unset must parse cleanly
 * (silent no-op), set must round-trip, and an empty string must fail loudly
 * instead of shipping a blank Reply-To or a disabled-but-looks-enabled
 * Turnstile check.
 */
import { describe, expect, it } from "vitest";

import { getEnv, type Bindings } from "./env";
import { completeEnv } from "./test/support";

function bindings(overrides: Record<string, unknown> = {}): Bindings {
  return { ...completeEnv(), ...overrides };
}

describe("RESEND_REPLY_TO (optional)", () => {
  it("parses when unset (no Reply-To sent — pre-hardening behavior)", () => {
    const env = getEnv(bindings());
    expect(env.RESEND_REPLY_TO).toBeUndefined();
  });

  it("round-trips a configured value", () => {
    const env = getEnv(
      bindings({ RESEND_REPLY_TO: "Loonext Support <support@loonext.com>" }),
    );
    expect(env.RESEND_REPLY_TO).toBe("Loonext Support <support@loonext.com>");
  });

  it("rejects an empty string, naming the key", () => {
    expect(() => getEnv(bindings({ RESEND_REPLY_TO: "" }))).toThrowError(
      /RESEND_REPLY_TO/,
    );
  });
});

describe("TURNSTILE_SECRET_KEY (optional)", () => {
  it("parses when unset (contact endpoint requires no captcha token)", () => {
    const env = getEnv(bindings());
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined();
  });

  it("round-trips a configured secret", () => {
    const env = getEnv(
      bindings({ TURNSTILE_SECRET_KEY: "0x4AAAAAAASecret0123456789" }),
    );
    expect(env.TURNSTILE_SECRET_KEY).toBe("0x4AAAAAAASecret0123456789");
  });

  it("rejects an empty string, naming the key", () => {
    expect(() => getEnv(bindings({ TURNSTILE_SECRET_KEY: "" }))).toThrowError(
      /TURNSTILE_SECRET_KEY/,
    );
  });
});
