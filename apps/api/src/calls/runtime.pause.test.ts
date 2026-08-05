/**
 * #277 — the pause, on the two voice gates that live in the runtime.
 *
 * A pause is a licensed-PRICE swap on the same subscription, chosen precisely
 * so `subscription_status` stays genuinely 'active'. That is what makes these
 * two gates invisible to every test written before them: the inbound arm's
 * `subscription_status !== "active"` term is false for a paused workspace, and
 * so is the outbound re-check's. Both had a pause term added and neither had a
 * single assertion — the whole suite stayed green with the term deleted.
 *
 * The money is the reason this is worth its own file. Dialling costs ~10c per
 * dial command whatever happens next, plus ~1.2c a minute on BOTH legs, against
 * a holding fee of a few dollars a month. But the product reason is stronger:
 * a crew that paused for the winter is not working, and a phone that rings
 * their browsers all season is not a held number, it is the plan they thought
 * they had stopped paying for.
 *
 * Each gate is asserted THREE ways, because a pause gate has three distinct
 * ways to die:
 *   - the term is removed        → the paused case behaves like an open one;
 *   - the fixture refuses anyway → so an identical world with the pause LIFTED
 *                                  must behave, or the refusal proves nothing;
 *   - the SELECT stops asking    → every row reads undefined, the `?? null`
 *                                  coalesce says "not paused", and the gate is
 *                                  dead with every other assertion still green.
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
import { type Effect, reduce } from "./transitions";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NUMBER_ID = "11111111-1111-4111-8111-111111111111";
const ALICE = "aaaaaaaa-1111-4111-8111-000000000001";
const PAUSED_AT = "2026-08-01T09:00:00+00:00";

// ---- the inbound arm (loadInitiatedContext) --------------------------------

interface InboundWorld {
  /**
   * The companies row's pause fact. `undefined` means the row carries NO such
   * key — the pre-migration read, which is a different case from `null` and is
   * the one the `?? null` coalesce exists for.
   */
  pausedAt?: string | null;
  subscriptionStatus?: string;
}

/**
 * The reads `loadInitiatedContext` makes on the way to a ringing call, with one
 * crew member who holds a credential and a push channel — so the CONTROL case
 * genuinely rings somebody and the paused case has something real to withhold.
 */
function inboundWorld(world: InboundWorld) {
  const companyRow: Record<string, unknown> = {
    id: COMPANY_ID,
    name: "Reed Roofing",
    // plan null short-circuits companyOverVoiceCap, so no usage RPC is needed
    // and the cap can never be what refuses this call.
    plan: null,
    current_period_start: null,
    overage_cap_multiplier: 1,
    subscription_status: world.subscriptionStatus ?? "active",
    call_screening: "off",
    voicemail_greeting: null,
    timezone: null,
    business_hours: null,
    business_hours_exceptions: null,
    after_hours_calls: null,
    after_hours_greeting_id: null,
    ring_strategy: null,
    ring_seconds: null,
  };
  if ("pausedAt" in world) companyRow.paused_at = world.pausedAt;

  return stubRoute(
    () => true,
    (call) => {
      const path = call.url.pathname;
      if (path.includes("/rpc/api_claim_inbound_line")) return Response.json(false);
      if (path.includes("/rpc/number_member_levels")) {
        return Response.json([{ user_id: ALICE, level: "text" }]);
      }
      if (path.includes("/rpc/")) return Response.json(null);
      if (path.includes("/phone_numbers")) {
        return Response.json([
          {
            id: NUMBER_ID,
            company_id: COMPANY_ID,
            status: "active",
            label: null,
            voicemail_greeting: null,
            timezone: null,
            business_hours: null,
            business_hours_exceptions: null,
            after_hours_calls: null,
            after_hours_greeting_id: null,
          },
        ]);
      }
      if (path.includes("/companies")) return Response.json([companyRow]);
      if (path.includes("/member_telephony_credentials")) {
        return Response.json([{ user_id: ALICE, sip_username: "sip-alice" }]);
      }
      if (path.includes("/company_members")) {
        return Response.json([{ user_id: ALICE, role: "owner" }]);
      }
      if (path.includes("/push_subscriptions")) {
        return Response.json([{ user_id: ALICE }]);
      }
      if (path.includes("/device_push_tokens")) return Response.json([]);
      if (path.includes("/notification_prefs")) {
        return Response.json([{ user_id: ALICE, push_enabled: true }]);
      }
      if (path.includes("/calls")) return Response.json([]);
      return Response.json([]);
    },
  );
}

async function inboundContext(world: InboundWorld) {
  const routes = inboundWorld(world);
  stubFetch(routes.route);
  const ctx = await createSessionRuntime(env).loadInitiatedContext({
    call_session_id: "sess-277",
    call_control_id: "ccid-277",
    from: "+14155559001",
    to: "+14155550001",
  } as never);
  if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);
  return { ctx, routes };
}

/** What the REAL machine does with that context, the moment the caller rings. */
function effectsFor(ctx: Awaited<ReturnType<typeof inboundContext>>["ctx"]): Effect[] {
  let n = 0;
  return reduce(null, { type: "initiated", context: ctx }, 1_000, () => `k${n++}`)
    .effects;
}

describe("#277 inbound: a paused workspace's phone does not ring the crew", () => {
  it("RP-1: the pause joins the suspended/inactive arm, and NOTHING is dialled", async () => {
    const { ctx } = await inboundContext({ pausedAt: PAUSED_AT });
    expect(ctx.suspendedOrInactive).toBe(true);
    // The crew is still resolved (the arm is about what we DO with them, and
    // the same row feeds the missed-call record), so the proof has to be the
    // machine's behaviour, not an empty target list.
    expect(ctx.dialTargets).toHaveLength(1);

    const effects = effectsFor(ctx);
    // No dial command: this is the ~10c-plus-per-minute spend the pause exists
    // to stop, and it is the only assertion here that costs real money to get
    // wrong.
    expect(effects.some((effect) => effect.kind === "telnyx-dial")).toBe(false);
    expect(effects.some((effect) => effect.kind === "push-fanout")).toBe(false);
  });

  it("RP-2: the caller is not left in silence — they hear the line-is-down notice", async () => {
    // #490's notice, bounded by its own daily cap. Withholding the ring is the
    // cost decision; leaving a customer of theirs listening to nothing for 45
    // seconds would be a second, unrelated failure.
    const { ctx } = await inboundContext({ pausedAt: PAUSED_AT });
    expect(ctx.noticeAllowed).toBe(true);
    expect(effectsFor(ctx).some((effect) => effect.kind === "telnyx-answer-notice")).toBe(
      true,
    );
  });

  it("RP-3: the identical world with the pause LIFTED rings — so RP-1 is the pause", async () => {
    // PROVE THE GUARD BY BREAKING IT. Every field is the one RP-1 used except
    // paused_at, so a green RP-1 cannot be some other term of the arm refusing.
    const { ctx } = await inboundContext({ pausedAt: null });
    expect(ctx.suspendedOrInactive).toBe(false);
    const effects = effectsFor(ctx);
    expect(effects.some((effect) => effect.kind === "telnyx-dial")).toBe(true);
    expect(effects.some((effect) => effect.kind === "telnyx-answer-notice")).toBe(false);
  });

  it("RP-4: the runtime ASKS for paused_at, and an absent column is not a pause", async () => {
    // How this arm dies with the whole suite green: someone edits the inbound
    // companies select and drops the column. Every row then reads undefined,
    // the coalesce says "not paused", and every paused workspace rings all
    // winter. The stub answers whatever it likes regardless of the select, so
    // this assertion is the only thing that can see it.
    const { routes } = await inboundContext({ pausedAt: PAUSED_AT });
    const read = routes.calls.find((call) =>
      call.url.pathname.includes("/companies"),
    );
    expect(read?.url.searchParams.get("select")).toContain("paused_at");

    // And the other half of the coalesce: a row with no such key rings exactly
    // as it did before #277 — a wrong "paused" would silence a paying crew's
    // phone, which is the failure only their customer finds out about.
    const { ctx } = await inboundContext({});
    expect(ctx.suspendedOrInactive).toBe(false);
  });
});

// ---- the outbound re-check (loadOutboundInitiatedContext) -------------------

const S = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "+16135551234";
const NUMBER = "dddddddd-0000-4000-8000-00000000000d";

function outboundPayload() {
  return {
    call_control_id: "leg-ccid-under-test",
    call_session_id: "telnyx-T-differs-from-S",
    client_state: buildOutboundState(
      OUTBOUND_CUSTOMER_STATE,
      CUSTOMER,
      "nonce-x",
      S,
    ),
    to: CUSTOMER,
    from: "+16135550100",
  };
}

/** A FRESH, fully authorized mint — everything past this point is the re-check. */
function authorizeStub() {
  return stubRoute(rpcMatch(env, "api_authorize_outbound_call"), () => ({
    authorized: true,
    company_id: COMPANY_ID,
    phone_number_id: NUMBER,
    replay: false,
    session_id: S,
    user_id: "eeeeeeee-0000-4000-8000-00000000000e",
  }));
}

function outboundCompaniesStub(row: Record<string, unknown>) {
  return stubRoute(restMatch(env, "GET", "companies"), () => [
    {
      plan: null,
      current_period_start: null,
      overage_cap_multiplier: 1,
      subscription_status: "active",
      ...row,
    },
  ]);
}

describe("#277 outbound: the leg that paused between authorize and dial", () => {
  /** The stamp write, present everywhere so a stray write is CAPTURED. */
  const stampStub = () =>
    stubRoute(restMatch(env, "PATCH", "calls"), () => new Response(null, { status: 204 }));
  const credentialsStub = () =>
    stubRoute(restMatch(env, "GET", "member_telephony_credentials"), () => [
      { sip_username: "placer-sip" },
    ]);

  it("RP-5: a paused company REJECTS the oc leg, with no stamp", async () => {
    // Defense in depth. The route already refused this call; this is the check
    // that holds if the route is ever bypassed — and the one that catches a
    // workspace that paused in the seconds between the authorize and the leg.
    const rpc = authorizeStub();
    const companies = outboundCompaniesStub({ paused_at: PAUSED_AT });
    const stamp = stampStub();
    stubFetch(rpc.route, companies.route, stamp.route, credentialsStub().route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(
      outboundPayload(),
    );

    expect(result).toBe("reject");
    expect(stamp.calls).toHaveLength(0);
  });

  it("RP-6: the identical world NOT paused mints — so RP-5 is the pause", async () => {
    // PROVE THE GUARD BY BREAKING IT: same authorize, same company row, one
    // field different. Without this, RP-5 would also pass if the re-check
    // rejected everything.
    const rpc = authorizeStub();
    const companies = outboundCompaniesStub({ paused_at: null });
    const stamp = stampStub();
    stubFetch(rpc.route, companies.route, stamp.route, credentialsStub().route);

    const result = await createSessionRuntime(env).loadOutboundInitiatedContext(
      outboundPayload(),
    );

    expect(result).toMatchObject({ callSessionId: S, companyId: COMPANY_ID });
    expect(stamp.calls).toHaveLength(1);
  });

  it("RP-7: the re-check ASKS for paused_at, and an absent column still mints", async () => {
    // Same silent death as RP-4, on the leg that actually connects the call.
    const rpc = authorizeStub();
    const companies = outboundCompaniesStub({ paused_at: PAUSED_AT });
    stubFetch(rpc.route, companies.route, stampStub().route, credentialsStub().route);
    await createSessionRuntime(env).loadOutboundInitiatedContext(outboundPayload());
    expect(companies.calls[0].url.searchParams.get("select")).toContain("paused_at");

    // A row with no such key connects, exactly as it did before #277.
    const rpc2 = authorizeStub();
    const noColumn = stubRoute(restMatch(env, "GET", "companies"), () => [
      {
        plan: null,
        current_period_start: null,
        overage_cap_multiplier: 1,
        subscription_status: "active",
      },
    ]);
    stubFetch(rpc2.route, noColumn.route, stampStub().route, credentialsStub().route);
    await expect(
      createSessionRuntime(env).loadOutboundInitiatedContext(outboundPayload()),
    ).resolves.toMatchObject({ callSessionId: S });
  });
});
