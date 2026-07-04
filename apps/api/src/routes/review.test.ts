/**
 * Review-request one-tap action (FEATURE-GAPS Step 2): POST
 * /v1/conversations/:id/review-request. Requires a stored review link, applies
 * {review_link} at send time, routes through claim_review_request (opt-out +
 * one-per-job suppression), and dispatches via Telnyx. Member-level.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

let auth: TestAuth;
const app = buildTestApp(reviewRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
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
  return sb;
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
    const sb = baseStub();
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
    expect(claimBody?.p_body).toContain("Ace Plumbing");
    expect(claimBody?.p_body).toContain(REVIEW_LINK);
    expect(claimBody?.p_body).not.toContain("{review_link}");
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
