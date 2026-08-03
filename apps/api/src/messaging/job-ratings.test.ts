/**
 * #313 — the escalation, which is the half of this feature with teeth.
 *
 * The ask and the parser are covered in @loonext/shared. What is tested here is
 * the thing that wakes people up: WHO it wakes, HOW ONCE it wakes them, and
 * that a merely-average score wakes nobody at all. An alert that fires on a 3
 * is an alert the crew learns to swipe away, which costs more than not having
 * one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { escalatePoorRating } from "./job-ratings";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";

interface Options {
  /** Rows the escalation claim comes back with. Empty = somebody else won. */
  claimed?: Record<string, unknown>[];
  members?: { user_id: string; role: string }[];
}

function harness(options: Options = {}) {
  const env = completeEnv();
  const sb = supabaseStub(env);

  sb.on("PATCH", "/rest/v1/job_ratings", () =>
    options.claimed ?? [{ id: "rating-1" }],
  );
  sb.on("GET", "/rest/v1/conversations", () => [{ phone_number_id: null }]);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    () => options.members ?? [{ user_id: OWNER, role: "owner" }],
  );
  // No devices registered: deliverPush resolves having found nobody to reach,
  // which is the shape every push test here uses. What matters is whether it
  // was ASKED to, and with what.
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);

  stubFetch(sb.route);
  return { env, sb, db: getDb(env) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("escalatePoorRating", () => {
  it("ES-1: a 2 stamps the row and goes looking for somebody to tell", async () => {
    const { env, sb, db } = harness();

    await escalatePoorRating(env, db, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      taskId: TASK,
      score: 2,
    });

    const claim = sb.calls.find(
      (call) => call.method === "PATCH" && call.path === "/rest/v1/job_ratings",
    );
    expect(claim).toBeDefined();
    expect((claim?.body as { escalated_at?: string }).escalated_at).toEqual(
      expect.any(String),
    );
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/company_members"),
    ).toBe(true);
  });

  it("ES-2: a 3 is 'fine', and wakes nobody", async () => {
    const { env, sb, db } = harness();

    await escalatePoorRating(env, db, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      taskId: TASK,
      score: 3,
    });

    // Not merely "no push" — no write either. A 3 must not consume the
    // one-escalation-per-rating claim, or a later correction could never fire.
    expect(sb.calls).toHaveLength(0);
  });

  it("ES-3: the claim carries its filters, so two replies cannot both win", async () => {
    const { env, sb, db } = harness();

    await escalatePoorRating(env, db, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      taskId: TASK,
      score: 1,
    });

    const claim = sb.calls.find(
      (call) => call.method === "PATCH" && call.path === "/rest/v1/job_ratings",
    );
    const params = claim?.url.searchParams;
    // Every one of these is load-bearing. Drop `escalated_at=is.null` and a
    // redelivered webhook re-alerts; drop `company_id` and this is a
    // cross-tenant write.
    expect(params?.get("escalated_at")).toBe("is.null");
    expect(params?.get("task_id")).toBe(`eq.${TASK}`);
    expect(params?.get("company_id")).toBe(`eq.${COMPANY}`);
  });

  it("ES-4: losing the claim stops before the notification", async () => {
    const { env, sb, db } = harness({ claimed: [] });

    await escalatePoorRating(env, db, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      taskId: TASK,
      score: 1,
    });

    // A second reply, or the same webhook twice: the row is already stamped,
    // so this run must not reach the crew again about one unhappy customer.
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/company_members"),
    ).toBe(false);
  });

  it("ES-5: it reaches the people who can see the thread, and only them", async () => {
    // #106: access is per phone number, so a member with no access to this one
    // must not learn from a lock-screen that a customer on it was unhappy.
    // `listConversationViewers` is what enforces that — this pins that the
    // push audience comes from THERE and is not a company-wide broadcast.
    const { env, sb, db } = harness({
      members: [{ user_id: OWNER, role: "owner" }],
    });

    await escalatePoorRating(env, db, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      taskId: TASK,
      score: 1,
    });

    const lookup = sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${OWNER})`);
  });
});
