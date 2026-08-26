import { describe, expect, it } from "vitest";

import type { Env } from "../env";
import { completeEnv } from "../test/support";
import {
  calendarCallbackUri,
  calendarProviderIsConfigured,
  getCalendarProviderConfiguration,
} from "./config";

const KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

function env(overrides: Partial<Env> = {}): Env {
  return { ...completeEnv(), ...overrides };
}

describe("calendar connector configuration", () => {
  it("reports providers disabled when no credential group exists", () => {
    expect(calendarProviderIsConfigured(env(), "google")).toBe(false);
    expect(calendarProviderIsConfigured(env(), "microsoft")).toBe(false);
  });

  it("builds the fixed callback and versioned keyring", () => {
    const configured = env({
      GOOGLE_CALENDAR_CLIENT_ID: "google-id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      CALENDAR_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY }),
      CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
    });
    expect(calendarCallbackUri(configured, "google")).toBe(
      "https://api.loonext.com/calendar/oauth/google/callback",
    );
    expect(getCalendarProviderConfiguration(configured, "google")).toEqual({
      oauth: {
        clientId: "google-id",
        clientSecret: "google-secret",
        redirectUri: "https://api.loonext.com/calendar/oauth/google/callback",
      },
      keyring: { activeVersion: "v1", keys: { v1: KEY } },
    });
  });

  it("defaults Microsoft to the common tenant", () => {
    const configured = env({
      MICROSOFT_CALENDAR_CLIENT_ID: "microsoft-id",
      MICROSOFT_CALENDAR_CLIENT_SECRET: "microsoft-secret",
      CALENDAR_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY }),
      CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
    });
    expect(getCalendarProviderConfiguration(configured, "microsoft").tenant).toBe(
      "common",
    );
  });

  it("fails closed for a partial provider group or malformed keyring", () => {
    expect(() =>
      getCalendarProviderConfiguration(
        env({ GOOGLE_CALENDAR_CLIENT_ID: "only-an-id" }),
        "google",
      ),
    ).toThrow(/not configured/);

    expect(() =>
      calendarProviderIsConfigured(
        env({
          GOOGLE_CALENDAR_CLIENT_ID: "id",
          GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
          CALENDAR_TOKEN_ENCRYPTION_KEYS: '{"v1":"short"}',
          CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
        }),
        "google",
      ),
    ).toThrow(/32 bytes/);
  });
});
