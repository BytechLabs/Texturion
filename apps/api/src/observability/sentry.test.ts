import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";

import { completeEnv } from "../test/support";
import {
  redactPhones,
  redactTokenPaths,
  scrubBreadcrumb,
  scrubEvent,
  sentryOptions,
  TOKEN_PATH_PREFIXES,
} from "./sentry";

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

  it("never ships the caller's credentials with a crash report", () => {
    // The token is live for up to an hour: anyone who could read the Sentry
    // project could replay it and act as that user.
    const event = syntheticEvent();
    event.request = {
      ...event.request,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.super-secret.signature",
        cookie: "sb-ref-auth-token.0=base64-abc",
        "x-api-key": "sk_live_do_not_leak",
        "cf-ray": "a208ca93afb050df-YVR",
      },
    };
    const headers = scrubEvent(event).request?.headers as Record<string, string>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers.cookie).toBe("[redacted]");
    expect(headers["x-api-key"]).toBe("[redacted]");
    // Still says WHICH headers were present, and keeps the ones that help.
    expect(Object.keys(headers)).toContain("authorization");
    expect(headers["cf-ray"]).toBe("a208ca93afb050df-YVR");
  });

  it("redacts an unknown header by default rather than on a list", () => {
    // A denylist leaks every new credential header until someone remembers it.
    const event = syntheticEvent();
    event.request = {
      ...event.request,
      headers: { "x-some-future-token": "secret-value" },
    };
    const headers = scrubEvent(event).request?.headers as Record<string, string>;
    expect(headers["x-some-future-token"]).toBe("[redacted]");
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

  it("sends nothing from a Worker marked as local", () => {
    const options = sentryOptions({ ...completeEnv(), LOCAL_DEV: "1" });
    expect(options.dsn).toBeUndefined();
  });

  it("reports from every deployed Worker, stamped or not", () => {
    // Silencing is driven by the PRESENCE of the local marker, never by the
    // absence of a release stamp: a manual `wrangler deploy` carries no GIT_SHA
    // and must still report, or production goes dark the one time someone
    // deploys by hand.
    const manual: Record<string, unknown> = { ...completeEnv() };
    delete manual.GIT_SHA;
    const options = sentryOptions(manual);
    expect(options.dsn).toBe(completeEnv().SENTRY_DSN);
    expect(options.environment).toBe("development");
  });

  it("refuses a local marker that is not exactly the documented value", () => {
    // A typo must not read as "somewhat local" and quietly disable reporting.
    expect(() => sentryOptions({ ...completeEnv(), LOCAL_DEV: "true" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// #558 — this Worker serves GET /photos/:token, so the path IS the secret
// ---------------------------------------------------------------------------

/**
 * The SHAPE of a token D75 mints — 43 base64url characters — with none of the
 * entropy. Built rather than written: a realistic literal is indistinguishable
 * from a leaked one, and the secret scanner flagged the first version of this
 * line, correctly.
 */
const SHARE_TOKEN = `not-a-real-token-${"x".repeat(26)}`;

describe("#558 a tokenised path never reaches Sentry in full", () => {
  it("redacts the segment after each declared prefix", () => {
    expect(redactTokenPaths(`/photos/${SHARE_TOKEN}`)).toBe("/photos/[token]");
    expect(redactTokenPaths(`/invite/${SHARE_TOKEN}`)).toBe("/invite/[token]");
  });

  it("scrubs request.url on the route this Worker actually answers", () => {
    // An error inside GET /photos/:token used to put the live token in Sentry,
    // where it stays after the crew revokes the link.
    const event = scrubEvent({
      request: { url: `https://api.loonext.com/photos/${SHARE_TOKEN}` },
    } as ErrorEvent);
    expect(event.request?.url).toBe("https://api.loonext.com/photos/[token]");
    expect(JSON.stringify(event)).not.toContain(SHARE_TOKEN);
  });

  it("redacts a token that opens with a phone-shaped digit run", () => {
    // Why tokens go before phones: the phone pattern would eat the leading
    // digits and leave the rest of the secret — a partial redaction that reads
    // like a finished one.
    const event = scrubEvent({
      request: { url: `https://api.loonext.com/photos/4165551234${SHARE_TOKEN}` },
    } as ErrorEvent);
    expect(event.request?.url).toBe("https://api.loonext.com/photos/[token]");
  });

  it("leaves a prefix with no token after it alone", () => {
    expect(redactTokenPaths("/photos")).toBe("/photos");
    expect(redactTokenPaths("/inbox/job-photos-guide")).toBe(
      "/inbox/job-photos-guide",
    );
  });

  it("covers every public token route this Worker mounts", () => {
    // Derived from the router rather than restated: a new public `:token` route
    // with no redaction rule fails here instead of in a vendor's dashboard.
    const source = readFileSync(join(__dirname, "../routes/job-photos.ts"), "utf8");
    const mounted = [...source.matchAll(/\.get\(\s*"\/([a-z0-9-]+)\/:token"/g)].map(
      (match) => match[1],
    );
    expect(mounted, "no public :token route found — this guard lost its subject")
      .not.toHaveLength(0);
    for (const prefix of mounted) {
      expect(
        TOKEN_PATH_PREFIXES as readonly string[],
        `GET /${prefix}/:token has no redaction rule — its token would reach Sentry in full (#558)`,
      ).toContain(prefix);
    }
  });
});

// ---------------------------------------------------------------------------
// #581 — fetchIntegration is a DEFAULT integration of @sentry/cloudflare and
// `sentryOptions` never overrides `integrations`, so EVERY outbound fetch wrote
// its full URL into `breadcrumb.data.url`, query string and all, attached to any
// event captured in the same isolate.
// ---------------------------------------------------------------------------

/**
 * The SHAPE of the AWS SigV4 signature Telnyx puts on a saved recording, with
 * none of the entropy — built from a readable stem for the same reason
 * SHARE_TOKEN is, and because the secret scan reads all history.
 */
const RECORDING_SIGNATURE = `not-a-real-signature-${"a".repeat(24)}`;

/**
 * The five outbound calls this Worker makes with a customer's data in the query
 * string, each read off its call site rather than imagined: geocode/nominatim.ts
 * (`/search?q=`), geocode/geocode-contacts.ts (the conditional write-back keyed
 * on the captured address), routes/contacts.ts (`contactSearchOr`),
 * email/resend.ts (`filterSuppressed`, which runs before every send), and
 * messaging/inbound-ring.ts (`storeVoicemailRecording`).
 *
 * `secret` is the substring that must not survive anywhere in the crumb, and it
 * is a name, an address, an email or a credential in every case — never a digit
 * run, which is the point: `redactPhones` could not have found any of them.
 */
const FETCH_SINKS: readonly (readonly [
  what: string,
  url: string,
  secret: string,
  cut: string,
])[] = [
  [
    "the geocoder's copy of a customer's street address",
    "https://nominatim.openstreetmap.org/search?q=140+Maple+Ave%2C+Springfield&format=json&limit=1&countrycodes=us%2Cca",
    "Maple",
    "https://nominatim.openstreetmap.org/search",
  ],
  [
    "the same address again as a PostgREST write-back filter",
    "https://ref.supabase.co/rest/v1/contacts?id=eq.6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01&address=eq.140+Maple+Ave",
    "Maple",
    "https://ref.supabase.co/rest/v1/contacts",
  ],
  [
    "the term a crew member typed into contact search",
    "https://ref.supabase.co/rest/v1/contacts?select=id&or=%28name.ilike.%2AAlvarez%2A%2Cemail.ilike.%2AAlvarez%2A%29",
    "Alvarez",
    "https://ref.supabase.co/rest/v1/contacts",
  ],
  [
    "the recipient addresses checked before every email send",
    "https://ref.supabase.co/rest/v1/email_suppressions?select=email&email=in.%28maria%40example.com%29&cleared_at=is.null",
    "maria%40example.com",
    "https://ref.supabase.co/rest/v1/email_suppressions",
  ],
  [
    "the presigned URL that IS the credential for a customer's recorded voice",
    "https://s3.amazonaws.com/telephony-recorder-prod/rec-c0ffee.mp3" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=not-a-real-key%2F20260809%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260809T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=host" +
      `&X-Amz-Signature=${RECORDING_SIGNATURE}`,
    RECORDING_SIGNATURE,
    "https://s3.amazonaws.com/telephony-recorder-prod/rec-c0ffee.mp3",
  ],
] as const;

describe("#581 an outbound fetch breadcrumb never carries its query string", () => {
  it.each(FETCH_SINKS)("cuts %s", (_what, url, secret, cut) => {
    // The exact crumb fetchIntegration writes: { method, url, status_code }.
    const crumb = scrubBreadcrumb({
      category: "fetch",
      type: "http",
      data: { method: "GET", url, status_code: 500 },
    });
    const data = crumb.data as Record<string, unknown>;
    expect(data.url).toBe(cut);
    expect(JSON.stringify(crumb)).not.toContain(secret);
    // Origin, path, method and status all survive: the crumb is scrubbed rather
    // than switched off because with tracesSampleRate 0 it is the ONLY record of
    // which upstream call preceded the crash (see sentryOptions).
    expect(data.method).toBe("GET");
    expect(data.status_code).toBe(500);
  });

  it("cuts the same crumb on the way out with an event, not only on the way in", () => {
    // beforeBreadcrumb and beforeSend are independent hooks. A crumb added
    // before Sentry.init ran — or by anything that bypasses beforeBreadcrumb —
    // still ships inside event.breadcrumbs.
    const [, url, secret] = FETCH_SINKS[0];
    const event = scrubEvent({
      type: undefined,
      breadcrumbs: [{ category: "fetch", data: { method: "GET", url } }],
    } as ErrorEvent);
    expect(event.breadcrumbs?.[0]?.data?.url).toBe(
      "https://nominatim.openstreetmap.org/search",
    );
    expect(JSON.stringify(event)).not.toContain(secret);
  });

  it("cuts a URL-keyed value wherever it is parked, not just on a breadcrumb", () => {
    // `extra`, `tags` and `contexts` run through the same walker, so the rule
    // does not have to be restated per container.
    const [, url] = FETCH_SINKS[2];
    const event = scrubEvent({
      extra: { request_url: url },
      contexts: { upstream: { url } },
    } as unknown as ErrorEvent);
    expect(event.extra?.request_url).toBe(
      "https://ref.supabase.co/rest/v1/contacts",
    );
    expect(JSON.stringify(event)).not.toContain("Alvarez");
  });

  it("leaves the recording URL unreplayable, not merely tidier", () => {
    // The CHECK #581 asked for. Telnyx's link is an AWS SigV4 presigned URL and
    // SigV4 carries its signature in the query string, so the cut takes the
    // credential with it and what remains is a bucket path that answers 403. If
    // Telnyx ever moves to a path-embedded token this assertion still passes
    // while the credential ships — which is why TOKEN_PATH_PREFIXES exists for
    // the shape where the path IS the secret.
    const [, url] = FETCH_SINKS[4];
    const cut = scrubBreadcrumb({ data: { url } }).data?.url as string;
    expect(cut).not.toContain("X-Amz-Signature");
    expect(cut).not.toContain("X-Amz-Credential");
    expect(cut).not.toContain("X-Amz-Expires");
    expect(new URL(cut).search).toBe("");
  });

  it("still redacts a phone under a URL-shaped key", () => {
    // `to`/`from` are navigation keys in the browser twin and destination
    // numbers here. Both arms end in redactPhones, so adopting the twin's
    // pattern wholesale cannot under-redact — this is the case that proves it.
    expect(scrubBreadcrumb({ data: { to: PHONE } }).data?.to).toBe(
      "[phone redacted]",
    );
  });
});
