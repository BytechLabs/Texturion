/**
 * #319 — cutover reaches the phone, not just the inbox.
 *
 * The push is the channel that matters at this transition: until cutover the
 * old provider still carries the line, and after it the customer's customers
 * reach this inbox and nowhere else. Somebody who reads the email four hours
 * later has spent four hours not watching it.
 *
 * These pin the decisions, not the transport (`deliver.test.ts` owns the
 * crypto): who is told, who is deliberately not, what it says, and the promise
 * that a push failure can never unwind a completed port.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";

const deliverPush = vi.fn();
vi.mock("./deliver", () => ({
  deliverPush: (...args: unknown[]) => deliverPush(...args),
}));
vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { pushPortCompleted } = await import("./port-completed");

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER = "aaaaaaaa-0000-4000-8000-00000000000a";
const CREW = "bbbbbbbb-0000-4000-8000-00000000000b";
const NUMBER = "+14165550142";

afterEach(() => {
  vi.unstubAllGlobals();
  deliverPush.mockReset();
});

/** members + prefs, the only two reads this sender makes. */
function stub(
  members: { user_id: string }[],
  prefs: { user_id: string; push_enabled: boolean }[],
) {
  const sb = supabaseStub(env);
  sb.on("GET", /company_members/, () => members);
  sb.on("GET", /notification_prefs/, () => prefs);
  stubFetch(sb.route);
  return sb;
}

describe("#319 port completion push", () => {
  it("tells the whole crew, and names the number that moved", async () => {
    stub([{ user_id: OWNER }, { user_id: CREW }], []);
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);

    expect(deliverPush).toHaveBeenCalledTimes(1);
    const payload = deliverPush.mock.calls[0][2] as {
      userIds: string[];
      web: { title: string; body: string; url: string };
      collapseKey: string;
    };
    expect(payload.userIds.sort()).toEqual([OWNER, CREW].sort());
    // The number is in the body on purpose: a crew mid-port may be moving more
    // than one line, and "your number" would not say which.
    expect(payload.web.body).toContain(NUMBER);
    expect(payload.web.title).toBe("Your number is live");
    expect(payload.web.url).toBe(`${env.APP_ORIGIN}/inbox`);
  });

  it("defaults a member who never opened settings to yes", async () => {
    // Never having visited the notifications screen is not an opt-out.
    stub([{ user_id: OWNER }], []);
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);
    expect(deliverPush).toHaveBeenCalledTimes(1);
  });

  it("obeys push_enabled, because this is not a side door", async () => {
    stub(
      [{ user_id: OWNER }, { user_id: CREW }],
      [
        { user_id: OWNER, push_enabled: false },
        { user_id: CREW, push_enabled: true },
      ],
    );
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);
    const payload = deliverPush.mock.calls[0][2] as { userIds: string[] };
    expect(payload.userIds).toEqual([CREW]);
  });

  it("sends nothing when everyone has push off", async () => {
    stub([{ user_id: OWNER }], [{ user_id: OWNER, push_enabled: false }]);
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);
    expect(deliverPush).not.toHaveBeenCalled();
  });

  it("collapses per number, so two ported lines are two pieces of news", async () => {
    stub([{ user_id: OWNER }], []);
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);
    const payload = deliverPush.mock.calls[0][2] as { collapseKey: string };
    expect(payload.collapseKey).toBe(`port-completed:${COMPANY_ID}:${NUMBER}`);
  });

  it("never throws, because the number is already live", async () => {
    // The transition is applied and the email has gone before this runs. A
    // push outage must not turn a successful cutover into a failed job that
    // retries the whole completion.
    stub([{ user_id: OWNER }], []);
    deliverPush.mockRejectedValueOnce(new Error("push provider down"));
    await expect(
      pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER),
    ).resolves.toBeUndefined();
  });

  it("survives a members lookup that fails outright", async () => {
    const sb = supabaseStub(env);
    // A PostgREST failure is an error RESPONSE, not a thrown handler — the
    // client turns 5xx into the `error` field this sender checks.
    sb.on(
      "GET",
      /company_members/,
      () =>
        new Response(JSON.stringify({ message: "db down" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    stubFetch(sb.route);
    await expect(
      pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER),
    ).resolves.toBeUndefined();
    expect(deliverPush).not.toHaveBeenCalled();
  });

  it("says it without an em or en dash", async () => {
    // Law 6, in rendered copy.
    stub([{ user_id: OWNER }], []);
    await pushPortCompleted(env, getDb(env), COMPANY_ID, NUMBER);
    const payload = deliverPush.mock.calls[0][2] as {
      web: { title: string; body: string };
    };
    for (const line of [payload.web.title, payload.web.body]) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("–");
    }
  });
});
