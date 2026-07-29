/**
 * #418 — the premises that gate a skipped check.
 *
 * Several of this codebase's most consequential decisions are gated on a
 * stated premise: a factual claim written in a comment, which justifies
 * relaxing or skipping something. The code is correct GIVEN the premise, and
 * nobody re-checks the premise, because it reads as established fact.
 *
 * That class is invisible to review. A reviewer reads "task cards never carry
 * a message snippet, so no filter is needed", finds the reasoning sound, and
 * approves — verifying it would mean opening a different file, in a different
 * language, to check a claim stated as settled. It is also self-reinforcing:
 * once written, the premise becomes the documentation, and the next author
 * builds on it. #417 was exactly that.
 *
 * The distinction this file is built on, from the issue: **explaining why you
 * did something is documentation; asserting a fact about other code in order
 * to skip a check is a dependency.** The first is free. The second should be
 * tested like any other dependency.
 *
 * So each test below quotes the premise it protects and asserts the claim
 * against the code that has to keep being true. The day someone changes that
 * code, the premise fails loudly here instead of quietly becoming a leak.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE, AND WHY.
 *
 * Premises about the OUTSIDE WORLD — carrier rules, provider costs, what a
 * "legitimate" volume looks like — cannot be pinned by a test, because the
 * thing that changes is not in this repository. Those need a dated review
 * (#403), not an assertion, and the ones sized for a normal day are #401's
 * subject rather than this file's.
 */
import { describe, expect, it, vi } from "vitest";

import { scrubProperties } from "./analytics/posthog";
import { levelFromRules } from "./auth/number-access";
import { sanitizeWithReport } from "./messaging/reply-suggestions";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe("premise: no PII reaches third-party telemetry (analytics/posthog.ts)", () => {
  // > "distinct_id is ALWAYS the company_id — never a person, never PII
  // >  (SPEC §10: no message bodies, emails, or phone numbers in third-party
  // >  telemetry)."
  //
  // The first half is guaranteed by the signature. The second half was the
  // premise: `properties` was `Record<string, unknown>` and every caller
  // happened to pass an enumeration. Nothing made that true.

  it("keeps the enumerations the funnel events actually send", () => {
    // The four live call sites pass exactly these shapes. A guard that broke
    // them would have traded a hypothetical leak for a real loss of the
    // north-star funnel.
    expect(scrubProperties("checkout_completed", { plan: "pro" })).toEqual({
      plan: "pro",
    });
    expect(scrubProperties("registration_submitted", { action: "submitted" })).toEqual({
      action: "submitted",
    });
  });

  it("keeps numbers and booleans, which cannot carry a person", () => {
    expect(scrubProperties("e", { count: 3, ok: true })).toEqual({ count: 3, ok: true });
  });

  it("drops a phone number whatever the key is called", () => {
    // Shape-based, not key-based: a blocklist of key names catches the
    // careless author and misses the one who writes { contact: "+1613…" }.
    expect(scrubProperties("e", { contact: "+16135551234" })).toEqual({});
    expect(scrubProperties("e", { who: "(613) 555-1234" })).toEqual({});
  });

  it("drops an email address", () => {
    expect(scrubProperties("e", { owner: "dana@brightside.example" })).toEqual({});
  });

  it("drops free text, which is what a message body looks like", () => {
    const body = "basement is flooding, 42 Elm Street, back door code is 4417";
    expect(scrubProperties("e", { note: body })).toEqual({});
  });

  it("never repeats the offending value into the report", async () => {
    // Reporting a leak by echoing it into a DIFFERENT third party would be
    // worse than the leak. The message names the key and the offence only.
    const Sentry = await import("@sentry/cloudflare");
    vi.mocked(Sentry.captureMessage).mockClear();
    scrubProperties("e", { owner: "dana@brightside.example" });

    const [message] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(message).toContain("owner");
    expect(message).toContain("email address");
    expect(message).not.toContain("dana@brightside.example");
  });

  it("separates prose from enumerations by word count, not by length", () => {
    // The rule that does the work. A cap on LENGTH alone is arbitrary and a
    // short message slips under any cap generous enough to allow a real
    // value; every property this codebase sends is a single token.
    expect(scrubProperties("e", { action: "first_outbound_sent" })).toEqual({
      action: "first_outbound_sent",
    });
    expect(scrubProperties("e", { note: "pipe burst at 42 Elm" })).toEqual({});
  });

  it("drops only the offending key, keeping the rest of the event", () => {
    expect(scrubProperties("e", { plan: "pro", owner: "d@e.example" })).toEqual({
      plan: "pro",
    });
  });
});

describe("premise: an unruled or NULL number stays visible (auth/number-access.ts)", () => {
  // > "null = unrestricted … Otherwise the numbers HIDDEN from the caller — a
  // >  DENY list, so an un-ruled, released, or NULL number is always visible
  // >  (consistent with levelFor, which returns 'none' only for a
  // >  ruled-and-unmatched number)."
  //
  // This premise gates an access-control shape: the resolver builds a deny
  // list rather than an allow list, and never fetches phone_numbers at all.
  // If `levelFromRules` ever returned "none" for an unruled number, the deny
  // list would be missing entries it believes it does not need — a silent
  // over-exposure with no error anywhere.
  //
  // The resolver's own suite already pins levelFor(null) under BOTH an
  // unrestricted and a restricted view. What is added here is the pure rule
  // underneath it, which is what would actually change.

  it("no rules means full use, which is what makes a deny list sound", () => {
    expect(levelFromRules([], "user-1", "member")).toBe("text");
  });

  it("returns 'none' ONLY when rules exist and none match", () => {
    const ruled = [
      {
        phone_number_id: "n1",
        principal_kind: "user" as const,
        principal: "somebody-else",
        level: "text" as const,
      },
    ];
    expect(levelFromRules(ruled, "user-1", "member")).toBe("none");
    // …and the same rule set matches its own principal.
    expect(levelFromRules(ruled, "somebody-else", "member")).toBe("text");
  });
});

describe("premise: the AI sanitation tally carries no message text (messaging/reply-suggestions.ts)", () => {
  // > "Counts carry no message text, so they are safe to hand back to the
  // >  workspace that asked."
  //
  // This premise justifies returning the tally to the client at all. It is
  // true today because every field of `dropped` is a number — but that is a
  // property of the shape, and the shape is the thing a future author would
  // change when they want to know WHICH draft was dropped. The obvious next
  // step ("add an examples array") is exactly what this forbids.

  it("every reason in the tally is a count, never an example", () => {
    const report = sanitizeWithReport(
      [
        "", // empty
        "Call us on +1 613 555 1234", // phone
        "Sure, we can do that.", // kept
        "Sure, we can do that.", // duplicate
      ],
      { threadText: "Can you come Thursday?" },
    );

    for (const [reason, value] of Object.entries(report.dropped)) {
      expect(typeof value, `dropped.${reason} must be a count, not text`).toBe("number");
    }
  });
});
