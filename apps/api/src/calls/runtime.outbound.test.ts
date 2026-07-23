/**
 * #211 SECURITY: loadOutboundInitiatedContext, the pre-reduce authority for a
 * 4-part oc call.initiated. Pins the call-hijack fix (adversarial review R):
 *   - a forged leg (unregistered nonce) is REJECTED without any calls write;
 *   - a REPLAY (already-authorized re-delivery) DROPS with no mint, no stamp,
 *     no customer_call_control_id write derived from the caller-supplied id;
 *   - only a FRESH mint stamps the customer leg control id.
 * Drives the REAL runtime (createSessionRuntime) with only the network edge
 * (global fetch) stubbed, like runtime.dial.test.ts / runtime.mirror.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import {
  buildOutboundState,
  OUTBOUND_CUSTOMER_STATE,
} from "../messaging/voice-webhook";
import { restMatch, rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";

const env: Env = completeEnv();

// The victim's (non-secret) live session id S, echoed as tag part-4. The honest
// client's part-4 IS S; a forger sets it to a victim's S_v. Either way the S1
// gate compares auth.session_id (RPC-returned) against this embedded value.
const S = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "+16135551234"; // area code 613 → a valid US/CA destination
const OC4 = buildOutboundState(OUTBOUND_CUSTOMER_STATE, CUSTOMER, "nonce-x", S);

const COMPANY = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER = "dddddddd-0000-4000-8000-00000000000d";

function payload() {
  return {
    call_control_id: "leg-ccid-under-test",
    call_session_id: "telnyx-T-differs-from-S",
    client_state: OC4,
    to: CUSTOMER,
    from: "+16135550100",
  };
}

/** A capturing PATCH /calls stub (the customer_call_control_id stamp). Present
 *  in EVERY test so a stray write is captured (and asserted absent), never a
 *  silent "unstubbed fetch" throw that would mask the shape of the failure. */
function stampStub() {
  return stubRoute(restMatch(env, "PATCH", "calls"), () => new Response(null, { status: 204 }));
}

/** The FRESH-path subscription re-check reads `companies`. plan:null short-
 *  circuits companyOverVoiceCap (no usage RPC), so an active row passes. */
function companiesStub() {
  return stubRoute(restMatch(env, "GET", "companies"), () => [
    {
      plan: null,
      current_period_start: null,
      overage_cap_multiplier: 1,
      subscription_status: "active",
    },
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadOutboundInitiatedContext — #211 call-hijack fix", () => {
  it("a forged leg (unregistered nonce → authorized:false) REJECTS with no calls write", async () => {
    // The scoped RPC replay branch finds no outbound row for the forger's
    // presented `from`, so it returns authorized:false. The context must reject
    // (the shell hangs up the crafted leg) and NEVER touch the victim row.
    const rpc = stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
      authorized: false,
    }));
    const stamp = stampStub();
    stubFetch(rpc.route, stamp.route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(payload());

    expect(result).toBe("reject");
    expect(rpc.calls).toHaveLength(1);
    // The whole point: zero writes to a row the caller does not own.
    expect(stamp.calls).toHaveLength(0);
  });

  it("a REPLAY (authorized:true, replay:true, victim tenant echoed) DROPS with no write", async () => {
    // Models the flag-ON attack that slips past the RPC (a same-`from` replay)
    // AND a genuine Telnyx re-delivery: the RPC echoes session_id = the caller's
    // part-4 (S) with replay:true. The context must DROP (no hangup, a genuine
    // replay's leg is live) WITHOUT stamping customer_call_control_id onto S.
    const rpc = stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
      authorized: true,
      company_id: COMPANY,
      phone_number_id: NUMBER,
      replay: true,
      session_id: S,
      user_id: null,
    }));
    const companies = companiesStub();
    const stamp = stampStub();
    stubFetch(rpc.route, companies.route, stamp.route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(payload());

    expect(result).toBe("drop");
    // No customer_call_control_id write; the hijack write is gone.
    expect(stamp.calls).toHaveLength(0);
    // Replay short-circuits BEFORE the fresh-only subscription re-check too.
    expect(companies.calls).toHaveLength(0);
  });

  it("a FRESH mint (authorized:true, replay:false) stamps the customer leg ccid", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
      authorized: true,
      company_id: COMPANY,
      phone_number_id: NUMBER,
      replay: false,
      session_id: S, // the RPC-derived PK == tag part-4 → S1 gate passes
      user_id: "eeeeeeee-0000-4000-8000-00000000000e",
    }));
    const companies = companiesStub();
    const stamp = stampStub();
    stubFetch(rpc.route, companies.route, stamp.route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(payload());

    expect(result).toMatchObject({
      callSessionId: S,
      customerCcid: "leg-ccid-under-test",
      companyId: COMPANY,
      phoneNumberId: NUMBER,
      customer: CUSTOMER,
    });
    // Exactly one stamp, scoped by session id AND company AND number, carrying
    // the fresh leg's control id.
    expect(stamp.calls).toHaveLength(1);
    const write = stamp.calls[0];
    expect(write.url.searchParams.get("call_session_id")).toBe(`eq.${S}`);
    expect(write.url.searchParams.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(write.url.searchParams.get("phone_number_id")).toBe(`eq.${NUMBER}`);
    expect(write.body).toEqual({ customer_call_control_id: "leg-ccid-under-test" });
  });

  it("S1 gate: a fresh authorize whose returned PK != tag part-4 REJECTS, no write", async () => {
    // A forger with a VALID nonce but a wrong part-4 lands on their own
    // nonce-bound S (session_id != embedded S) → reject without minting.
    const rpc = stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
      authorized: true,
      company_id: COMPANY,
      phone_number_id: NUMBER,
      replay: false,
      session_id: "99999999-9999-4999-8999-999999999999", // != S
      user_id: null,
    }));
    const stamp = stampStub();
    stubFetch(rpc.route, stamp.route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(payload());

    expect(result).toBe("reject");
    expect(stamp.calls).toHaveLength(0);
  });

  it("NO flag in the env: the crafted-tag hijack STILL fails (routing is unconditional; the defense is here)", async () => {
    // The calls env flags are GONE, so the webhook-router routes this crafted
    // 4-part tag straight to idFromName(S_victim) (pinned in webhook-router.test.ts:
    // "a crafted 4-part tag DOES route to the DO"). The ONLY defense now is this
    // context. The attack from the directive: a member crafts
    //   client_state = oc_customer | <customer> | <random-nonce> | <victim-S>
    // to stamp/hijack a victim's live call. The RANDOM nonce misses the DELETE and
    // falls to the auth-scoped replay branch, which — because the attacker
    // presents the victim's OWN business number as `from` — returns the victim
    // tenant with replay:true. loadOutboundInitiatedContext DROPS that: no mint,
    // no customer_call_control_id write, so the victim's live leg is never
    // rebound to the attacker. (A `from` the attacker does NOT own would instead
    // return authorized:false → reject; covered by the forged-nonce test above.)
    expect((env as Record<string, unknown>).CALLS_OUTBOUND_V3).toBeUndefined();
    const craftedTag = buildOutboundState(
      OUTBOUND_CUSTOMER_STATE,
      CUSTOMER,
      "attacker-random-nonce",
      S, // the victim's live session id, non-secret (rides the X-Loonext-Session header)
    );
    const rpc = stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
      authorized: true,
      company_id: COMPANY, // the victim tenant the auth-scoped replay lookup returns
      phone_number_id: NUMBER,
      replay: true,
      session_id: S, // == the crafted part-4 → the S1 gate passes, but replay DROPS
      user_id: null,
    }));
    const stamp = stampStub();
    stubFetch(rpc.route, stamp.route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext({
      call_control_id: "attacker-leg-ccid",
      call_session_id: "telnyx-T",
      client_state: craftedTag,
      to: CUSTOMER,
      from: "+16135550100", // the victim's business number the attacker presents
    });

    expect(result).toBe("drop"); // dropped: the victim's live leg is untouched
    expect(stamp.calls).toHaveLength(0); // NO customer_call_control_id overwrite
  });
});
