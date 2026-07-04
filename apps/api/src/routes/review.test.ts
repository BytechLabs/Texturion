/**
 * Review-request one-tap action (FEATURE-GAPS Step 2): POST
 * /v1/conversations/:id/review-request. Requires a stored review link, applies
 * {review_link} at send time, routes through claim_review_request (opt-out +
 * one-per-job suppression), gates on quiet hours + thread recency (Step 0b/§3:
 * quiet hours apply to EVERY review send; a cold thread is a new outbound —
 * both 409 with compose's stable code until quiet_hours_confirmed), and
 * dispatches via Telnyx. Member-level.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { reviewRoutes } from "./review";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const REVIEW_LINK = "https://g.page/r/ace-plumbing/review";
// Contact is +1613… (America/Toronto), matching compose.test.ts:
// 2026-07-01T16:00Z → 12:00 local (daytime); 03:00Z → 23:00 local (quiet).
const DAYTIME = new Date("2026-07-01T16:00:00.000Z");
const NIGHTTIME = new Date("2026-07-01T03:00:00.000Z");
// Warm thread default: an inbound 2–15h before either pinned clock —
// comfortably inside the 72h reply window.
const FRESH_INBOUND_AT = "2026-07-01T01:00:00.000Z";
// Cold thread: the last inbound is 4 days before DAYTIME (> 72h window).
const STALE_INBOUND_AT = "2026-06-27T12:00:00.000Z";

let auth: TestAuth;
const app = buildTestApp(reviewRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function errorCodeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

function baseStub(overrides: {
  reviewLink?: string | null;
  contactName?: string | null;
  numberStatus?: string;
  noConversation?: boolean;
  /** Last inbound created_at for the recency check; null → no inbound ever. */
  lastInboundAt?: string | null;
} = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  // Conversation + contact + number + company view.
  sb.on("GET", "/rest/v1/conversations", () =>
    overrides.noConversation
      ? []
      : [
          {
            id: CONVERSATION_ID,
            contacts: {
              name: overrides.contactName ?? "Dana Whitfield",
              phone_e164: "+16135551000",
            },
            phone_numbers: {
              number_e164: "+16135550100",
              status: overrides.numberStatus ?? "active",
            },
            companies: {
              name: "Ace Plumbing",
              google_review_link:
                "reviewLink" in overrides ? overrides.reviewLink : REVIEW_LINK,
            },
          },
        ],
  );
  // Send gates: registration companies select + messaging_registrations.
  sb.on("GET", "/rest/v1/companies", (call) =>
    call.url.searchParams.get("select")?.includes("subscription_status")
      ? [
          {
            id: COMPANY_ID,
            name: "Ace Plumbing",
            country: "CA",
            us_texting_enabled: true,
            subscription_status: "active",
          },
        ]
      : undefined,
  );
  sb.on("GET", "/rest/v1/messaging_registrations", () => []);
  // Thread-recency lookup (Step 0b): the latest inbound message, if any.
  const lastInboundAt =
    "lastInboundAt" in overrides ? overrides.lastInboundAt : FRESH_INBOUND_AT;
  sb.on("GET", "/rest/v1/messages", () =>
    lastInboundAt === null || lastInboundAt === undefined
      ? []
      : [{ created_at: lastInboundAt }],
  );
  return sb;
}

/** Wire the claim RPC + dispatch persist so a gated-through send completes. */
function stubSuccessfulClaim(sb: SupabaseStub): {
  claimBody: () => Record<string, unknown> | undefined;
} {
  let claimBody: Record<string, unknown> | undefined;
  sb.on("POST", "/rest/v1/rpc/claim_review_request", (call) => {
    claimBody = call.body as Record<string, unknown>;
    return {
      message: {
        id: "aaaaaaaa-0000-4000-8000-00000000000a",
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        direction: "outbound",
        body: claimBody.p_body,
        status: "queued",
      },
    };
  });
  sb.on("PATCH", "/rest/v1/messages", () => [
    {
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      conversation_id: CONVERSATION_ID,
      telnyx_message_id: "telnyx-review-1",
      status: "queued",
    },
  ]);
  return { claimBody: () => claimBody };
}

function telnyxOk() {
  return (url: URL, request: Request) =>
    request.method === "POST" &&
    url.href === "https://api.telnyx.com/v2/messages"
      ? Response.json({ data: { id: "telnyx-review-1" } })
      : undefined;
}

describe("POST /conversations/:id/review-request", () => {
  it("sends the review ask with {review_link} merged, logs via the RPC, 201", async () => {
    // Warm thread (fresh inbound) at 12:00 destination time: no confirm
    // needed, no quiet-hours event — the clean one-tap path.
    const sb = baseStub();
    const claim = stubSuccessfulClaim(sb);
    stubFetch(jwksRoute(auth), telnyxOk(), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(201);
    // The default review ask, merged: {business_name} + {review_link} resolved.
    expect(claim.claimBody()?.p_body).toContain("Ace Plumbing");
    expect(claim.claimBody()?.p_body).toContain(REVIEW_LINK);
    expect(claim.claimBody()?.p_body).not.toContain("{review_link}");
    // No quiet-hours confirmation event on an unquiet, warm send.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("409s when the company has no review link stored", async () => {
    const sb = baseStub({ reviewLink: null });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("conflict");
  });

  it("409s (already requested) when the RPC suppresses a repeat ask", async () => {
    const sb = baseStub();
    sb.on("POST", "/rest/v1/rpc/claim_review_request", () => ({
      skipped: "already_requested",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("conflict");
  });

  it("403s when the RPC reports the recipient opted out", async () => {
    const sb = baseStub();
    sb.on("POST", "/rest/v1/rpc/claim_review_request", () => ({
      skipped: "recipient_opted_out",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("recipient_opted_out");
  });

  it("404s an unknown conversation", async () => {
    const sb = baseStub({ noConversation: true });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(404);
  });

  it("409s when the number is not ready to send", async () => {
    const sb = baseStub({ numberStatus: "provisioning" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/review-request`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(409);
  });
});

describe("review-request quiet hours + thread recency (FEATURE-GAPS Step 0b/§3)", () => {
  const post = (body: Record<string, unknown>) =>
    auth.token().then((token) =>
      apiRequest(
        app,
        env,
        token,
        `/v1/conversations/${CONVERSATION_ID}/review-request`,
        { method: "POST", companyId: COMPANY_ID, body },
      ),
    );

  it("409s an unconfirmed ask at 23:00 destination time, even on a warm thread", async () => {
    vi.setSystemTime(NIGHTTIME);
    const sb = baseStub(); // warm: fresh inbound 2h earlier
    stubFetch(jwksRoute(auth), telnyxOk(), sb.route);

    const res = await post({});
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("quiet_hours_confirmation_required");
    // Refused BEFORE the claim: the one-per-job suppression is not burned.
    expect(sb.find("POST", "/rest/v1/rpc/claim_review_request")).toHaveLength(0);
  });

  it("sends on quiet_hours_confirmed=true at night and logs the event", async () => {
    vi.setSystemTime(NIGHTTIME);
    const sb = baseStub();
    stubSuccessfulClaim(sb);
    const events: Record<string, unknown>[] = [];
    sb.on("POST", "/rest/v1/conversation_events", (call) => {
      events.push(...(call.body as Record<string, unknown>[]));
      return [];
    });
    stubFetch(jwksRoute(auth), telnyxOk(), sb.route);

    const res = await post({ quiet_hours_confirmed: true });
    expect(res.status).toBe(201);
    // Audit mirrors compose: the confirmation that gated the send is recorded.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "quiet_hours_confirmed",
      conversation_id: CONVERSATION_ID,
      // The actor is the authenticated USER (JWT sub), not the member row.
      actor_user_id: auth.subject,
      payload: { destination_local_hour: 23 },
    });
  });

  it("409s a cold thread (last inbound past the 72h window) even in daytime", async () => {
    const sb = baseStub({ lastInboundAt: STALE_INBOUND_AT });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({});
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("quiet_hours_confirmation_required");
    expect(sb.find("POST", "/rest/v1/rpc/claim_review_request")).toHaveLength(0);
  });

  it("treats a conversation with no inbound at all as cold", async () => {
    const sb = baseStub({ lastInboundAt: null });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({});
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("quiet_hours_confirmation_required");
  });

  it("confirmed cold-thread ask sends in daytime without a quiet-hours event", async () => {
    const sb = baseStub({ lastInboundAt: STALE_INBOUND_AT });
    stubSuccessfulClaim(sb);
    stubFetch(jwksRoute(auth), telnyxOk(), sb.route);

    const res = await post({ quiet_hours_confirmed: true });
    expect(res.status).toBe(201);
    // In-hours: the confirm covered the recency branch only — no
    // quiet_hours_confirmed event (compose logs it only when the clock gated).
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("keeps the D3 opt-out refusal on a confirmed night send (gate order intact)", async () => {
    vi.setSystemTime(NIGHTTIME);
    const sb = baseStub();
    sb.on("POST", "/rest/v1/rpc/claim_review_request", () => ({
      skipped: "recipient_opted_out",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({ quiet_hours_confirmed: true });
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("recipient_opted_out");
    // The confirm never bypasses the RPC's atomic opt-out mirror, and the
    // event is only written after a successful claim.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });
});
