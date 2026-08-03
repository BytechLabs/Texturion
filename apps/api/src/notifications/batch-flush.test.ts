/**
 * #297 — the batch, sent as one thing.
 *
 * Every test here is about the property that makes batching worth having: ONE
 * notification per member. A flush that sent four pushes each saying "1 new
 * message" would pass any test that only checked "the notification arrived",
 * while being the exact problem this feature was built to solve.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { runBatchFlush } from "./batch-flush";

const env = completeEnv();
const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const THREAD_A = "22222222-2222-4222-8222-222222222222";
const THREAD_B = "55555555-5555-4555-8555-555555555555";

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    company_id: COMPANY,
    user_id: MEMBER,
    category: "messages_all",
    conversation_id: THREAD_A,
    ...overrides,
  };
}

function world(due: Record<string, unknown>[], devices: unknown[] = []) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_claim_due_notifications", () => due);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => devices);
  return sb;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBatchFlush", () => {
  it("BF-1: one push per member, however many notifications are waiting", async () => {
    // THE WHOLE POINT. Four pushes that each say "1 new message" is the volume
    // problem wearing the feature's name.
    const sb = world([pending(), pending(), pending({ conversation_id: THREAD_B })]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary).toEqual({ members: 1, notifications: 3 });
    const lookups = sb.calls.filter(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookups).toHaveLength(1);
    // The filter as well as the count, so this says who was notified rather
    // than only how many queries ran.
    //
    // What actually guards "one push per member" is the claim RPC grouping by
    // member: breaking THAT makes this test report three members and three
    // separate lookups. Verified by doing it.
    expect(lookups[0].url.searchParams.get("user_id")).toBe(`in.(${MEMBER})`);
  });

  it("BF-2: the digest counts messages AND distinct conversations", async () => {
    // Four messages from one customer is a conversation; four across four is a
    // morning. A digest reporting only the total would flatten them.
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world(
      [pending(), pending(), pending({ conversation_id: THREAD_B })],
      [
        {
          id: "70000000-aaaa-4000-8000-000000000001",
          user_id: MEMBER,
          platform: "android",
          token: "tok",
        },
      ],
    );
    stubFetch(sb.route, ...service.routes);

    await runBatchFlush(fcmEnv(account));

    expect(service.sends).toHaveLength(1);
    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.body).toBe("3 new messages across 2 conversations");
    expect(data.kind).toBe("digest");
  });

  it("BF-3: two members get two digests, not one shared", async () => {
    const sb = world([
      pending(),
      pending({ user_id: OTHER }),
      pending({ user_id: OTHER }),
    ]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary).toEqual({ members: 2, notifications: 3 });
  });

  it("BF-4: the same person in two workspaces gets two digests", async () => {
    // Two different inboxes. One sentence could not honestly cover both, and
    // the deep link could only point at one of them.
    const sb = world([
      pending(),
      pending({ company_id: OTHER_COMPANY }),
    ]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary.members).toBe(2);
  });

  it("BF-5: a quiet minute claims nothing and touches nothing else", async () => {
    // This runs every minute forever. The common case must cost one indexed
    // lookup returning nothing.
    const sb = world([]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary).toEqual({ members: 0, notifications: 0 });
    expect(sb.calls).toHaveLength(1);
  });

  it("BF-6: the digest lands in the inbox, not in one of the threads", async () => {
    // Even when the batch covers a single conversation. A digest summarises a
    // period; dropping somebody into one thread would answer a question they
    // did not ask while hiding the rest.
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world(
      [pending(), pending()],
      [
        {
          id: "70000000-aaaa-4000-8000-000000000002",
          user_id: MEMBER,
          platform: "android",
          token: "tok",
        },
      ],
    );
    stubFetch(sb.route, ...service.routes);

    await runBatchFlush(fcmEnv(account));

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.url).toBe(`${env.APP_ORIGIN}/inbox`);
    expect(data.url).not.toContain(THREAD_A);
  });

  it("BF-7: a second digest replaces the first rather than stacking", async () => {
    // Somebody away for an hour should find one notification, not twelve.
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world(
      [pending()],
      [
        {
          id: "70000000-aaaa-4000-8000-000000000003",
          user_id: MEMBER,
          platform: "ios",
          token: "tok-ios",
        },
      ],
    );
    stubFetch(sb.route, ...service.routes);

    await runBatchFlush(fcmEnv(account));

    const headers = (
      service.sends[0].message as { apns: { headers: Record<string, string> } }
    ).apns.headers;
    expect(headers["apns-collapse-id"]).toBe(`digest:${MEMBER}`);
  });
});
