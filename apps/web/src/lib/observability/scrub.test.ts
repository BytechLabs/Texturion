import type { ErrorEvent } from "@sentry/browser";
import { describe, expect, it } from "vitest";

import {
  redactPhones,
  scrubBreadcrumb,
  scrubEvent,
  stripQueryAndHash,
} from "./scrub";

const PHONE = "+14165551234";
// A user-typed search term: not digit-shaped, so no redaction pattern can
// catch it — it must be STRIPPED with the query string it travels in.
const SEARCH_TERM = "Jane Doe";

// Browser-shaped synthetic event: page URL + fetch/navigation breadcrumbs
// instead of a Worker request, but the same PII corners the API suite proves
// clean (apps/api/src/observability/sentry.test.ts — keep the two in sync).
function syntheticEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `send failed for ${PHONE}`,
    logentry: { message: `could not deliver to ${PHONE}` },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `Failed to fetch /v1/messages/send for ${PHONE} (error code 40300)`,
        },
      ],
    },
    breadcrumbs: [
      {
        category: "fetch",
        message: `dialing 14165551234 then 4165551234567`,
        data: {
          // Search-as-you-type: the palette fires GET /v1/search?q=<term>
          // per keystroke, and the default breadcrumbsIntegration records
          // the full request URL.
          url: `https://api.loonext.com/v1/search?q=${encodeURIComponent(SEARCH_TERM)}&phone=${encodeURIComponent(PHONE)}`,
          to: PHONE,
          contact_name: "Jane Doe",
          displayName: "Jane Doe",
          nested: { numbers: [PHONE, "+12125550000"] },
        },
      },
      {
        category: "navigation",
        data: {
          // Inbox filters serialize into the URL, so navigation breadcrumbs
          // carry the typed term in from/to.
          from: `/inbox?q=${encodeURIComponent(SEARCH_TERM)}`,
          to: `/contacts?q=${encodeURIComponent(PHONE)}#results`,
        },
      },
    ],
    request: {
      // location.href while an inbox search is active: the typed term
      // round-trips through ?q= (filter-url.ts serializeInboxFilters).
      url: `https://app.loonext.com/inbox?q=${encodeURIComponent(`${SEARCH_TERM} ${PHONE}`)}`,
      query_string: `q=${SEARCH_TERM} ${PHONE}`,
      cookies: { session: "abc" },
      headers: {
        "User-Agent": "vitest",
        "x-note": PHONE,
        Referer: `https://app.loonext.com/contacts?q=${encodeURIComponent(SEARCH_TERM)}`,
      },
      data: `{"body":"hi, call me at ${PHONE}","name":"Jane Doe"}`,
    },
    user: {
      id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
      username: "Jane Doe",
      email: "jane@example.com",
    },
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

  it("catches URL-encoded numbers inside URLs", () => {
    expect(redactPhones("/v1/contacts?phone=%2B14165551234")).toBe(
      "/v1/contacts?phone=[phone redacted]",
    );
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
    expect(serialized).not.toContain("hi, call me at");

    // Contact names are stripped everywhere.
    expect(serialized).not.toContain("Jane");
    expect(scrubbed.user).toEqual({
      id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
    });

    // Redaction markers replaced the phones in messages/exceptions/breadcrumbs.
    expect(scrubbed.message).toBe("send failed for [phone redacted]");
    expect(scrubbed.exception?.values?.[0]?.value).toContain("[phone redacted]");
    expect(scrubbed.exception?.values?.[0]?.value).toContain("40300");
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe(
      "dialing [phone redacted] then [phone redacted]",
    );
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      url: "https://api.loonext.com/v1/search",
      to: "[phone redacted]",
      contact_name: "[name redacted]",
      displayName: "[name redacted]",
      nested: { numbers: ["[phone redacted]", "[phone redacted]"] },
    });
  });

  it("strips typed search terms from every URL-carrying field (D8: names are not digit-shaped)", () => {
    const scrubbed = scrubEvent(syntheticEvent());
    const serialized = JSON.stringify(scrubbed);

    // The typed term is gone in every encoding it travels as.
    expect(serialized).not.toContain("Jane");
    expect(serialized).not.toContain(encodeURIComponent(SEARCH_TERM));

    // (1) event.request.url is location.href — ?q=<term> is cut, path kept.
    expect(scrubbed.request?.url).toBe("https://app.loonext.com/inbox");

    // (2) fetch/XHR breadcrumbs record the full search request URL.
    expect(scrubbed.breadcrumbs?.[0]?.data?.url).toBe(
      "https://api.loonext.com/v1/search",
    );

    // (3) navigation breadcrumbs carry from/to including query strings.
    expect(scrubbed.breadcrumbs?.[1]?.data).toEqual({
      from: "/inbox",
      to: "/contacts",
    });

    // The Referer header is a URL too.
    expect(scrubbed.request?.headers?.["Referer"]).toBe(
      "https://app.loonext.com/contacts",
    );
  });

  it("still phone-redacts URL path segments after the query is cut", () => {
    const event = syntheticEvent();
    event.request = { url: `https://app.loonext.com/contacts/${PHONE}?tab=notes` };
    expect(scrubEvent(event).request?.url).toBe(
      "https://app.loonext.com/contacts/[phone redacted]",
    );
  });

  it("keeps non-PII diagnostics intact", () => {
    const scrubbed = scrubEvent(syntheticEvent());
    expect(scrubbed.request?.headers?.["User-Agent"]).toBe("vitest");
    expect(scrubbed.exception?.values?.[0]?.type).toBe("TypeError");
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

  it("cuts query strings from url/from/to before the crumb is stored", () => {
    const fetchCrumb = scrubBreadcrumb({
      category: "fetch",
      data: { url: "https://api.loonext.com/v1/search?q=Jane%20Doe", method: "GET" },
    });
    expect(fetchCrumb.data).toEqual({
      url: "https://api.loonext.com/v1/search",
      method: "GET",
    });

    const navCrumb = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/inbox?q=Jane+Doe", to: "/inbox?q=Jane+Doe&page=2" },
    });
    expect(navCrumb.data).toEqual({ from: "/inbox", to: "/inbox" });
  });
});

describe("stripQueryAndHash (shared with lib/analytics/posthog.ts)", () => {
  it("cuts at the first ? or #, and passes clean URLs through", () => {
    expect(stripQueryAndHash("/inbox?q=Jane#top")).toBe("/inbox");
    expect(stripQueryAndHash("https://x.test/p#frag")).toBe("https://x.test/p");
    expect(stripQueryAndHash("/contacts")).toBe("/contacts");
  });
});
