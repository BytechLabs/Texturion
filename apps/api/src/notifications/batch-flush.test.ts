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
function batch(overrides: Record<string, unknown> = {}) {
  return {
    company_id: COMPANY,
    user_id: MEMBER,
    counts: { messages_all: 1 },
    conversations: 1,
    notifications: 1,
    ...overrides,
  };
}

function world(due: Record<string, unknown>[], devices: unknown[] = [], canConsume = true) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_lease_notification_batches", () => due);
  sb.on("POST", "/rest/v1/rpc/api_consume_notification_batch", () => canConsume);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => devices);
  return sb;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(runBatchFlush, () => {
  it("BF-1: one push per member, however many notifications are waiting", async () => {
    // THE WHOLE POINT. Four pushes that each say "1 new message" is the volume
    // problem wearing the feature's name.
    const sb = world([batch({ counts: { messages_all: 3 }, conversations: 2, notifications: 3 })]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary).toEqual({ members: 1, notifications: 3 });
    const lookups = sb.calls.filter(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0].url.searchParams.get("user_id")).toBe(`in.(${MEMBER})`);
    const [lease] = sb.find("POST", "/rest/v1/rpc/api_lease_notification_batches");
    expect(sb.find("POST", "/rest/v1/rpc/api_consume_notification_batch")[0]?.body).toEqual({
      p_company_id: COMPANY,
      p_user_id: MEMBER,
      p_lease_id: (lease.body as { p_lease_id: string }).p_lease_id,
    });
  });

  it("BF-2: the digest counts messages, message conversations, and other categories", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world(
      [batch({ counts: { messages_all: 1, messages_mine: 1, missed_calls: 1 }, notifications: 3 })],
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
    expect(data.body).toBe("2 new messages · 1 missed call");
    expect(data.kind).toBe("digest");
  });

  it("BF-3: two members get two digests, not one shared", async () => {
    const sb = world([
      batch(),
      batch({ user_id: OTHER, counts: { messages_all: 2 }, notifications: 2 }),
    ]);
    stubFetch(sb.route);

    const summary = await runBatchFlush(env);

    expect(summary).toEqual({ members: 2, notifications: 3 });
  });

  it("BF-4: the same person in two workspaces gets two digests", async () => {
    // Two different inboxes. One sentence could not honestly cover both, and
    // the deep link could only point at one of them.
    const sb = world([
      batch(),
      batch({ company_id: OTHER_COMPANY }),
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
      [batch({ counts: { messages_all: 2 }, notifications: 2 })],
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
      [batch()],
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

    const {headers} = (
      service.sends[0].message as { apns: { headers: Record<string, string> } }
    ).apns;
    expect(headers["apns-collapse-id"]).toBe(`digest:${MEMBER}`);
  });

  it("does not send after another run takes the lease", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world(
      [batch()],
      [{ id: "device", user_id: MEMBER, platform: "android", token: "tok" }],
      false,
    );
    stubFetch(sb.route, ...service.routes);

    await expect(runBatchFlush(fcmEnv(account))).resolves.toEqual({ members: 0, notifications: 0 });
    expect(service.sends).toHaveLength(0);
  });

  it("preserves the lease when preparation fails before any send", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world([batch()], [{ id: "device", user_id: MEMBER, platform: "android", token: "tok" }]);
    stubFetch((url) => url.pathname === "/rest/v1/device_push_tokens"
      ? new Response('{"message":"token lookup failed"}', { status: 400 })
      : undefined, sb.route, ...service.routes);

    await expect(runBatchFlush(fcmEnv(account))).resolves.toEqual({ members: 0, notifications: 0 });
    expect(sb.find("POST", "/rest/v1/rpc/api_consume_notification_batch")).toHaveLength(0);
    expect(service.sends).toHaveLength(0);
  });
});
