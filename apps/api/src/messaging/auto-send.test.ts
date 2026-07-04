/**
 * The shared auto-send guard (FEATURE-GAPS Step 0b): STOP/HELP short-circuit,
 * the claim_auto_reply RPC skip reasons (opt-out / throttle / inactive), and the
 * dispatchOutbound reuse on a successful claim. The ONLY thing stubbed is the
 * network edge (global fetch).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import {
  messageRow,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { guardedAutoSend } from "./auto-send";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function telnyxStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: "telnyx-auto-1" } }),
  );
}

function run(args: {
  claim: Stub;
  telnyx?: Stub;
  persist?: Stub;
  triggerBody?: string;
}) {
  const routes = [args.claim.route];
  if (args.telnyx) routes.push(args.telnyx.route);
  if (args.persist) routes.push(args.persist.route);
  stubFetch(...routes);
  const db = getDb(env);
  return guardedAutoSend(env, db, {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    from: "+16135550100",
    to: "+16135551000",
    body: "Got your message — we reply by 8am.",
    triggerBody: args.triggerBody ?? "no hot water",
  });
}

describe("guardedAutoSend — keyword short-circuit (b)", () => {
  it("never touches the DB on a STOP keyword", async () => {
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    stubFetch(claim.route);
    const db = getDb(env);
    const outcome = await guardedAutoSend(env, db, {
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      from: "+16135550100",
      to: "+16135551000",
      body: "away text",
      triggerBody: "STOP",
    });
    expect(outcome).toEqual({ sent: false, reason: "carrier_keyword" });
    expect(claim.calls).toHaveLength(0);
  });

  it("short-circuits HELP and START too, case/space-insensitively", async () => {
    for (const kw of ["  help ", "Start", "unSUBSCRIBE"]) {
      const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
      const outcome = await run({ claim, triggerBody: kw });
      expect(outcome).toEqual({ sent: false, reason: "carrier_keyword" });
      expect(claim.calls).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });
});

describe("guardedAutoSend — claim skip reasons (a) opt-out, (c) throttle", () => {
  it("does not send when the RPC skips for opt-out", async () => {
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({
      skipped: "recipient_opted_out",
    }));
    const telnyx = telnyxStub();
    const outcome = await run({ claim, telnyx });
    expect(outcome).toEqual({ sent: false, reason: "recipient_opted_out" });
    expect(telnyx.calls).toHaveLength(0); // never dispatched
  });

  it("does not send when the RPC skips for throttle", async () => {
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({
      skipped: "throttled",
    }));
    const telnyx = telnyxStub();
    const outcome = await run({ claim, telnyx });
    expect(outcome).toEqual({ sent: false, reason: "throttled" });
    expect(telnyx.calls).toHaveLength(0);
  });

  it("does not send when subscription is inactive", async () => {
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({
      skipped: "subscription_inactive",
    }));
    const outcome = await run({ claim });
    expect(outcome).toEqual({ sent: false, reason: "subscription_inactive" });
  });
});

describe("guardedAutoSend — successful claim reuses dispatchOutbound", () => {
  it("dispatches via Telnyx and persists the telnyx id on the queued row", async () => {
    const queued = messageRow({ status: "queued", segments: 1 });
    const claim = stubRoute(rpcMatch(env, "claim_auto_reply"), (call) => {
      // The guard passes an estimated segment count and the throttle window.
      expect(call.body).toMatchObject({
        p_company_id: COMPANY_ID,
        p_conversation_id: CONVERSATION_ID,
        p_segments_estimate: expect.any(Number),
        p_throttle_seconds: expect.any(Number),
      });
      return { message: queued };
    });
    const telnyx = telnyxStub();
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" &&
        url.pathname === "/rest/v1/messages",
      () => [{ ...queued, telnyx_message_id: "telnyx-auto-1", status: "queued" }],
    );

    const outcome = await run({ claim, telnyx, persist });
    expect(outcome.sent).toBe(true);
    expect(telnyx.calls).toHaveLength(1);
    // The auto-reply body (not a footer-decorated variant) went to Telnyx.
    expect(telnyx.calls[0].body).toMatchObject({
      from: "+16135550100",
      to: "+16135551000",
      text: "Got your message — we reply by 8am.",
    });
    expect(persist.calls).toHaveLength(1);
  });
});
