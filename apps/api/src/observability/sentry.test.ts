import type { ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";

import { completeEnv } from "../test/support";
import { redactPhones, scrubBreadcrumb, scrubEvent, sentryOptions } from "./sentry";

const PHONE = "+14165551234";

function syntheticEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `send failed for ${PHONE}`,
    logentry: { message: `could not deliver to ${PHONE}` },
    exception: {
      values: [
        {
          type: "Error",
          value: `Telnyx rejected destination ${PHONE} (error code 40300)`,
        },
      ],
    },
    breadcrumbs: [
      {
        message: `dialing 14165551234 then 4165551234567`,
        data: {
          to: PHONE,
          contact_name: "Jane Doe",
          displayName: "Jane Doe",
          nested: { numbers: [PHONE, "+12125550000"] },
        },
      },
    ],
    request: {
      url: `https://api.loonext.com/v1/contacts?phone=${encodeURIComponent(PHONE)}`,
      method: "POST",
      query_string: `q=${PHONE}`,
      cookies: { session: "abc" },
      headers: { "content-type": "application/json", "x-note": PHONE },
      data: `{"body":"hi, call me at ${PHONE}","name":"Jane Doe"}`,
    },
    user: { id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01", username: "Jane Doe", email: "jane@example.com" },
    extra: { note: `customer at ${PHONE}`, customer_name: "Jane Doe" },
    tags: { destination: PHONE },
  } as ErrorEvent;
}

describe("redactPhones (SPEC §10 E.164 pattern)", () => {
  it("redacts +1-prefixed, bare-11-digit, and long international runs", () => {
    expect(redactPhones(`a ${PHONE} b`)).toBe("a [phone redacted] b");
    expect(redactPhones("14165551234")).toBe("[phone redacted]");
    expect(redactPhones("4165551234567")).toBe("[phone redacted]");
    expect(redactPhones("+442071234567")).toBe("[phone redacted]");
  });

  it("leaves short digit runs and ids alone", () => {
    expect(redactPhones("error code 40300")).toBe("error code 40300");
    expect(redactPhones("id 123456789")).toBe("id 123456789");
    expect(redactPhones("6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01")).toBe(
      "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
    );
  });
});

describe("scrubEvent (SPEC §10: no bodies, names, or phone numbers reach Sentry)", () => {
  it("provably strips the phone number and the request body from a synthetic event", () => {
    const scrubbed = scrubEvent(syntheticEvent());
    const serialized = JSON.stringify(scrubbed);

    // The E.164 number is gone from every corner of the event.
    expect(serialized).not.toContain("14165551234");
    expect(serialized).not.toContain("4165551234567");
    expect(serialized).not.toContain("12125550000");

    // The request body (which embedded the message text) was dropped outright.
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.query_string).toBeUndefined();
    // The full request URL keeps only origin + path — its query string (which
    // mirrors the deleted query_string: search terms, addresses, numbers) is
    // dropped, not merely phone-redacted.
    expect(scrubbed.request?.url).toBe("https://api.loonext.com/v1/contacts");
    expect(serialized).not.toContain("hi, call me at");

    // Contact names are stripped everywhere.
    expect(serialized).not.toContain("Jane");
    expect(scrubbed.user).toEqual({ id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01" });

    // Redaction markers replaced the phones in messages/exceptions/breadcrumbs.
    expect(scrubbed.message).toBe("send failed for [phone redacted]");
    expect(scrubbed.exception?.values?.[0]?.value).toContain("[phone redacted]");
    expect(scrubbed.exception?.values?.[0]?.value).toContain("40300");
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe(
      "dialing [phone redacted] then [phone redacted]",
    );
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      to: "[phone redacted]",
      contact_name: "[name redacted]",
      displayName: "[name redacted]",
      nested: { numbers: ["[phone redacted]", "[phone redacted]"] },
    });
  });

  it("keeps non-PII diagnostics intact", () => {
    const scrubbed = scrubEvent(syntheticEvent());
    expect(scrubbed.request?.method).toBe("POST");
    expect(scrubbed.request?.headers?.["content-type"]).toBe("application/json");
    expect(scrubbed.exception?.values?.[0]?.type).toBe("Error");
  });

  it("drops a user with no id entirely", () => {
    const event = syntheticEvent();
    event.user = { email: "jane@example.com" };
    expect(scrubEvent(event).user).toBeUndefined();
  });
});

describe("scrubBreadcrumb (beforeBreadcrumb defense-in-depth)", () => {
  it("redacts phones in message and data", () => {
    const crumb = scrubBreadcrumb({
      message: `sms to ${PHONE}`,
      data: { name: "Jane" },
    });
    expect(crumb.message).toBe("sms to [phone redacted]");
    expect(crumb.data).toEqual({ name: "[name redacted]" });
  });
});

describe("sentryOptions", () => {
  it("wires the DSN from env with PII off and the scrubbers installed", () => {
    const env = completeEnv();
    const options = sentryOptions(env);
    expect(options.dsn).toBe(env.SENTRY_DSN);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("fails loudly on a misconfigured environment", () => {
    const env: Record<string, unknown> = { ...completeEnv() };
    delete env.SENTRY_DSN;
    expect(() => sentryOptions(env)).toThrowError(/SENTRY_DSN/);
  });
});
