/**
 * #342 — GET /v1/spam-review.
 *
 * The discrimination itself is asserted in SQL (supabase/tests/spam_review.test.sql),
 * where the fixtures can be a robotexter and a mis-marked customer. What these
 * pin is the route's part: that a restricted member's hidden numbers do not
 * leak into it, and that "yes, still spam" is answerable.
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
import { conversationsRoutes } from "./conversations";
import { spamReviewRoutes } from "./spam-review";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "11112222-3333-4444-8555-666677778888";
const NUMBER_ID = "99998888-7777-4666-8555-444433332222";

let auth: TestAuth;
const reviewApp = buildTestApp(spamReviewRoutes);
const conversationsApp = buildTestApp(conversationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function flaggedRow() {
  return {
    conversation_id: CONVERSATION_ID,
    contact: { id: "c1", name: "Real Customer", phone_e164: "+16135551000" },
    marked_at: "2026-06-26T12:00:00Z",
    marked_by_user_id: auth.subject,
    inbound_since: 4,
    last_inbound_at: "2026-07-25T09:00:00Z",
    we_texted_them: true,
    sustained: true,
    high_volume: false,
  };
}

function world(options: { role?: string; hidden?: string[] } = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "owner"),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () =>
    (options.hidden ?? []).map((id) => ({
      phone_number_id: id,
      level: "none",
    })),
  );
  sb.on("GET", "/rest/v1/phone_numbers", () => [{ id: NUMBER_ID }]);
  sb.on("POST", "/rest/v1/rpc/api_spam_review", () => [flaggedRow()]);
  return sb;
}

describe("GET /v1/spam-review (#342)", () => {
  it("returns the threads whose activity does not look like spam", async () => {
    const sb = world();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      reviewApp,
      env,
      await auth.token(),
      "/v1/spam-review",
      { companyId: COMPANY_ID },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [flaggedRow()] });

    const call = sb.find("POST", "/rest/v1/rpc/api_spam_review")[0].body as {
      p_company_id: string;
      p_limit: number;
    };
    expect(call.p_company_id).toBe(COMPANY_ID);
    // Bounded like every other home card list — the strip is a signal, not a
    // paginated inbox.
    expect(call.p_limit).toBe(20);
  });

  it("passes the caller's hidden numbers down, so nothing leaks by way of a review strip", async () => {
    // #106: a restricted member must not learn that a hidden number's
    // conversations exist. A "we noticed something on a thread you cannot
    // open" strip would tell them.
    const sb = world({ role: "member", hidden: [NUMBER_ID] });
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(reviewApp, env, await auth.token(), "/v1/spam-review", {
      companyId: COMPANY_ID,
    });

    const call = sb.find("POST", "/rest/v1/rpc/api_spam_review")[0].body as {
      p_hidden_number_ids: string[] | null;
    };
    expect(call.p_hidden_number_ids).toEqual([NUMBER_ID]);
  });
});

describe("PATCH /v1/conversations/:id — answering the review prompt (#342)", () => {
  function patchWorld(current: Record<string, unknown>): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "owner"));
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        id: CONVERSATION_ID,
        company_id: COMPANY_ID,
        status: "closed",
        is_spam: true,
        assigned_user_id: null,
        closed_at: "2026-06-26T12:00:00Z",
        pinned_at: null,
        phone_number_id: NUMBER_ID,
        ...current,
      },
    ]);
    sb.on("PATCH", "/rest/v1/conversations", (call) => [
      { id: CONVERSATION_ID, company_id: COMPANY_ID, ...(call.body as object) },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/phone_numbers", () => [{ id: NUMBER_ID }]);
    return sb;
  }

  async function patch(sb: SupabaseStub, body: Record<string, unknown>) {
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(
      conversationsApp,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body },
    );
  }

  it("stamps the watermark so the same messages are not raised twice", async () => {
    const sb = patchWorld({});
    const res = await patch(sb, { spam_reviewed: true });

    expect(res.status).toBe(200);
    const written = sb.find("PATCH", "/rest/v1/conversations")[0].body as {
      spam_reviewed_at?: string;
    };
    expect(written.spam_reviewed_at).toBeTruthy();
    // No timeline row: "no change" is the answer, and a row per dismissal is
    // the noise this whole feature exists to avoid.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("clears the watermark when the mark is lifted", async () => {
    // A later re-mark must start counting fresh rather than inherit a
    // confirmation that was about entirely different messages.
    const sb = patchWorld({});
    await patch(sb, { is_spam: false });

    const written = sb.find("PATCH", "/rest/v1/conversations")[0].body as {
      is_spam?: boolean;
      spam_reviewed_at?: string | null;
    };
    expect(written.is_spam).toBe(false);
    expect(written.spam_reviewed_at).toBeNull();
  });

  it("ignores a confirmation on a thread that is not marked spam", async () => {
    const sb = patchWorld({ is_spam: false });
    const res = await patch(sb, { spam_reviewed: true });

    expect(res.status).toBe(200);
    const written = sb.find("PATCH", "/rest/v1/conversations")[0]?.body as
      | { spam_reviewed_at?: string }
      | undefined;
    expect(written?.spam_reviewed_at).toBeUndefined();
  });
});
