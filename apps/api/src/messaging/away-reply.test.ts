/**
 * After-hours / away auto-reply (FEATURE-GAPS Step 1). Fires ONE owner-authored
 * away message when away_enabled AND outside company business hours AND the
 * shared guard passes; skips when disabled, unauthored, within business hours,
 * or on a STOP keyword. Merge-fields applied at send time. The only stubbed
 * thing is the network edge (global fetch).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import {
  messageRow,
  rpcMatch,
  restMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { maybeSendAwayReply } from "./away-reply";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const NUMBER = "+16135550100";
const CONTACT = "+16135551000";

// Company business hours 08:00–17:00 America/Toronto, Mon–Fri.
const BUSINESS_HOURS = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
};
// 2026-07-01 is a Wednesday. 03:00Z → 23:00 Tue Toronto (after-hours).
const AFTER_HOURS = new Date("2026-07-01T03:00:00.000Z");
// 16:00Z → 12:00 Wed Toronto (open).
const OPEN_HOURS = new Date("2026-07-01T16:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** companies row for the away-settings lookup (select includes away_enabled). */
function awayCompanyStub(overrides: {
  away_enabled?: boolean;
  away_message?: string | null;
  business_hours?: unknown;
  google_review_link?: string | null;
} = {}): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => url.searchParams.get("select")?.includes("away_enabled") ?? false,
    ),
    () => [
      {
        timezone: "America/Toronto",
        business_hours: overrides.business_hours ?? BUSINESS_HOURS,
        away_enabled: overrides.away_enabled ?? true,
        away_message:
          "away_message" in overrides
            ? overrides.away_message
            : "Hi {first_name}, thanks for texting {business_name}. For an emergency reply URGENT.",
        name: "Ace Plumbing",
        google_review_link: overrides.google_review_link ?? null,
      },
    ],
  );
}

/** The conversation lookup the away branch does (from number + contact). */
function convStub(): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "conversations",
      (url) => url.searchParams.get("select")?.includes("phone_numbers") ?? false,
    ),
    () => [
      {
        id: CONVERSATION_ID,
        phone_numbers: { number_e164: NUMBER, status: "active" },
        contacts: { name: "Dana Whitfield", phone_e164: CONTACT },
      },
    ],
  );
}

/** getSendGates: registration companies select + messaging_registrations. */
function sendGateStubs(): Stub[] {
  const gatesCompany = stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) =>
        url.searchParams.get("select")?.includes("subscription_status") ??
        false,
    ),
    () => [
      {
        id: COMPANY_ID,
        name: "Ace Plumbing",
        country: "CA",
        us_texting_enabled: true,
        subscription_status: "active",
      },
    ],
  );
  const registrations = stubRoute(
    restMatch(env, "GET", "messaging_registrations"),
    () => [],
  );
  return [gatesCompany, registrations];
}

function telnyxStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: "telnyx-away-1" } }),
  );
}

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function call(triggerBody = "no hot water", atUtc = AFTER_HOURS) {
  const db = getDb(env);
  return maybeSendAwayReply(env, db, {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    fromE164: CONTACT,
    triggerBody,
    atUtc,
  });
}

describe("maybeSendAwayReply — fires after hours", () => {
  it("sends one merged away message via the guard when after-hours + enabled", async () => {
    const company = awayCompanyStub();
    const conv = convStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return { message: messageRow({ status: "queued" }) };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-away-1" })],
    );
    serve(company, conv, ...gates, claim, telnyx, persist);

    await call();

    // The claim RPC got the MERGE-APPLIED body ({first_name}/{business_name}).
    expect(claim.calls).toHaveLength(1);
    expect(claimBody?.p_body).toBe(
      "Hi Dana, thanks for texting Ace Plumbing. For an emergency reply URGENT.",
    );
    // Dispatched via Telnyx from the company number to the contact.
    expect(telnyx.calls).toHaveLength(1);
    expect(telnyx.calls[0].body).toMatchObject({ from: NUMBER, to: CONTACT });
  });
});

describe("maybeSendAwayReply — skips", () => {
  it("does nothing when away is disabled (no further lookups)", async () => {
    const company = awayCompanyStub({ away_enabled: false });
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    serve(company, claim);
    await call();
    expect(claim.calls).toHaveLength(0);
  });

  it("does nothing when enabled but the message is unauthored", async () => {
    const company = awayCompanyStub({ away_message: null });
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    serve(company, claim);
    await call();
    expect(claim.calls).toHaveLength(0);
  });

  it("does nothing during business hours (company-local clock)", async () => {
    const company = awayCompanyStub();
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    serve(company, claim);
    await call("no hot water", OPEN_HOURS);
    expect(claim.calls).toHaveLength(0);
  });

  it("does not fire on a STOP keyword even after-hours (guard blocks)", async () => {
    const company = awayCompanyStub();
    const conv = convStub();
    const gates = sendGateStubs();
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    serve(company, conv, ...gates, claim);
    await call("STOP");
    // The guard's keyword check runs before the RPC, so it is never called.
    expect(claim.calls).toHaveLength(0);
  });

  it("honors the opt-out mirror via the guard (RPC skips)", async () => {
    const company = awayCompanyStub();
    const conv = convStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({
      skipped: "recipient_opted_out",
    }));
    serve(company, conv, ...gates, claim, telnyx);
    await call();
    expect(claim.calls).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(0); // never dispatched to an opted-out contact
  });
});
