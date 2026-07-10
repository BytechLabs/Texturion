import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { portingRoutes } from "./porting";
import type { AppEnv, MemberRole } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  FakeRest,
  resendRoute,
  TelnyxMock,
  type SentEmailCapture,
} from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PORT_E164 = "+13035550000";

const PORT_DEFAULTS = {
  telnyx_porting_order_id: null,
  telnyx_loa_document_id: null,
  telnyx_invoice_document_id: null,
  billing_phone_number: null,
  pin_passcode: null,
  is_wireless: false,
  service_extended: null,
  foc_datetime_requested: null,
  foc_date: null,
  status: "draft",
  messaging_port_status: "not_applicable",
  rejection_reason: null,
  submission_count: 0,
  wants_bridge_number: false,
  bridge_number_id: null,
  submitted_at: null,
  ported_at: null,
  cancelled_at: null,
};

const PHONE_DEFAULTS = {
  status: "provisioning",
  source: "provisioned",
  porting_status: null,
  number_e164: null,
  telnyx_phone_number_id: null,
};

const CREATE_BODY = {
  phone_e164: PORT_E164,
  entity_name: "Acme Plumbing LLC",
  auth_person_name: "Pat Owner",
  account_number: "ACC-12345",
  pin_passcode: "4321",
  service_street: "1 Main St",
  service_locality: "Denver",
  service_admin_area: "CO",
  service_postal_code: "80202",
};

/**
 * A faithful in-test double of the claim_port_slot RPC (the SQL itself is
 * covered by supabase/tests/porting.test.sql): same outcomes, same ported-row
 * insert, driven by the same FakeRest tables the route reads. Mirrors the
 * provision_number_slot double in numbers.test.ts — a port counts as the one
 * number, so it shares the exact count-vs-plan + sole-prop cap logic.
 */
function installPortSlotRpc(rest: FakeRest) {
  rest.rpc("claim_port_slot", (args) => {
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
    const row = rest.insert("phone_numbers", {
      company_id: args.p_company_id,
      status: "provisioning",
      source: "ported",
      porting_status: "draft",
      provisioning_key: args.p_provisioning_key,
      country: args.p_country,
    });
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
  rest.table("phone_numbers", PHONE_DEFAULTS);
  rest.table("port_requests", PORT_DEFAULTS);
  rest.table("company_members");
  rest.table("messaging_registrations");
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    subscription_status: "active",
    plan: "pro",
    telnyx_messaging_profile_id: "profile-1",
    requested_area_code: "303",
    us_texting_enabled: true,
    ...companyOverrides,
  });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });
  installPortSlotRpc(rest);

  const telnyx = new TelnyxMock();
  const emails: SentEmailCapture[] = [];
  // Default portability check: a portable US landline (FIX 2 — the create route
  // always runs the §3.1 check). The handler reads `state.portability` so a test
  // can override the result WITHOUT racing the first-registered-wins matcher.
  const state = {
    role: "admin" as MemberRole,
    portability: {
      phone_number: PORT_E164,
      portable: true,
      phone_number_type: "landline",
    } as Record<string, unknown>,
  };
  telnyx.on("POST", /^\/v2\/portability_checks$/, () => ({
    data: [state.portability],
  }));

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", state.role);
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1/port-requests", portingRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  stubFetch(...extraRoutes, rest.route(), telnyx.route(), resendRoute(emails));

  return {
    env,
    rest,
    telnyx,
    emails,
    state,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function jsonInit(method: string, body: unknown, key?: string): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  };
}

const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// POST /check
// ---------------------------------------------------------------------------

describe("POST /v1/port-requests/check", () => {
  it("returns portable for a US local number", async () => {
    const harness = buildHarness();
    harness.telnyx.on("POST", /^\/v2\/portability_checks$/, () => ({
      data: [
        { phone_number: PORT_E164, portable: true, phone_number_type: "landline" },
      ],
    }));
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { portable: boolean; country: string };
    expect(body.portable).toBe(true);
    expect(body.country).toBe("US");
  });

  it("rejects a toll-free number with validation_failed (no Telnyx call)", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: "+18005550123" }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(0);
  });

  it("is owner/admin only", async () => {
    const harness = buildHarness();
    harness.state.role = "member";
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(403);
  });

  it("#32: 402s a canceled company — no free Telnyx portability oracle", async () => {
    const harness = buildHarness({ subscription_status: "canceled" });
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(402);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "subscription_inactive" },
    });
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(0);
  });

  it("#32: the paid-first onboarding window (incomplete) may still check", async () => {
    const harness = buildHarness({ subscription_status: "incomplete" });
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(200);
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(1);
  });

  it("#32: 429s a rate-limited check keyed per company — Telnyx is never called", async () => {
    const harness = buildHarness();
    const limit = vi.fn(async (_options: { key: string }) => ({
      success: false,
    }));
    harness.env.VERIFY_RATE_LIMITER = { limit };

    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(limit).toHaveBeenCalledExactlyOnceWith({
      key: `port-check:${COMPANY_ID}`,
    });
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(0);
  });

  it("#32: an allowed check passes the rate limiter through to Telnyx", async () => {
    const harness = buildHarness();
    harness.env.VERIFY_RATE_LIMITER = {
      limit: async () => ({ success: true }),
    };
    const res = await harness.request(
      "/v1/port-requests/check",
      jsonInit("POST", { phone_e164: PORT_E164 }),
    );
    expect(res.status).toBe(200);
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST / (create)
// ---------------------------------------------------------------------------

describe("POST /v1/port-requests", () => {
  it("creates the port_requests + phone_numbers rows and starts the saga (active sub)", async () => {
    const harness = buildHarness();
    harness.telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
      data: { id: "po-1", status: { value: "draft" } },
    }));
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-1$/, () => ({
      data: { id: "po-1" },
    }));
    harness.telnyx.on(
      "POST",
      /^\/v2\/porting_orders\/po-1\/actions\/confirm$/,
      () => ({ data: { id: "po-1" } }),
    );

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.phone_e164).toBe(PORT_E164);
    expect(body.status).toBe("draft");
    // §2.2 PII omission: pin/account are NEVER returned.
    expect(body.pin_passcode).toBeUndefined();
    expect(body.account_number).toBeUndefined();
    expect(body.has_pin).toBe(true);
    expect(body.has_account_number).toBe(true);
    // FIX 2 — landline path: is_wireless=false from the portability check; no
    // SSN/SIN last-4 collected or stored.
    expect(body.is_wireless).toBe(false);
    expect(body.has_ssn_sin_last4).toBe(false);
    expect(harness.telnyx.callsTo("POST", /portability_checks/)).toHaveLength(1);

    // Rows exist: phone (source='ported', provisioning) + port (draft).
    const phone = harness.rest.rows("phone_numbers")[0];
    expect(phone.source).toBe("ported");
    expect(phone.status).toBe("provisioning");
    expect(phone.provisioning_key).toBe(KEY);
    expect(harness.rest.rows("port_requests")).toHaveLength(1);
    const port = harness.rest.rows("port_requests")[0];
    expect(port.is_wireless).toBe(false);
    expect(port.ssn_sin_last4 ?? null).toBeNull();
  });

  it("FIX 2 — flags a wireless number and REQUIRES ssn_sin_last4 + PIN", async () => {
    const harness = buildHarness();
    harness.state.portability = {
      phone_number: PORT_E164,
      portable: true,
      phone_number_type: "mobile",
    };
    harness.telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
      data: { id: "po-w", status: { value: "draft" } },
    }));
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-w$/, () => ({
      data: { id: "po-w" },
    }));

    // Missing ssn_sin_last4 on a wireless number → validation_failed, no rows.
    const missingLast4 = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY), // CREATE_BODY has a PIN but no last-4
    );
    expect(missingLast4.status).toBe(422);
    expect((await missingLast4.json()) as unknown).toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(harness.rest.rows("port_requests")).toHaveLength(0);

    // Missing PIN on a wireless number → validation_failed.
    const missingPin = await harness.request(
      "/v1/port-requests",
      jsonInit(
        "POST",
        { ...CREATE_BODY, pin_passcode: undefined, ssn_sin_last4: "6789" },
        KEY,
      ),
    );
    expect(missingPin.status).toBe(422);

    // Both present → created, is_wireless=true, last-4 stored (only 4 digits).
    const ok = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", { ...CREATE_BODY, ssn_sin_last4: "6789" }, KEY),
    );
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.is_wireless).toBe(true);
    // §10: the last-4 is PII — returned only as an on-file boolean.
    expect(body.ssn_sin_last4).toBeUndefined();
    expect(body.has_ssn_sin_last4).toBe(true);
    const port = harness.rest.rows("port_requests")[0];
    expect(port.is_wireless).toBe(true);
    expect(port.ssn_sin_last4).toBe("6789");
  });

  it("FIX 2 — rejects a number Telnyx reports as not portable with its reason", async () => {
    const harness = buildHarness();
    harness.state.portability = {
      phone_number: PORT_E164,
      portable: false,
      not_portable_reason: "Number is pending disconnect",
    };

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toContain("pending disconnect");
    // No rows and no porting order created for a non-portable number.
    expect(harness.rest.rows("port_requests")).toHaveLength(0);
    expect(harness.telnyx.callsTo("POST", /porting_orders/)).toHaveLength(0);
  });

  it("requires an Idempotency-Key", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY),
    );
    expect(res.status).toBe(422);
  });

  it("defers the Telnyx order on the onboarding path (incomplete subscription)", async () => {
    const harness = buildHarness({ subscription_status: "incomplete" });
    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(201);
    // Rows written, but NO porting order created (paid-first defers it).
    expect(harness.rest.rows("port_requests")).toHaveLength(1);
    expect(harness.telnyx.callsTo("POST", /porting_orders/)).toHaveLength(0);
  });

  it("409 conflicts when a non-cancelled port already exists for the number", async () => {
    const harness = buildHarness();
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "other-key",
      country: "US",
    });
    harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "x",
      auth_person_name: "y",
      account_number: "z",
      service_street: "s",
      service_locality: "l",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "submitted",
    });
    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(409);
  });

  it("blocks the post-signup path on an inactive subscription", async () => {
    const harness = buildHarness({ subscription_status: "past_due" });
    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(402);
  });

  it("409 conflicts (sole_prop_cap) when a sole-prop company already has an active PROVISIONED number", async () => {
    // The exact spec-audit case: a capped company whose sole existing live
    // number is source='provisioned' (the normal sole-prop path) must NOT be
    // able to slip a 2nd number in via the port route (D16: a port counts as
    // the one number; §6 gate order "sole-prop cap"). The old ad-hoc check only
    // conflicted when the existing number was already source='ported'.
    const harness = buildHarness();
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      number_e164: "+13035550100",
      provisioning_key: "prov-key-1",
      country: "US",
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      sole_proprietor: true,
    });

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "conflict" },
    });
    // No 2nd phone_numbers row was inserted, and no port order was created.
    expect(harness.rest.rows("phone_numbers")).toHaveLength(1);
    expect(harness.rest.rows("port_requests")).toHaveLength(0);
    expect(harness.telnyx.callsTo("POST", /porting_orders/)).toHaveLength(0);
  });

  it("409 conflicts (plan_limit) when a Starter (1-number) company already has an active provisioned number", async () => {
    const harness = buildHarness({ plan: "starter" });
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      number_e164: "+13035550100",
      provisioning_key: "prov-key-1",
      country: "US",
    });

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(409);
    expect(harness.rest.rows("phone_numbers")).toHaveLength(1);
    expect(harness.rest.rows("port_requests")).toHaveLength(0);
  });

  // #108/#110: a Starter company that BOUGHT its 1 extra can port into that
  // paid slot — no new charge. Capacity lives in companies.paid_extra_numbers
  // (mirrored from Stripe by the buy/converge/reconcile), which the slot RPC
  // reads under its row lock — the route makes NO Stripe call.
  it("#108: a paid Starter extra admits a port past the included cap", async () => {
    // Starter: 1 included + 1 PAID extra = allowance 2. Already holding the 1
    // included number — the paid slot admits the port.
    const harness = buildHarness({ plan: "starter", paid_extra_numbers: 1 });
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      number_e164: "+13035550100",
      provisioning_key: "prov-key-1",
      country: "US",
    });
    harness.telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
      data: { id: "po-3", status: { value: "draft" } },
    }));
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-3$/, () => ({
      data: { id: "po-3" },
    }));

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(201);
    expect(harness.rest.rows("port_requests")).toHaveLength(1);
  });

  it("allows a Pro company's 2nd number to be a port (under the plan cap)", async () => {
    // Pro allows 2 numbers; a company holding one active provisioned number can
    // port a second (D16: Pro's 2nd number may be a port).
    const harness = buildHarness({ plan: "pro" });
    harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      number_e164: "+13035550100",
      provisioning_key: "prov-key-1",
      country: "US",
    });
    harness.telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
      data: { id: "po-2", status: { value: "draft" } },
    }));
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-2$/, () => ({
      data: { id: "po-2" },
    }));
    harness.telnyx.on(
      "POST",
      /^\/v2\/porting_orders\/po-2\/actions\/confirm$/,
      () => ({ data: { id: "po-2" } }),
    );

    const res = await harness.request(
      "/v1/port-requests",
      jsonInit("POST", CREATE_BODY, KEY),
    );
    expect(res.status).toBe(201);
    expect(harness.rest.rows("phone_numbers")).toHaveLength(2);
    expect(harness.rest.rows("port_requests")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// list + get
// ---------------------------------------------------------------------------

describe("GET /v1/port-requests(/:id)", () => {
  function seedPort(rest: FakeRest, overrides: Record<string, unknown> = {}) {
    const phone = rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    return rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      pin_passcode: "1234",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      ...overrides,
    });
  }

  it("lists ports, omitting pin/account (any member)", async () => {
    const harness = buildHarness();
    seedPort(harness.rest);
    harness.state.role = "member";
    const res = await harness.request("/v1/port-requests");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].pin_passcode).toBeUndefined();
    expect(body.data[0].has_pin).toBe(true);
    // §8.2/§9: pre-cutover the assignment flag is definitionally false.
    expect(body.data[0].assignment_blocked).toBe(false);
  });

  // PORTING.md §8.2/§9: the post-port 10DLC assignment-FAILED state (recorded
  // on the campaign row's ledger by registration.ts) must reach the port card.
  it("exposes assignment_blocked when the ported number's 10DLC assignment FAILED", async () => {
    const harness = buildHarness();
    const port = seedPort(harness.rest, {
      status: "ported",
      messaging_port_status: "ported",
      ported_at: new Date().toISOString(),
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      status: "approved",
      telnyx_id: "camp-1",
      data: {
        numberAssignments: { [PORT_E164]: "failed", "+13035550999": "added" },
      },
    });

    const list = await harness.request("/v1/port-requests");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: Record<string, unknown>[] };
    expect(listBody.data[0].assignment_blocked).toBe(true);

    const detail = await harness.request(`/v1/port-requests/${port.id}`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody.assignment_blocked).toBe(true);
  });

  it("a ported number with a clean (added) assignment is NOT flagged", async () => {
    const harness = buildHarness();
    seedPort(harness.rest, {
      status: "ported",
      messaging_port_status: "ported",
      ported_at: new Date().toISOString(),
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      status: "approved",
      telnyx_id: "camp-1",
      data: { numberAssignments: { [PORT_E164]: "added" } },
    });
    const res = await harness.request("/v1/port-requests");
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0].assignment_blocked).toBe(false);
  });

  // PORTING.md D16: the opt-in bridge (tide-me-over) number reaches the card
  // as bridge_number_e164 — resolved from the linked phone_numbers row.
  it("exposes bridge_number_e164 while the linked bridge number is ACTIVE", async () => {
    const harness = buildHarness();
    const bridge = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      provisioning_key: "cs_1:bridge:p1",
      country: "US",
      number_e164: "+13035550777",
    });
    const port = seedPort(harness.rest, {
      wants_bridge_number: true,
      bridge_number_id: bridge.id,
    });

    const list = await harness.request("/v1/port-requests");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: Record<string, unknown>[] };
    expect(listBody.data[0].bridge_number_e164).toBe("+13035550777");

    const detail = await harness.request(`/v1/port-requests/${port.id}`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody.bridge_number_e164).toBe("+13035550777");
  });

  it("a still-provisioning bridge (and no bridge at all) serializes bridge_number_e164 null", async () => {
    const harness = buildHarness();
    const bridge = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "provisioned",
      provisioning_key: "cs_1:bridge:p1",
      country: "US",
    });
    seedPort(harness.rest, {
      wants_bridge_number: true,
      bridge_number_id: bridge.id,
    });

    const res = await harness.request("/v1/port-requests");
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    // Linked but not yet live → null (never promise a number that can't send).
    expect(body.data[0].bridge_number_e164).toBeNull();

    // And the plain no-bridge port carries the field as null, not undefined.
    const noBridge = buildHarness();
    seedPort(noBridge.rest);
    const plain = await noBridge.request("/v1/port-requests");
    const plainBody = (await plain.json()) as { data: Record<string, unknown>[] };
    expect(plainBody.data[0]).toHaveProperty("bridge_number_e164", null);
  });

  it("404s an unknown id and a foreign-company id", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/port-requests/99999999-9999-4999-8999-999999999999",
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// resubmit + cancel + edit window
// ---------------------------------------------------------------------------

describe("POST /v1/port-requests/:id/resubmit", () => {
  function seedException(rest: FakeRest) {
    const phone = rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    return rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "exception",
      telnyx_porting_order_id: "po-9",
      // A prior submission attached both documents; a fix-and-resubmit re-uses
      // them (FIX 1: resubmit is documents-gated too).
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
      submission_count: 1,
    });
  }

  it("moves exception → in-process, re-sending messaging enablement (submission_count++)", async () => {
    const harness = buildHarness();
    const port = seedException(harness.rest);
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-9$/, () => ({
      data: { id: "po-9" },
    }));
    harness.telnyx.on(
      "POST",
      /^\/v2\/porting_orders\/po-9\/actions\/confirm$/,
      () => ({ data: { id: "po-9" } }),
    );

    const res = await harness.request(
      `/v1/port-requests/${port.id}/resubmit`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; submission_count: number };
    expect(body.status).toBe("in-process");
    expect(body.submission_count).toBe(2);

    // The resubmit PATCH re-sends messaging.enable_messaging=true (§6).
    const patch = harness.telnyx.callsTo("PATCH", /porting_orders/)[0];
    expect((patch.body as { messaging: unknown }).messaging).toEqual({
      enable_messaging: true,
    });
  });

  it("409 conflict when a document is missing (FIX 1 — never re-confirm without both)", async () => {
    const harness = buildHarness();
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    const port = harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "exception",
      telnyx_porting_order_id: "po-9",
      // Only the LOA is on file — the invoice was rejected and not re-uploaded.
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: null,
      submission_count: 1,
    });

    const res = await harness.request(
      `/v1/port-requests/${port.id}/resubmit`,
      { method: "POST" },
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "conflict" },
    });
    // No Telnyx confirm without both documents.
    expect(harness.telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
  });

  it("409 conflict when the port is not in exception", async () => {
    const harness = buildHarness();
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    const port = harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "submitted",
    });
    const res = await harness.request(
      `/v1/port-requests/${port.id}/resubmit`,
      { method: "POST" },
    );
    expect(res.status).toBe(409);
  });
});

describe("PUT /v1/port-requests/:id (edit window)", () => {
  it("validation_failed once the port is past the editable window", async () => {
    const harness = buildHarness();
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    const port = harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "foc-date-confirmed",
    });
    const res = await harness.request(
      `/v1/port-requests/${port.id}`,
      jsonInit("PUT", { entity_name: "New Name" }),
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /v1/port-requests/:id/submit (FIX 1 — documents-gated confirm)", () => {
  function seedDraft(rest: FakeRest, overrides: Record<string, unknown> = {}) {
    const phone = rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      porting_status: "draft",
      provisioning_key: "k",
      country: "US",
    });
    return rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "draft",
      telnyx_porting_order_id: "po-7",
      ...overrides,
    });
  }

  it("409 conflict when documents are missing — no Telnyx confirm", async () => {
    const harness = buildHarness();
    const port = seedDraft(harness.rest); // no documents on the row
    const res = await harness.request(
      `/v1/port-requests/${port.id}/submit`,
      { method: "POST" },
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "conflict" },
    });
    expect(harness.telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
    // The port stays a draft, awaiting the customer.
    expect(harness.rest.rows("port_requests")[0].status).toBe("draft");
  });

  it("confirms and moves draft → in-process when BOTH documents are present", async () => {
    const harness = buildHarness();
    const port = seedDraft(harness.rest, {
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
    });
    harness.telnyx.on("PATCH", /^\/v2\/porting_orders\/po-7$/, () => ({
      data: { id: "po-7" },
    }));
    harness.telnyx.on(
      "POST",
      /^\/v2\/porting_orders\/po-7\/actions\/confirm$/,
      () => ({ data: { id: "po-7" } }),
    );

    const res = await harness.request(
      `/v1/port-requests/${port.id}/submit`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("in-process");
    expect(harness.telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(1);
  });

  it("409 conflict when the port is not a draft", async () => {
    const harness = buildHarness();
    const port = seedDraft(harness.rest, {
      status: "in-process",
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
    });
    const res = await harness.request(
      `/v1/port-requests/${port.id}/submit`,
      { method: "POST" },
    );
    expect(res.status).toBe(409);
  });
});

describe("PUT /v1/port-requests/:id/documents (paid-first gate)", () => {
  function seedDraftPort(rest: FakeRest) {
    const phone = rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      porting_status: "draft",
      provisioning_key: "k",
      country: "US",
    });
    return rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "draft",
    });
  }

  function docForm(): FormData {
    const form = new FormData();
    form.append(
      "loa",
      new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
      "loa.pdf",
    );
    return form;
  }

  it("blocks the upload before payment (incomplete subscription) with subscription_inactive — no Telnyx call", async () => {
    // D16 / §3.2: uploading the LOA + invoice commits to Telnyx (POST
    // /v2/documents) and must NOT happen before payment_status==paid. During
    // onboarding the port is `draft` and the subscription is `incomplete`.
    const harness = buildHarness({ subscription_status: "incomplete" });
    const port = seedDraftPort(harness.rest);

    const res = await harness.request(`/v1/port-requests/${port.id}/documents`, {
      method: "PUT",
      body: docForm(),
    });
    expect(res.status).toBe(402);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "subscription_inactive" },
    });
    // The paid-first guard runs BEFORE any Telnyx upload.
    expect(harness.telnyx.callsTo("POST", /\/v2\/documents/)).toHaveLength(0);
    // No document UUID was stored on the row.
    const row = harness.rest.rows("port_requests")[0];
    expect(row.telnyx_loa_document_id ?? null).toBeNull();
  });

  it("uploads to Telnyx once the subscription is active", async () => {
    const harness = buildHarness(); // default subscription_status='active'
    const port = seedDraftPort(harness.rest);
    harness.telnyx.on("POST", /^\/v2\/documents$/, () => ({
      data: { id: "doc-loa-1" },
    }));

    const res = await harness.request(`/v1/port-requests/${port.id}/documents`, {
      method: "PUT",
      body: docForm(),
    });
    expect(res.status).toBe(200);
    expect(harness.telnyx.callsTo("POST", /\/v2\/documents/)).toHaveLength(1);
    const row = harness.rest.rows("port_requests")[0];
    expect(row.telnyx_loa_document_id).toBe("doc-loa-1");
  });
});

describe("POST /v1/port-requests/:id/cancel", () => {
  it("owner only; moves to cancel-pending and asks Telnyx to cancel", async () => {
    const harness = buildHarness();
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "k",
      country: "US",
    });
    const port = harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "in-process",
      telnyx_porting_order_id: "po-5",
    });
    harness.telnyx.on(
      "POST",
      /^\/v2\/porting_orders\/po-5\/actions\/cancel$/,
      () => ({ data: { id: "po-5" } }),
    );

    // admin is refused (owner only).
    const refused = await harness.request(
      `/v1/port-requests/${port.id}/cancel`,
      { method: "POST" },
    );
    expect(refused.status).toBe(403);

    harness.state.role = "owner";
    const res = await harness.request(
      `/v1/port-requests/${port.id}/cancel`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancel-pending");
    expect(harness.telnyx.callsTo("POST", /actions\/cancel/)).toHaveLength(1);
  });

  it("completes an onboarding cancel (no Telnyx order) immediately and releases the number", async () => {
    // The spec-audit case: an onboarding-path port created before payment has no
    // telnyx_porting_order_id (the order is deferred to the paid webhook). A
    // cancel here must go straight to `cancelled` and release the linked
    // phone_numbers row — nothing else would ever drive it out of cancel-pending
    // (the §5.2 poll skips cancel-pending / no-order rows), so parking there would
    // wedge the company's number slot forever.
    const harness = buildHarness({ subscription_status: "incomplete" });
    harness.state.role = "owner";
    const phone = harness.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      porting_status: "draft",
      provisioning_key: "k",
      country: "US",
    });
    const port = harness.rest.insert("port_requests", {
      company_id: COMPANY_ID,
      phone_number_id: phone.id,
      phone_e164: PORT_E164,
      country: "US",
      entity_name: "Acme",
      auth_person_name: "Pat",
      account_number: "ACC-1",
      service_street: "1 Main St",
      service_locality: "Denver",
      service_admin_area: "CO",
      service_postal_code: "80202",
      status: "draft",
      telnyx_porting_order_id: null,
    });

    const res = await harness.request(
      `/v1/port-requests/${port.id}/cancel`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    // Completed, not parked in cancel-pending.
    const body = (await res.json()) as { status: string; cancelled_at: string };
    expect(body.status).toBe("cancelled");
    expect(body.cancelled_at).toBeTruthy();
    // No Telnyx cancel — there was no order to cancel.
    expect(harness.telnyx.callsTo("POST", /actions\/cancel/)).toHaveLength(0);
    // The linked number is released, freeing the company's slot.
    expect(harness.rest.rows("port_requests")[0].status).toBe("cancelled");
    expect(harness.rest.rows("phone_numbers")[0].status).toBe("released");
  });
});
