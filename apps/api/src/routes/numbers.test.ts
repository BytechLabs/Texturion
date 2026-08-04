import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { numbersRoutes } from "./numbers";
import type { AppEnv, MemberRole } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  FakeRest,
  registerProvisioningRpcs,
  resendRoute,
  TelnyxMock,
  telnyxError,
  type SentEmailCapture,
} from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";

const NUMBER_DEFAULTS = {
  status: "provisioning",
  source: "provisioned",
  voice_enabled: false,
  requested_area_code: null,
  number_e164: null,
  telnyx_phone_number_id: null,
  telnyx_order_id: null,
  provision_attempts: 0,
  last_provision_error: null,
  suspended_at: null,
  released_at: null,
};

/**
 * A faithful in-test double of the provision_number_slot RPC (the SQL itself
 * is covered by supabase/tests/provisioning.test.sql): same outcomes, same
 * insert, driven by the same FakeRest tables the route reads.
 */
function installSlotRpc(rest: FakeRest) {
  rest.rpc("provision_number_slot", (args) => {
    const numbers = rest.rows("phone_numbers");
    const existing = numbers.find(
      (row) => row.provisioning_key === args.p_provisioning_key,
    );
    if (existing) return { outcome: "exists", number: existing };
    const nonReleased = numbers.filter(
      (row) =>
        row.company_id === args.p_company_id && row.status !== "released",
    );
    const soleProp = rest
      .rows("messaging_registrations")
      .some(
        (row) =>
          row.company_id === args.p_company_id &&
          row.kind === "brand" &&
          row.sole_proprietor === true,
      );
    if (soleProp && nonReleased.length >= 1) {
      return { outcome: "sole_prop_cap", number: null };
    }
    // #110 (mirrors the RPC): effective max = included + the company's
    // paid_extra_numbers column, read under the same (simulated) row lock.
    const capacityRow = rest
      .rows("companies")
      .find((row) => row.id === args.p_company_id);
    const effectiveMax =
      Number(args.p_included_numbers) +
      Number(capacityRow?.paid_extra_numbers ?? 0);
    if (nonReleased.length >= effectiveMax) {
      return { outcome: "plan_limit", number: null, max: effectiveMax };
    }
    // #74 churn cap (mirrors the RPC): a lifetime per-company counter, checked
    // under the company row before the insert; incremented on every created.
    const company = rest
      .rows("companies")
      .find((row) => row.id === args.p_company_id);
    if (args.p_provision_cap != null) {
      const provisioned = Number(company?.number_provision_count ?? 0);
      if (provisioned >= Number(args.p_provision_cap)) {
        return {
          outcome: "provision_cap",
          limit: args.p_provision_cap,
          number: null,
        };
      }
    }
    const row = rest.insert("phone_numbers", {
      company_id: args.p_company_id,
      status: "provisioning",
      provisioning_key: args.p_provisioning_key,
      requested_area_code: args.p_requested_area_code,
      country: args.p_country,
      // Issue #75: a user-chosen specific number rides onto the row so the saga
      // orders it exactly (null = a bare area-code pick → in-area-code search).
      chosen_number_e164: args.p_chosen_number_e164 ?? null,
    });
    if (company) {
      company.number_provision_count =
        Number(company.number_provision_count ?? 0) + 1;
    }
    return { outcome: "created", number: row };
  });
}

function buildHarness(
  companyOverrides: Record<string, unknown> = {},
  extraRoutes: FetchRoute[] = [],
) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies", { paid_extra_numbers: 0, paid_capacity_epoch: 0 });
  rest.table("phone_numbers", NUMBER_DEFAULTS);
  rest.table("company_members");
  // The rule table itself: this route is the #106 CRUD, so it reads and writes
  // the raw rows and its own tests assert on them.
  rest.table("number_access");
  // #480: reads of EFFECTIVE access go through the resolver instead. A default of
  // "nothing restricted" matches the un-ruled company nearly every test here
  // uses; the access test overrides it. Implementing the precedence inside a test
  // double would be a seventh copy of the rule — the exact thing #480 removed —
  // so fixtures name what the resolver SAYS, and the rule is asserted where it
  // lives (supabase/tests/member_number_level.test.sql).
  rest.rpc("member_number_levels", () => []);
  rest.table("messaging_registrations");
  // #309/#278: the selection routes check that a greeting id belongs to the
  // workspace choosing it, so the table has to exist here — and ID-13 needs a
  // greeting owned by SOMEBODY ELSE to have something to refuse.
  rest.table("voicemail_greetings");
  rest.insert("voicemail_greetings", {
    id: "eeeeeeee-0000-4000-8000-0000000000e1",
    company_id: COMPANY_ID,
    name: "After hours",
  });
  rest.insert("voicemail_greetings", {
    id: "eeeeeeee-0000-4000-8000-0000000000e9",
    company_id: "99999999-0000-4000-8000-000000000099",
    name: "Someone else's voice",
  });
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    requested_area_code: "212",
    telnyx_messaging_profile_id: "profile-1",
    subscription_status: "active",
    plan: "pro",
    ...companyOverrides,
  });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });
  installSlotRpc(rest);
  // #110: the paid-buy syncs capacity and the release-converge claims lowers.
  rest.registerExtraCapacityRpcs();
  // §4.3 double-order fail-safe: remediate + provision routes drive the real
  // saga, which claims a per-row lease + per-order idempotency key via these RPCs.
  registerProvisioningRpcs(rest);

  const telnyx = new TelnyxMock();
  const emails: SentEmailCapture[] = [];
  const state = { role: "admin" as MemberRole };

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", state.role);
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1/numbers", numbersRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return errorResponse(c, error.code, error.message);
    }
    return c.json(
      { error: { code: "internal_error", message: String(error) } },
      500,
    );
  });

  stubFetch(...extraRoutes, rest.route(), telnyx.route(), resendRoute(emails));
  return {
    env,
    rest,
    telnyx,
    state,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function sagaTelnyx(telnyx: TelnyxMock, e164 = "+16465550123") {
  telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
    data: [{ phone_number: e164 }],
  }));
  telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
    data: { id: "order-1", status: "success", phone_numbers: [{ phone_number: e164 }] },
  }));
  telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) => {
    // Orphan-adoption pre-step sees nothing; the post-order lookup resolves
    // the purchased number's Telnyx id.
    if (call.query.get("filter[phone_number]") === e164) {
      return { data: [{ id: "pn-1", phone_number: e164 }] };
    }
    return { data: [] };
  });
}

function provisionInit(idempotencyKey: string | null, areaCode = "646"): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ requested_area_code: areaCode }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /v1/numbers", () => {
  it("lists the company's numbers without vendor internals", async () => {
    const harness = buildHarness();
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_1",
      country: "US",
      number_e164: "+12125550123",
      telnyx_phone_number_id: "pn-1",
      telnyx_order_id: "order-1",
    });

    const res = await harness.request("/v1/numbers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>[];
      next_cursor: null;
    };
    expect(body.next_cursor).toBeNull();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      status: "active",
      number_e164: "+12125550123",
      country: "US",
      // Hosted-vs-purchased + voice state (FEATURE-GAPS voice wave).
      source: "provisioned",
      voice_enabled: false,
    });
    expect(body.data[0].telnyx_phone_number_id).toBeUndefined();
    expect(body.data[0].telnyx_order_id).toBeUndefined();
    expect(body.data[0].provisioning_key).toBeUndefined();
  });

  it("exposes coarse failure_reason + retrying for a failed row, never the raw error", async () => {
    const harness = buildHarness();
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provision_failed",
      provisioning_key: "cs_2",
      country: "CA",
      requested_area_code: "416",
      provision_attempts: 1,
      last_provision_error: "Telnyx 400 [codes 10031] Invalid request filter…",
      provision_failure_reason: "no_inventory",
    });

    const res = await harness.request("/v1/numbers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    const row = body.data[0];
    expect(row).toMatchObject({
      status: "provision_failed",
      failure_reason: "no_inventory",
      provision_attempts: 1,
      retrying: true, // attempts (1) < MAX_PROVISION_ATTEMPTS (5)
    });
    // The raw vendor error + ids never leave the server.
    expect(row.last_provision_error).toBeUndefined();
    expect(row.telnyx_order_id).toBeUndefined();
    expect(row.telnyx_phone_number_id).toBeUndefined();
  });

  it("#106: a restricted member never sees a number hidden from them", async () => {
    const harness = buildHarness();
    harness.state.role = "member";
    const visibleId = "aaaaaaaa-0000-4000-8000-0000000000a1";
    const hiddenId = "aaaaaaaa-0000-4000-8000-0000000000a2";
    harness.rest.insert("phone_numbers", {
      id: visibleId,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125550001",
    });
    harness.rest.insert("phone_numbers", {
      id: hiddenId,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125550002",
    });
    // An admins-only rule on the second number, so a plain member resolves to
    // hidden. The first number is un-ruled and stays open to everyone, which is
    // the omission the deny list depends on.
    harness.rest.rpc("member_number_levels", () => [
      { phone_number_id: hiddenId, level: "none" },
    ]);

    const res = await harness.request("/v1/numbers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string }[];
      hidden_count: number;
    };
    expect(body.data.map((n) => n.id)).toEqual([visibleId]);

    // #286: and the member is TOLD one is missing. The filter above is
    // silent, and a tech who knows the shop runs two lines reads a
    // one-line picker as the app being broken — then asks the owner, who
    // has to work out they configured it deliberately.
    expect(body.hidden_count).toBe(1);
  });

  it("#286: a member with full access is told nothing", async () => {
    // The overwhelming default. A notice that appeared for everybody would
    // be noise on the screen a crew sends from.
    const harness = buildHarness();
    harness.state.role = "member";
    harness.rest.insert("phone_numbers", {
      id: "aaaaaaaa-0000-4000-8000-0000000000a1",
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125550001",
    });
    harness.rest.rpc("member_number_levels", () => []);

    const res = await harness.request("/v1/numbers");
    const body = (await res.json()) as { data: unknown[]; hidden_count: number };
    expect(body.data).toHaveLength(1);
    expect(body.hidden_count).toBe(0);
  });

  it("#286: the count never names what it is hiding", async () => {
    // The notice explains an access rule, and naming the number would undo
    // the rule it is explaining. A count is the whole payload.
    const harness = buildHarness();
    harness.state.role = "member";
    const hiddenId = "aaaaaaaa-0000-4000-8000-0000000000a2";
    harness.rest.insert("phone_numbers", {
      id: "aaaaaaaa-0000-4000-8000-0000000000a1",
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125550001",
    });
    harness.rest.insert("phone_numbers", {
      id: hiddenId,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125559999",
    });
    harness.rest.rpc("member_number_levels", () => [
      { phone_number_id: hiddenId, level: "none" },
    ]);

    const res = await harness.request("/v1/numbers");
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(hiddenId);
    expect(raw).not.toContain("5559999");
  });
});

describe("GET/PUT /v1/numbers/:id/access (#106)", () => {
  const NUMBER_ID = "aaaaaaaa-0000-4000-8000-0000000000a9";
  const ALICE = "bbbbbbbb-0000-4000-8000-0000000000b1";
  const BOB = "bbbbbbbb-0000-4000-8000-0000000000b2";

  function withNumber(harness: ReturnType<typeof buildHarness>) {
    harness.rest.insert("phone_numbers", {
      id: NUMBER_ID,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125559000",
    });
  }

  function putInit(body: unknown): RequestInit {
    return {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  it("requires owner/admin", async () => {
    const harness = buildHarness();
    withNumber(harness);
    harness.state.role = "member";
    const res = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "everyone" }),
    );
    expect(res.status).toBe(403);
  });

  it("404s a number outside the company", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "everyone" }),
    );
    expect(res.status).toBe(404);
  });

  it("round-trips a role rule (GET reflects the saved PUT)", async () => {
    const harness = buildHarness();
    withNumber(harness);

    const put = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "role", role: "admin", level: "note" }),
    );
    expect(put.status).toBe(200);

    const get = await harness.request(`/v1/numbers/${NUMBER_ID}/access`);
    expect(await get.json()).toEqual({
      access: "role",
      role: "admin",
      level: "note",
    });
  });

  it("saves a specific-people rule and rejects a non-member", async () => {
    const harness = buildHarness();
    withNumber(harness);
    harness.rest.user(ALICE, "alice@acme.example");
    harness.rest.insert("company_members", {
      company_id: COMPANY_ID,
      user_id: ALICE,
      role: "member",
      deactivated_at: null,
    });

    // BOB is not a member → rejected.
    const bad = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "users", user_ids: [ALICE, BOB], level: "text" }),
    );
    expect(bad.status).toBe(422);

    // Just ALICE → saved; GET reflects it.
    const ok = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "users", user_ids: [ALICE], level: "text" }),
    );
    expect(ok.status).toBe(200);
    const get = (await (
      await harness.request(`/v1/numbers/${NUMBER_ID}/access`)
    ).json()) as { access: string; user_ids: string[] };
    expect(get.access).toBe("users");
    expect(get.user_ids).toEqual([ALICE]);
  });

  it("dedupes duplicate user_ids instead of 500ing on the unique constraint", async () => {
    const harness = buildHarness();
    withNumber(harness);
    harness.rest.user(ALICE, "alice@acme.example");
    harness.rest.insert("company_members", {
      company_id: COMPANY_ID,
      user_id: ALICE,
      role: "member",
      deactivated_at: null,
    });

    const res = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "users", user_ids: [ALICE, ALICE], level: "text" }),
    );
    expect(res.status).toBe(200);
    // Exactly one rule row was written for ALICE.
    const rows = harness.rest.rows("number_access") as { principal: string }[];
    expect(rows.filter((r) => r.principal === ALICE)).toHaveLength(1);
  });

  it("'everyone' clears the rules (GET falls back to everyone)", async () => {
    const harness = buildHarness();
    withNumber(harness);
    harness.rest.insert("number_access", {
      company_id: COMPANY_ID,
      phone_number_id: NUMBER_ID,
      principal_kind: "role",
      principal: "admin",
      level: "text",
    });

    const put = await harness.request(
      `/v1/numbers/${NUMBER_ID}/access`,
      putInit({ access: "everyone" }),
    );
    expect(put.status).toBe(200);
    const get = await harness.request(`/v1/numbers/${NUMBER_ID}/access`);
    expect(await get.json()).toEqual({ access: "everyone" });
    expect(harness.rest.rows("number_access")).toHaveLength(0);
  });
});

describe("POST /v1/numbers/provision", () => {
  it("is owner/admin only", async () => {
    const harness = buildHarness();
    harness.state.role = "member";
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(403);
  });

  it("requires a UUID Idempotency-Key header (§7)", async () => {
    const harness = buildHarness();
    const missing = await harness.request("/v1/numbers/provision", provisionInit(null));
    expect(missing.status).toBe(422);
    const garbage = await harness.request(
      "/v1/numbers/provision",
      provisionInit("not-a-uuid"),
    );
    expect(garbage.status).toBe(422);
  });

  it("validates the area code against the shared NANP table", async () => {
    const harness = buildHarness();
    // Unassigned NPA.
    let res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID(), "999"),
    );
    expect(res.status).toBe(422);
    // Assigned to Canada — the company is US (country fixed to the company's).
    res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID(), "604"),
    );
    expect(res.status).toBe(422);
    // Non-geographic US code (no region/inventory semantics).
    res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID(), "710"),
    );
    expect(res.status).toBe(422);
  });

  it("402s without an active subscription", async () => {
    const harness = buildHarness({ subscription_status: "past_due" });
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_inactive");
  });

  it("provisions Pro's 2nd number through the saga (201, active)", async () => {
    const harness = buildHarness();
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_first",
      country: "US",
      number_e164: "+12125550001",
      telnyx_phone_number_id: "pn-0",
    });
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("active");
    expect(body.number_e164).toBe("+16465550123");
    expect(body.requested_area_code).toBe("646");

    // The saga started from S2: the existing profile was reused.
    expect(harness.telnyx.callsTo("POST", /messaging_profiles/)).toHaveLength(0);
    const order = harness.telnyx.callsTo("POST", /number_orders/)[0];
    expect(order.body).toMatchObject({
      messaging_profile_id: "profile-1",
      customer_reference: COMPANY_ID,
    });
  });

  it("replays idempotently on the same Idempotency-Key (200, one order)", async () => {
    const harness = buildHarness();
    sagaTelnyx(harness.telnyx);
    const key = crypto.randomUUID();

    const first = await harness.request("/v1/numbers/provision", provisionInit(key));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    const second = await harness.request("/v1/numbers/provision", provisionInit(key));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
    expect(harness.telnyx.callsTo("POST", /number_orders/)).toHaveLength(1);
  });

  it("orders the EXACT number the user chose, skipping the search (issue #75)", async () => {
    const harness = buildHarness();
    // Deliberately NO available_phone_numbers handler: if the saga searches, the
    // Telnyx mock 404s and the test fails — proving the chosen number is ordered
    // directly, never auto-searched.
    harness.telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: {
        id: "order-c",
        status: "success",
        phone_numbers: [{ phone_number: "+16465550777" }],
      },
    }));
    harness.telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+16465550777"
        ? { data: [{ id: "pn-c", phone_number: "+16465550777" }] }
        : { data: [] },
    );

    const res = await harness.request("/v1/numbers/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ chosen_number_e164: "+16465550777" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("active");
    expect(body.number_e164).toBe("+16465550777");
    // The area code is derived from the chosen number (646 = NY).
    expect(body.requested_area_code).toBe("646");
    // The exact pick was ordered — the inventory search never ran.
    expect(
      harness.telnyx.callsTo("GET", /available_phone_numbers/),
    ).toHaveLength(0);
    const order = harness.telnyx.callsTo("POST", /number_orders/)[0];
    expect(order.body).toMatchObject({
      phone_numbers: [{ phone_number: "+16465550777" }],
    });
  });

  it("rejects a chosen number from a different country (422)", async () => {
    const harness = buildHarness(); // US company
    const res = await harness.request("/v1/numbers/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ chosen_number_e164: "+14165550100" }), // 416 is CA
    });
    expect(res.status).toBe(422);
  });

  it("422s when neither a number nor an area code is given", async () => {
    const harness = buildHarness();
    const res = await harness.request("/v1/numbers/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("409s at the included count when the company can't buy extras (no US texting)", async () => {
    // #105: past the included count the buy is a PAID extra — a company
    // without US texting can't buy one, and no Stripe call is ever made.
    const harness = buildHarness({ plan: "starter", us_texting_enabled: false });
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_first",
      country: "US",
      number_e164: "+12125550001",
    });
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("US texting");
  });

  it("409s once the lifetime provision (churn) cap is reached (#74)", async () => {
    const harness = buildHarness();
    // Pin the company at the churn cap (NUMBER_PROVISION_CHURN_CAP = 20).
    harness.rest.rows("companies")[0].number_provision_count = 20;
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Contact support");
    // No Telnyx order was placed — the cap stops us before any purchase.
    expect(harness.telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
  });

  it("counts a successful provision toward the churn cap (#74)", async () => {
    const harness = buildHarness();
    harness.rest.rows("companies")[0].number_provision_count = 19; // one below cap
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(201);
    // The lifetime counter advanced, so the next provision would hit the cap.
    expect(harness.rest.rows("companies")[0].number_provision_count).toBe(20);
  });

  it("409s for sole-prop companies with a number already (§4.2)", async () => {
    const harness = buildHarness(); // pro plan — the cap ignores the plan
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "approved",
      sole_proprietor: true,
      data: {},
    });
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_first",
      country: "US",
      number_e164: "+12125550001",
    });
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Sole Proprietor");
  });
});

/** A Stripe API stub for the #105 paid-extra paths (subscription + items). */
function stripeStub(
  options: {
    schedule?: string | null;
    items?: { id: string; price: string; quantity?: number }[];
  } = {},
) {
  const calls: {
    method: string;
    pathname: string;
    form: URLSearchParams;
    headers: Headers;
  }[] = [];
  // STATEFUL (#110): the buy path verifies-after-write with a second retrieve,
  // so item writes must be visible to later GETs — a static list would make
  // every successful create look like a ghost replay.
  const items = (options.items ?? []).map((item) => ({ ...item }));
  const route: FetchRoute = async (url, request) => {
    if (url.host !== "api.stripe.com") return undefined;
    const form = new URLSearchParams(
      request.method === "POST" ? await request.clone().text() : "",
    );
    calls.push({
      method: request.method,
      pathname: url.pathname,
      form,
      headers: new Headers(request.headers),
    });
    if (request.method === "GET" && url.pathname === "/v1/subscriptions/sub_1") {
      return Response.json({
        id: "sub_1",
        object: "subscription",
        status: "active",
        schedule: options.schedule ?? null,
        items: {
          object: "list",
          has_more: false,
          data: items.map((item) => ({
            id: item.id,
            object: "subscription_item",
            price: { id: item.price, object: "price" },
            ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
          })),
        },
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/subscription_items"
    ) {
      items.push({
        id: "si_extra",
        price: form.get("price") ?? "",
        quantity: Number(form.get("quantity") ?? 1),
      });
      return Response.json({ id: "si_extra", object: "subscription_item" });
    }
    if (
      request.method === "POST" &&
      url.pathname.startsWith("/v1/subscription_items/")
    ) {
      const id = url.pathname.split("/").pop();
      const item = items.find((i) => i.id === id);
      if (item) {
        item.quantity = Number(form.get("quantity") ?? item.quantity ?? 1);
        if (form.get("price")) item.price = form.get("price") as string;
      }
      return Response.json({ id, object: "subscription_item" });
    }
    if (request.method === "DELETE") {
      const id = url.pathname.split("/").pop();
      const at = items.findIndex((i) => i.id === id);
      if (at >= 0) items.splice(at, 1);
      return Response.json({ id, deleted: true });
    }
    return Response.json(
      { error: { message: `unhandled ${request.method} ${url.pathname}` } },
      { status: 500 },
    );
  };
  return { route, calls, items };
}

describe("POST /v1/numbers/provision — paid extras (#105/#80)", () => {
  const PAID_COMPANY = {
    plan: "starter",
    us_texting_enabled: true,
    stripe_subscription_id: "sub_1",
  };
  function firstNumber(harness: ReturnType<typeof buildHarness>) {
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_first",
      country: "US",
      number_e164: "+12125550001",
    });
  }

  it("sells Starter's 2nd number as a $5 extra: charge now, then provision (201)", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);
    sagaTelnyx(harness.telnyx);

    const key = crypto.randomUUID();
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(key),
    );
    expect(res.status).toBe(201);

    // The quantity bump happened BEFORE the claim, priced on the plan's extra
    // price, charged immediately, keyed off the request's Idempotency-Key.
    const create = stripe.calls.find(
      (call) =>
        call.method === "POST" && call.pathname === "/v1/subscription_items",
    );
    expect(create).toBeDefined();
    expect(create!.form.get("price")).toBe(
      harness.env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID,
    );
    expect(create!.form.get("quantity")).toBe("1");
    expect(create!.form.get("proration_behavior")).toBe("always_invoice");
    expect(create!.headers.get("Idempotency-Key")).toBe(
      `${COMPANY_ID}:extra_number_buy:${key}`,
    );
  });

  it("#110: the raise fence refuses a stale buy — 409, no slot claim, no order", async () => {
    // A converge claimed a credit between this request's epoch read and its
    // sync (simulated by a sync double that reports the fence refusal). The
    // buy must fail CLOSED: no capacity resurrection, no number.
    const stripe = stripeStub();
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);
    sagaTelnyx(harness.telnyx);
    harness.rest.rpc("sync_paid_extra_capacity", () => ({
      applied: false,
      capacity: 0,
      epoch: 99,
    }));

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("billing update just ran");
    // Nothing was admitted: still just the seeded first number, no order.
    expect(harness.rest.rows("phone_numbers")).toHaveLength(1);
    expect(harness.telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
  });

  it("#110: a ghost Stripe create (cached replay of a deleted item) fails closed", async () => {
    // The write 'succeeds' but the item never lands (Stripe replayed a cached
    // create for an item a converge already deleted). The verify-after-write
    // re-retrieve sees no item → 409, never a free number.
    const ghostStripe: FetchRoute = async (url, request) => {
      if (url.host !== "api.stripe.com") return undefined;
      if (request.method === "GET" && url.pathname === "/v1/subscriptions/sub_1") {
        return Response.json({
          id: "sub_1",
          object: "subscription",
          status: "active",
          schedule: null,
          items: { object: "list", has_more: false, data: [] },
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/subscription_items") {
        // The cached-replay shape: 200, but no item is ever visible.
        return Response.json({ id: "si_ghost", object: "subscription_item" });
      }
      return Response.json({ error: { message: "unhandled" } }, { status: 500 });
    };
    const harness = buildHarness(PAID_COMPANY, [ghostStripe]);
    firstNumber(harness);
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("didn't complete");
    expect(harness.rest.rows("phone_numbers")).toHaveLength(1);
    expect(harness.telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
  });

  it("409s Starter's 3rd number (hard cap 2) without touching Stripe", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_second",
      country: "US",
      number_e164: "+12125550002",
    });

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Pro");
    expect(stripe.calls).toHaveLength(0);
  });

  it("Pro extras are unbounded: the 3rd number bumps quantity to 1 at $4", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(
      { ...PAID_COMPANY, plan: "pro" },
      [stripe.route],
    );
    firstNumber(harness);
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_second",
      country: "US",
      number_e164: "+12125550002",
    });
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(201);
    const create = stripe.calls.find(
      (call) =>
        call.method === "POST" && call.pathname === "/v1/subscription_items",
    );
    expect(create!.form.get("price")).toBe(
      harness.env.STRIPE_EXTRA_NUMBER_PRO_PRICE_ID,
    );
    expect(create!.form.get("quantity")).toBe("1");
  });

  it("fails CLOSED when the company has no subscription id to bill", async () => {
    // The fixture default has no stripe_subscription_id.
    const harness = buildHarness({ plan: "starter", us_texting_enabled: true });
    firstNumber(harness);
    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("aren't available yet");
  });

  it("409s a schedule-managed subscription (#18: pending plan change owns items)", async () => {
    const stripe = stripeStub({ schedule: "sub_sched_1" });
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("plan change is scheduled");
    // Retrieved the subscription, but never wrote to it.
    expect(
      stripe.calls.filter((call) => call.method === "POST"),
    ).toHaveLength(0);
  });

  it("replays a SUCCESSFUL paid buy on the same Idempotency-Key without re-charging", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);
    sagaTelnyx(harness.telnyx);

    const key = crypto.randomUUID();
    const first = await harness.request(
      "/v1/numbers/provision",
      provisionInit(key),
    );
    expect(first.status).toBe(201);
    const bought = (await first.json()) as { id: string };
    const stripeWrites = stripe.calls.filter((c) => c.method === "POST").length;

    // The retry must return the SAME row (200) and never touch Stripe again —
    // not 409 at the Starter hard max, not a replayed Stripe key with new params.
    const retry = await harness.request(
      "/v1/numbers/provision",
      provisionInit(key),
    );
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { id: string }).id).toBe(bought.id);
    expect(
      stripe.calls.filter((c) => c.method === "POST").length,
    ).toBe(stripeWrites);
  });

  it("refuses a sole-prop paid extra BEFORE any Stripe write (never charge-then-409)", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(PAID_COMPANY, [stripe.route]);
    firstNumber(harness);
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      sole_proprietor: true,
    });

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Sole Proprietor");
    expect(stripe.calls).toHaveLength(0);
  });

  it("refuses a churn-capped paid extra BEFORE any Stripe write (#74)", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(
      { ...PAID_COMPANY, number_provision_count: 20 },
      [stripe.route],
    );
    firstNumber(harness);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Contact support");
    expect(stripe.calls).toHaveLength(0);
  });

  it("never consults Stripe inside the included count (the free path)", async () => {
    const stripe = stripeStub();
    const harness = buildHarness(
      { ...PAID_COMPANY, plan: "pro" },
      [stripe.route],
    );
    firstNumber(harness); // 1 of Pro's 2 included
    sagaTelnyx(harness.telnyx);

    const res = await harness.request(
      "/v1/numbers/provision",
      provisionInit(crypto.randomUUID()),
    );
    expect(res.status).toBe(201);
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("DELETE /v1/numbers/:id", () => {
  it("is owner-only (§10: release is owner)", async () => {
    const harness = buildHarness();
    harness.state.role = "admin";
    const res = await harness.request(
      `/v1/numbers/${crypto.randomUUID()}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(403);
  });

  it("404s for unknown ids and malformed ids", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    expect(
      (
        await harness.request(`/v1/numbers/${crypto.randomUUID()}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (await harness.request("/v1/numbers/not-a-uuid", { method: "DELETE" }))
        .status,
    ).toBe(404);
  });

  it("404s for a number owned by another company", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    const foreign = harness.rest.insert("phone_numbers", {
      company_id: "99999999-9999-4999-8999-999999999999",
      status: "active",
      provisioning_key: "cs_other",
      country: "US",
      number_e164: "+12125550009",
    });
    const res = await harness.request(`/v1/numbers/${foreign.id as string}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("409s when the number is already released", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    const row = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "released",
      provisioning_key: "cs_1",
      country: "US",
      released_at: "2026-06-01T00:00:00.000Z",
    });
    const res = await harness.request(`/v1/numbers/${row.id as string}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
  });

  it("releasing a paid extra converges the Stripe quantity down (#105)", async () => {
    // Pro with 3 numbers (2 included + 1 paid, item quantity 1). Releasing one
    // brings the count to 2 → desired quantity 0 → the item is deleted with a
    // prorated credit.
    const stripe = stripeStub({
      items: [
        { id: "si_extra", price: "price_extra_number_pro_0001", quantity: 1 },
      ],
    });
    const harness = buildHarness(
      { plan: "pro", us_texting_enabled: true, stripe_subscription_id: "sub_1" },
      [stripe.route],
    );
    harness.state.role = "owner";
    for (const [i, e164] of ["+12125550001", "+12125550002"].entries()) {
      harness.rest.insert("phone_numbers", {
        company_id: COMPANY_ID,
        status: "active",
        provisioning_key: `cs_keep_${i}`,
        country: "US",
        number_e164: e164,
      });
    }
    const row = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_extra",
      country: "US",
      number_e164: "+12125550003",
      telnyx_phone_number_id: "pn-extra",
    });
    harness.telnyx.on(
      "DELETE",
      /^\/v2\/phone_numbers\/pn-extra$/,
      () => new Response(null, { status: 204 }),
    );

    const res = await harness.request(`/v1/numbers/${row.id as string}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const del = stripe.calls.find((call) => call.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.pathname).toBe("/v1/subscription_items/si_extra");
  });

  it("releases via Telnyx and marks the row released (§12 step 18)", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    const row = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_1",
      country: "US",
      number_e164: "+12125550123",
      telnyx_phone_number_id: "pn-1",
    });
    harness.telnyx.on(
      "DELETE",
      /^\/v2\/phone_numbers\/pn-1$/,
      () => new Response(null, { status: 204 }),
    );

    const res = await harness.request(`/v1/numbers/${row.id as string}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("released");
    expect(body.released_at).toBeTruthy();
    expect(harness.telnyx.callsTo("DELETE", /phone_numbers/)).toHaveLength(1);
    expect(harness.rest.rows("phone_numbers")[0].status).toBe("released");
  });

  it("keeps the row un-released when Telnyx errors (cron retries)", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    const row = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "suspended",
      provisioning_key: "cs_1",
      country: "US",
      number_e164: "+12125550123",
      telnyx_phone_number_id: "pn-1",
    });
    harness.telnyx.on("DELETE", /^\/v2\/phone_numbers\/pn-1$/, () =>
      telnyxError(500, "10000"),
    );
    const res = await harness.request(`/v1/numbers/${row.id as string}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(500);
    expect(harness.rest.rows("phone_numbers")[0].status).toBe("suspended");
  });
});

describe("POST /v1/numbers/:id/remediate (no-recharge)", () => {
  const remediateInit = (body: Record<string, unknown>): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function insertFailed(
    harness: ReturnType<typeof buildHarness>,
    extra: Record<string, unknown> = {},
  ) {
    return harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provision_failed",
      provisioning_key: "cs_fail",
      country: "US",
      requested_area_code: "416",
      provision_attempts: 1,
      last_provision_error: "no US inventory for area code 416",
      provision_failure_reason: "no_inventory",
      ...extra,
    });
  }

  it("orders the chosen number on the EXISTING paid row — no new row, no slot claim", async () => {
    const harness = buildHarness();
    harness.telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    harness.telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: { id: "order-r", status: "success", phone_numbers: [{ phone_number: "+12125550188" }] },
    }));
    harness.telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+12125550188"
        ? { data: [{ id: "pn-r", phone_number: "+12125550188" }] }
        : { data: [] },
    );
    const row = insertFailed(harness);
    const before = harness.rest.rows("phone_numbers").length;

    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ chosen_number_e164: "+12125550188" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("active");
    expect(body.number_e164).toBe("+12125550188");
    // No new phone_numbers row => provision_number_slot (the paid claim) was
    // never called => no second charge; the existing paid row was finished.
    expect(harness.rest.rows("phone_numbers")).toHaveLength(before);
    expect(harness.rest.rows("phone_numbers")[0].provision_attempts).toBe(0);
  });

  it("accepts a DIFFERENT-area-code pick (the exhausted-416 → 647 remedy)", async () => {
    const harness = buildHarness({ country: "CA", requested_area_code: "416" });
    harness.telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    harness.telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: { id: "order-ca", status: "success", phone_numbers: [{ phone_number: "+16475550100" }] },
    }));
    harness.telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+16475550100"
        ? { data: [{ id: "pn-ca", phone_number: "+16475550100" }] }
        : { data: [] },
    );
    const row = insertFailed(harness, { country: "CA" });

    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ chosen_number_e164: "+16475550100" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).number_e164).toBe(
      "+16475550100",
    );
  });

  it("rejects a chosen number from a different country (422)", async () => {
    const harness = buildHarness(); // US company
    const row = insertFailed(harness);
    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ chosen_number_e164: "+14165550100" }), // 416 is CA
    );
    expect(res.status).toBe(422);
  });

  it("409s when a chosen-number remediation collides with a live order (double-buy guard)", async () => {
    const harness = buildHarness();
    const row = insertFailed(harness, { telnyx_order_id: "order-inflight" });
    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ chosen_number_e164: "+12125550188" }),
    );
    expect(res.status).toBe(409);
  });

  it("409s on a non-failed (active) row", async () => {
    const harness = buildHarness();
    const row = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_active",
      country: "US",
      number_e164: "+12125550111",
    });
    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ requested_area_code: "646" }),
    );
    expect(res.status).toBe(409);
  });

  it("is owner/admin only", async () => {
    const harness = buildHarness();
    harness.state.role = "member";
    const row = insertFailed(harness);
    const res = await harness.request(
      `/v1/numbers/${row.id as string}/remediate`,
      remediateInit({ requested_area_code: "646" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/numbers/access/explain/:userId (#348)", () => {
  const NUMBER_ID = "aaaaaaaa-0000-4000-8000-0000000000c7";
  const RELEASED_ID = "aaaaaaaa-0000-4000-8000-0000000000c8";
  const MEMBER = "bbbbbbbb-0000-4000-8000-0000000000b7";

  function withNumbers(harness: ReturnType<typeof buildHarness>) {
    harness.rest.insert("phone_numbers", {
      id: NUMBER_ID,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125559100",
    });
    harness.rest.insert("phone_numbers", {
      id: RELEASED_ID,
      company_id: COMPANY_ID,
      status: "released",
      country: "US",
      number_e164: "+12125559101",
    });
  }

  it("requires owner/admin", async () => {
    // It answers for ANOTHER person, which is a management question. A member
    // asking what they themselves reach is the /v1/me company embed.
    const harness = buildHarness();
    withNumbers(harness);
    harness.state.role = "member";
    const res = await harness.request(`/v1/numbers/access/explain/${MEMBER}`);
    expect(res.status).toBe(403);
  });

  it("returns the level AND the rule that decided it", async () => {
    const harness = buildHarness();
    withNumbers(harness);
    harness.rest.rpc("member_number_access_explained", () => [
      { phone_number_id: NUMBER_ID, level: "note", decided_by: "role", principal: "member" },
    ]);

    const res = await harness.request(`/v1/numbers/access/explain/${MEMBER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user_id: string;
      numbers: { level: string; decided_by: string; principal: string | null; number_e164: string }[];
    };
    expect(body.user_id).toBe(MEMBER);
    expect(body.numbers).toHaveLength(1);
    // The whole point of #348: not just what, but why.
    expect(body.numbers[0].decided_by).toBe("role");
    expect(body.numbers[0].principal).toBe("member");
    expect(body.numbers[0].level).toBe("note");
    // And the number itself, so the screen says +1 212 555 9100 not a uuid.
    expect(body.numbers[0].number_e164).toBe("+12125559100");
  });

  it("drops a released number", async () => {
    // The resolver answers for every row in phone_numbers. A released number is
    // gone — reporting access to it answers a question nobody asked with a row
    // nobody can act on.
    const harness = buildHarness();
    withNumbers(harness);
    harness.rest.rpc("member_number_access_explained", () => [
      { phone_number_id: NUMBER_ID, level: "text", decided_by: "unruled", principal: null },
      { phone_number_id: RELEASED_ID, level: "text", decided_by: "unruled", principal: null },
    ]);

    const res = await harness.request(`/v1/numbers/access/explain/${MEMBER}`);
    const body = (await res.json()) as { numbers: { phone_number_id: string }[] };
    expect(body.numbers.map((n) => n.phone_number_id)).toEqual([NUMBER_ID]);
  });
});

/**
 * #307 — a line's own identity, and what it inherits.
 *
 * ID-2 is the one the whole feature rests on: null CLEARS an override back to
 * inherit. An owner who empties a greeting box must get their workspace
 * greeting back, not silence on a live call — and must be able to get there
 * without knowing what they started with.
 */
describe("GET/PATCH /v1/numbers/:id/identity (#307)", () => {
  const ID = "aaaaaaaa-0000-4000-8000-0000000000f1";

  /** The harness seeds the company; these are the identity fields it needs. */
  const COMPANY_IDENTITY = {
    timezone: "America/Toronto",
    voicemail_greeting: "You have reached Acme Plumbing.",
    away_message: "We are closed.",
    away_enabled: true,
    mctb_enabled: true,
    mctb_message: "Sorry we missed your call.",
    business_hours: { mon: { open: "08:00", close: "17:00" } },
    business_hours_exceptions: [],
    voicemail_greeting_id: null,
  };

  function withNumber(
    harness: ReturnType<typeof buildHarness>,
    overrides: Record<string, unknown> = {},
  ) {
    harness.rest.insert("phone_numbers", {
      id: ID,
      company_id: COMPANY_ID,
      status: "active",
      country: "US",
      number_e164: "+12125557000",
      label: null,
      voicemail_greeting: null,
      away_message: null,
      mctb_enabled: null,
      mctb_message: null,
      timezone: null,
      business_hours: null,
      business_hours_exceptions: null,
      voicemail_greeting_id: null,
      ...overrides,
    });
  }

  it("ID-1: a line with no overrides reads as fully inherited", async () => {
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    const res = await harness.request(`/v1/numbers/${ID}/identity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { value: unknown; inherited: boolean }>;

    expect(body.label).toEqual({ value: "Acme Plumbing", inherited: true });
    expect(body.voicemail_greeting.inherited).toBe(true);
    expect(body.away_message.inherited).toBe(true);
  });

  it("ID-9: a line keeps its own clock, and null puts it back on the workspace's", async () => {
    // The Vancouver line in a Toronto workspace. Before this the away clock
    // was company-wide, so one of the two lines was always running on the
    // wrong hours with no setting that could fix it.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    const set = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timezone: "America/Vancouver",
        business_hours: { tue: { open: "09:00", close: "15:00" } },
      }),
    });
    expect(set.status).toBe(200);

    const after = (await (
      await harness.request(`/v1/numbers/${ID}/identity`)
    ).json()) as Record<string, { value: unknown; inherited: boolean }>;
    expect(after.timezone).toEqual({
      value: "America/Vancouver",
      inherited: false,
    });
    expect(after.business_hours.inherited).toBe(false);

    // And back. "Use the workspace's" has to work for the clock too, or a
    // line that was moved once can never follow the workspace again.
    await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: null, business_hours: null }),
    });
    const back = (await (
      await harness.request(`/v1/numbers/${ID}/identity`)
    ).json()) as Record<string, { value: unknown; inherited: boolean }>;
    expect(back.timezone).toEqual({ value: "America/Toronto", inherited: true });
    expect(back.business_hours).toEqual({
      value: { mon: { open: "08:00", close: "17:00" } },
      inherited: true,
    });
  });

  it("ID-10: a zone the runtime cannot resolve is REFUSED, not stored", async () => {
    // THE ONE THAT MATTERS HERE. The away clock reads this on every inbound,
    // and an unresolvable zone there resolves to "open" — so a typo would not
    // error anywhere, it would quietly stop the line ever counting as
    // after-hours, which looks exactly like the feature being switched off.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "America/Torotno" }),
    });
    expect(res.status).toBe(422);

    const after = (await (
      await harness.request(`/v1/numbers/${ID}/identity`)
    ).json()) as Record<string, { value: unknown; inherited: boolean }>;
    expect(after.timezone.inherited).toBe(true);
  });

  it("ID-11: malformed hours are refused by the SAME rule the workspace uses", async () => {
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        business_hours: { mon: { open: "25:00", close: "17:00" } },
      }),
    });
    expect(res.status).toBe(422);
  });

  it("ID-12: a line can play its own recording, and null puts back the written words", async () => {
    // #309. Null here is not "no greeting" — it is the written words spoken
    // aloud, which is what every line does until somebody chooses otherwise.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);
    const RECORDING = "eeeeeeee-0000-4000-8000-0000000000e1";

    const set = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voicemail_greeting_id: RECORDING }),
    });
    expect(set.status).toBe(200);

    const after = (await (
      await harness.request(`/v1/numbers/${ID}/identity`)
    ).json()) as Record<string, { value: unknown; inherited: boolean }>;
    expect(after.voicemail_greeting_id).toEqual({
      value: RECORDING,
      inherited: false,
    });

    await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voicemail_greeting_id: null }),
    });
    const back = (await (
      await harness.request(`/v1/numbers/${ID}/identity`)
    ).json()) as Record<string, { value: unknown; inherited: boolean }>;
    expect(back.voicemail_greeting_id).toEqual({ value: null, inherited: true });
  });

  it("ID-13: a line cannot play another workspace's recorded voice", async () => {
    // The bug this test was written for, found by reading the route rather
    // than by anything failing. The company scope on the UPDATE decides which
    // phone_numbers ROW is written, not which id lands in it, and the FK only
    // asks that the greeting exist somewhere — so a pasted id from another
    // workspace was stored and shown as selected.
    //
    // Nothing ever played it, because the runtime re-scopes its own read and
    // falls back to TTS on a miss. That is precisely why it went unnoticed:
    // the only symptom was an owner seeing a greeting chosen that their
    // callers never heard.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    for (const field of ["voicemail_greeting_id", "after_hours_greeting_id"]) {
      const res = await harness.request(`/v1/numbers/${ID}/identity`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          [field]: "eeeeeeee-0000-4000-8000-0000000000e9",
        }),
      });
      expect(res.status, `${field} accepted another workspace's greeting`).toBe(422);
    }

    // And the line was left alone rather than half-written.
    const row = harness.rest
      .rows("phone_numbers")
      .find((r) => r.id === ID) as Record<string, unknown>;
    expect(row.voicemail_greeting_id ?? null).toBeNull();
    expect(row.after_hours_greeting_id ?? null).toBeNull();
  });

  it("ID-14: after-hours routing is per line, and null goes back to the workspace's", async () => {
    // #278. Tri-state for the same reason mctb_enabled is: "this line takes
    // messages after hours" and "this line does whatever the workspace does"
    // are different answers, and a two-state field cannot say the second — so
    // a line could never go back to following the workspace once touched.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);

    const set = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ after_hours_calls: "on_call_only" }),
    });
    expect(set.status).toBe(200);

    const cleared = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ after_hours_calls: null }),
    });
    expect(cleared.status).toBe(200);

    // A value the runtime has no branch for would fall through to whichever
    // side its `if` chain ends on — a routing decision made by a typo.
    const nonsense = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ after_hours_calls: "send_to_the_moon" }),
    });
    expect(nonsense.status).toBe(422);
  });

  it("ID-13: a selection that is not a uuid is refused", async () => {
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness);
    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voicemail_greeting_id: "after-hours" }),
    });
    expect(res.status).toBe(422);
  });

  it("ID-2: null CLEARS an override back to inherit", async () => {
    // THE ONE THAT MATTERS. An owner who empties the box gets the workspace
    // value back, not silence — and gets there without knowing what the
    // workspace value was.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness, { voicemail_greeting: "Sales line." });

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voicemail_greeting: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { value: unknown; inherited: boolean }>;

    expect(body.voicemail_greeting).toEqual({
      value: "You have reached Acme Plumbing.",
      inherited: true,
    });
  });

  it("ID-3: a blank string clears too, rather than storing an empty override", async () => {
    // The same failure arriving through a form that posts "" when a box is
    // cleared. Stored as-is it is a real override, and the line goes silent
    // while the workspace still has a greeting.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness, { voicemail_greeting: "Sales line.", label: "Sales" });

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voicemail_greeting: "   ", label: "" }),
    });
    const body = (await res.json()) as Record<string, { value: unknown; inherited: boolean }>;

    expect(body.voicemail_greeting.inherited).toBe(true);
    expect(body.label).toEqual({ value: "Acme Plumbing", inherited: true });

    // And it was STORED as null, not as "". The resolver trims too, so a
    // stored empty string still READS as inherited — which is why the route's
    // own trim looked untested until the sweep. A blank in the column is a
    // lie in the database even when every read papers over it, and the next
    // consumer to skip the resolver finds a line with no greeting.
    const stored = harness.rest.rows("phone_numbers")[0] as Record<string, unknown>;
    expect(stored.voicemail_greeting).toBeNull();
    expect(stored.label).toBeNull();
  });

  it("ID-4: setting one field leaves the others alone", async () => {
    // A PATCH is not a replace. An owner naming the line must not silently
    // clear the greeting they set last week.
    const harness = buildHarness(COMPANY_IDENTITY);
    withNumber(harness, { voicemail_greeting: "Sales line." });

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Acme Plumbing Sales" }),
    });
    const body = (await res.json()) as Record<string, { value: unknown; inherited: boolean }>;

    expect(body.label.value).toBe("Acme Plumbing Sales");
    expect(body.voicemail_greeting).toEqual({ value: "Sales line.", inherited: false });

    // The MIRROR, because one direction proves nothing: a PATCH that always
    // wrote every field would pass the check above while silently clearing
    // whatever the owner did not mention.
    const second = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ away_message: "Sales is closed." }),
    });
    const after = (await second.json()) as Record<
      string,
      { value: unknown; inherited: boolean }
    >;
    expect(after.away_message.value).toBe("Sales is closed.");
    expect(after.label.value).toBe("Acme Plumbing Sales");
    expect(after.voicemail_greeting.value).toBe("Sales line.");
  });

  it("ID-5: a member cannot change how the line answers", async () => {
    const harness = buildHarness(COMPANY_IDENTITY);
    harness.state.role = "member";
    withNumber(harness);

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Mine now" }),
    });
    expect(res.status).toBe(403);
  });

  it("ID-6: another company's number is not found", async () => {
    // The tenant boundary on a route keyed by a UUID somebody could guess at.
    const harness = buildHarness(COMPANY_IDENTITY);
    harness.rest.insert("phone_numbers", {
      id: ID,
      company_id: "99999999-0000-4000-8000-000000000099",
      status: "active",
      country: "US",
      number_e164: "+12125557001",
    });

    const res = await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Not mine" }),
    });
    expect(res.status).toBe(404);
  });

  it("ID-7: the change is recorded", async () => {
    // "Who changed how we answer the phone" is asked after a complaint about
    // the greeting, not at the time.
    const harness = buildHarness(COMPANY_IDENTITY);
    harness.rest.table("audit_log");
    withNumber(harness);

    await harness.request(`/v1/numbers/${ID}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Acme Plumbing Sales" }),
    });

    const audits = harness.rest.rows("audit_log");
    expect(JSON.stringify(audits)).toContain("number.identity_changed");
  });
});
