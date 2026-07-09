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
import { completeEnv, stubFetch } from "../test/support";

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
    if (nonReleased.length >= Number(args.p_max_numbers)) {
      return { outcome: "plan_limit", number: null };
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

function buildHarness(companyOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("phone_numbers", NUMBER_DEFAULTS);
  rest.table("company_members");
  rest.table("messaging_registrations");
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

  stubFetch(rest.route(), telnyx.route(), resendRoute(emails));
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

  it("409s at the plan allowance (atomic count-vs-plan)", async () => {
    const harness = buildHarness({ plan: "starter" });
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
    expect(body.error.message).toContain("plan includes 1");
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
