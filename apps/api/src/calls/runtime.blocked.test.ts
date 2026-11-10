/**
 * #696 — an inbound call from a number the workspace blocked is refused at the
 * door: the loader flags it, and the machine rejects the leg without ringing,
 * pushing or answering anybody.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";
import { reduce } from "./transitions";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NUMBER_ID = "11111111-1111-4111-8111-111111111111";
const ALICE = "aaaaaaaa-1111-4111-8111-000000000001";
const CALLER = "+14155559001";

async function inboundContext(blocked: boolean) {
  const routes = stubRoute(
    () => true,
    (call) => {
      const path = call.url.pathname;
      if (path.includes("/rpc/api_claim_inbound_line")) return Response.json(false);
      if (path.includes("/rpc/number_member_levels")) {
        return Response.json([{ user_id: ALICE, level: "text" }]);
      }
      if (path.includes("/rpc/")) return Response.json(null);
      if (path.includes("/blocked_senders")) {
        return Response.json(blocked ? [{ id: "b-1" }] : []);
      }
      if (path.includes("/phone_numbers")) {
        return Response.json([
          { id: NUMBER_ID, company_id: COMPANY_ID, status: "active", label: null },
        ]);
      }
      if (path.includes("/companies")) {
        return Response.json([
          {
            id: COMPANY_ID,
            name: "Reed Roofing",
            plan: null,
            current_period_start: null,
            overage_cap_multiplier: 1,
            subscription_status: "active",
            paused_at: null,
            call_screening: "off",
          },
        ]);
      }
      if (path.includes("/member_telephony_credentials")) {
        return Response.json([{ user_id: ALICE, sip_username: "sip-alice" }]);
      }
      if (path.includes("/company_members")) {
        return Response.json([{ user_id: ALICE, role: "owner" }]);
      }
      if (path.includes("/push_subscriptions")) {
        return Response.json([{ user_id: ALICE }]);
      }
      if (path.includes("/notification_prefs")) {
        return Response.json([{ user_id: ALICE, push_enabled: true }]);
      }
      return Response.json([]);
    },
  );
  stubFetch(routes.route);
  const ctx = await createSessionRuntime(env).loadInitiatedContext({
    call_session_id: "sess-696",
    call_control_id: "ccid-696",
    from: CALLER,
    to: "+14155550001",
  } as never);
  if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);
  let n = 0;
  const { effects } = reduce(null, { type: "initiated", context: ctx }, 1_000, () => `k${n++}`);
  return { ctx, effects, routes };
}

describe("#696 inbound: a blocked number is refused before the crew is rung", () => {
  it("BC-1: the context is flagged blocked and the machine rejects the leg", async () => {
    const { ctx, effects } = await inboundContext(true);
    expect(ctx.blocked).toBe(true);
    expect(effects.some((effect) => effect.kind === "telnyx-reject")).toBe(true);
    for (const kind of ["telnyx-dial", "push-fanout", "telnyx-answer-notice"]) {
      expect(effects.some((effect) => effect.kind === kind)).toBe(false);
    }
  });

  it("BC-2: no crew member is even looked up for a blocked call", async () => {
    const { routes } = await inboundContext(true);
    const crewReads = routes.calls.filter((call) =>
      /member_telephony_credentials|company_members|push_subscriptions/.test(call.url.pathname),
    );
    expect(crewReads).toHaveLength(0);
  });

  it("BC-3: the identical world, not blocked, rings — so BC-1 is the block", async () => {
    const { ctx, effects } = await inboundContext(false);
    expect(ctx.blocked).toBe(false);
    expect(effects.some((effect) => effect.kind === "telnyx-dial")).toBe(true);
    expect(effects.some((effect) => effect.kind === "telnyx-reject")).toBe(false);
  });

  it("BC-4: the loader asks for the block by this workspace and this caller", async () => {
    const { routes } = await inboundContext(true);
    const ask = routes.calls.find((call) => call.url.pathname.includes("/blocked_senders"));
    expect(ask?.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(ask?.url.searchParams.get("phone_e164")).toBe(`eq.${CALLER}`);
  });
});
