import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Hono } from "hono";

import type { AppEnv } from "../context";
import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { availableNumbersRoutes } from "./available-numbers";

/**
 * #251 — the number picker sheds load before Telnyx refuses us.
 *
 * ## Why this file exists at all
 *
 * The route had no tests. It is the one signed-in surface that spends the
 * TIGHTEST vendor budget we have: Telnyx allows 5 requests a second on number
 * management for the whole account (measured 2026-08-19, re-readable with
 * `scripts/ops/telnyx-rate-limits.mjs`), and this route fires one live
 * inventory search per request.
 *
 * ## The two limiters do different jobs
 *
 * `NUMBER_SEARCH_RATE_LIMITER` bounds ONE CALLER — a script hammering refresh.
 * It says nothing about the aggregate, because two customers shopping in the
 * same second are not one caller, and it was the only bound there was.
 *
 * `NUMBER_SEARCH_FLEET_LIMITER` bounds the account. It is keyed on a constant,
 * which is what makes it fleet-wide, and it matters for a reason beyond tidy
 * behaviour: the same Telnyx bucket carries number ORDERING, so an unbounded
 * search flood can refuse somebody mid-purchase — the one request in this
 * subsystem that must not fail.
 */

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;

/*
 * Mounted the way index.ts mounts it — under `/v1/available-numbers` — rather
 * than handed straight to `buildTestApp`, which routes a sub-app at `/v1`.
 * The routes declare `get("/")`, so the shortcut would have exercised `/v1`
 * and left the real path untested.
 */
const mounted = new Hono<AppEnv>();
mounted.route("/available-numbers", availableNumbersRoutes);
const app = buildTestApp(mounted);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Telnyx answering with one number, so a passing search has something to say. */
function inventoryRoute() {
  return {
    match: (url: URL) => url.hostname === "api.telnyx.com",
    respond: () =>
      new Response(
        JSON.stringify({
          data: [
            {
              phone_number: "+14165550123",
              region_information: [],
              cost_information: { monthly_cost: "1.00", currency: "USD" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  };
}

async function search(overrides: Partial<typeof env> = {}) {
  // #7: membership and session revocation both settle in api_authorize_request,
  // so that is the path stubbed — not company_members.
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "owner"),
  );
  stubFetch(jwksRoute(auth), sb.route, inventoryRoute().respond);
  return apiRequest(
    app,
    { ...env, ...overrides } as typeof env,
    await auth.token(),
    "/v1/available-numbers?country=US&area_code=415",
    { companyId: COMPANY_ID },
  );
}

describe("#251 the number picker and the account's Telnyx budget", () => {
  it("searches when neither limiter is bound, as dev and tests run", async () => {
    // Both limiters are optional bindings. If absence refused the request, this
    // route would be dead everywhere but production.
    const response = await search();
    expect(response.status).toBe(200);
  });

  it("says the phone network is busy when the FLEET budget is spent", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await search({
      NUMBER_SEARCH_FLEET_LIMITER: { limit },
    } as Partial<typeof env>);

    // 503, not 429. A 429 tells the caller THEY are going too fast, and they
    // are not — the budget is ours, spent on their behalf by everybody else
    // shopping at the same moment.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "The phone network is busy right now. Try that again in a moment.",
      },
    });
  });

  it("keys the fleet limiter on a constant, which is what makes it fleet-wide", async () => {
    // Keyed per caller or per company it would be a second copy of the limiter
    // above and would bound nothing new.
    const limit = vi.fn(async () => ({ success: true }));
    await search({ NUMBER_SEARCH_FLEET_LIMITER: { limit } } as Partial<typeof env>);
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: "available-numbers" });
  });

  it("still refuses ONE caller who is hammering it, in their own words", async () => {
    // The per-caller limiter keeps its own message: that refusal IS about the
    // person's own behaviour, and telling them the network is busy would be
    // false.
    const limit = vi.fn(async () => ({ success: false }));
    const response = await search({
      NUMBER_SEARCH_RATE_LIMITER: { limit },
    } as Partial<typeof env>);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "rate_limited", message: expect.any(String) },
    });
  });

  it("asks the per-caller limiter FIRST, so one script cannot spend the fleet's budget", async () => {
    // Order matters. If the fleet gate ran first, a single caller in a loop
    // would burn the account-wide budget before their own limiter noticed —
    // turning one abuser into an outage for everybody browsing.
    const caller = vi.fn(async () => ({ success: false }));
    const fleet = vi.fn(async () => ({ success: true }));
    await search({
      NUMBER_SEARCH_RATE_LIMITER: { limit: caller },
      NUMBER_SEARCH_FLEET_LIMITER: { limit: fleet },
    } as Partial<typeof env>);

    expect(caller).toHaveBeenCalled();
    expect(fleet).not.toHaveBeenCalled();
  });
});
