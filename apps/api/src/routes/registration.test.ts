import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registrationRoutes } from "./registration";
import type { AppEnv, MemberRole } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  FakeRest,
  resendRoute,
  TelnyxMock,
  telnyxError,
  type SentEmailCapture,
} from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";

const REGISTRATION_DEFAULTS = {
  status: "draft",
  sole_proprietor: false,
  telnyx_id: null,
  data: {},
  rejection_reason: null,
  submission_count: 0,
  submitted_at: null,
  approved_at: null,
  rejected_at: null,
  deactivated_at: null,
  otp_nudged_at: null,
};

const BRAND_BODY = {
  displayName: "Acme Plumbing",
  companyName: "Acme Plumbing LLC",
  ein: "12-3456789",
  email: "owner@acme.example",
  phone: "+12125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
  website: "https://acme.example",
};

const SOLE_PROP_BODY = {
  displayName: "Pat's Plumbing",
  firstName: "Pat",
  lastName: "Doe",
  ein: "1234",
  mobilePhone: "+12125550111",
  email: "pat@acme.example",
  phone: "+12125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
};

const CAMPAIGN_BODY = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.",
  sample1:
    "Hi, this is Acme Plumbing — we can come Tuesday at 3pm, does that work for you?",
  sample2:
    "Your appointment is confirmed for tomorrow at 9am. Reply STOP to opt out.",
};

/**
 * The /v1 middleware chain (JWT + X-Company-Id) has its own foundation suite;
 * these tests synthesize its output variables and exercise the REAL route
 * handlers + requireRole gates + real supabase-js/Telnyx/Stripe HTTP against
 * the stubbed network edge.
 */
function buildHarness(companyOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("messaging_registrations", REGISTRATION_DEFAULTS);
  rest.table("phone_numbers", { status: "active" });
  rest.table("company_members");
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    us_texting_enabled: true,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    registration_fee_paid_at: "2026-07-01T00:00:00.000Z",
    ...companyOverrides,
  });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });

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
  app.route("/v1/registration", registrationRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return errorResponse(c, error.code, error.message);
    }
    return c.json(
      { error: { code: "internal_error", message: String(error) } },
      500,
    );
  });

  const extraRoutes: FetchRoute[] = [];
  const stub = () =>
    stubFetch(rest.route(), telnyx.route(), resendRoute(emails), ...extraRoutes);
  stub();

  return {
    env,
    rest,
    telnyx,
    emails,
    state,
    addRoute: (route: FetchRoute) => {
      extraRoutes.push(route);
      stub();
    },
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /v1/registration", () => {
  it("returns brand + campaign rows; wizard data only for owner/admin", async () => {
    const harness = buildHarness();
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "pending",
      telnyx_id: "brand-1",
      data: BRAND_BODY,
    });

    const adminRes = await harness.request("/v1/registration");
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as {
      brand: Record<string, unknown>;
      campaign: unknown;
    };
    expect(adminBody.brand.status).toBe("pending");
    expect(adminBody.brand.data).toMatchObject({ ein: "12-3456789" });
    expect(adminBody.campaign).toBeNull();
    // Vendor id never leaves the server.
    expect(adminBody.brand.telnyx_id).toBeUndefined();

    harness.state.role = "member";
    const memberRes = await harness.request("/v1/registration");
    const memberBody = (await memberRes.json()) as {
      brand: Record<string, unknown>;
    };
    expect(memberBody.brand.status).toBe("pending");
    expect(memberBody.brand.data).toBeUndefined();
  });
});

describe("PUT /v1/registration", () => {
  it("is owner/admin only", async () => {
    const harness = buildHarness();
    harness.state.role = "member";
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: BRAND_BODY }),
    );
    expect(res.status).toBe(403);
  });

  it("upserts brand + campaign drafts (EIN branch)", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: BRAND_BODY, campaign: CAMPAIGN_BODY }),
    );
    expect(res.status).toBe(200);
    const rows = harness.rest.rows("messaging_registrations");
    expect(rows).toHaveLength(2);
    const brand = rows.find((row) => row.kind === "brand");
    expect(brand?.status).toBe("draft");
    expect(brand?.sole_proprietor).toBe(false);
    expect(brand?.data).toMatchObject({ companyName: "Acme Plumbing LLC" });
  });

  it("upserts the sole-prop branch and flags both rows", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: SOLE_PROP_BODY, campaign: CAMPAIGN_BODY }),
    );
    expect(res.status).toBe(200);
    for (const row of harness.rest.rows("messaging_registrations")) {
      expect(row.sole_proprietor).toBe(true);
    }
  });

  it("rejects a payload mixing the EIN and sole-prop branches (422)", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", {
        brand: { ...BRAND_BODY, firstName: "Pat", mobilePhone: "+12125550111" },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects a sole-prop last-4 that is not exactly 4 digits (SPEC §10: never a full SSN)", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: { ...SOLE_PROP_BODY, ein: "123456789" } }),
    );
    expect(res.status).toBe(422);
  });

  it("409s once the row is submitted (immutable outside draft/rejected)", async () => {
    const harness = buildHarness();
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "submitted",
      telnyx_id: "brand-1",
      data: BRAND_BODY,
    });
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: BRAND_BODY }),
    );
    expect(res.status).toBe(409);
  });

  it("allows editing a rejected row (fix-and-resubmit, §4.4 R4)", async () => {
    const harness = buildHarness();
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "rejected",
      telnyx_id: "brand-1",
      rejection_reason: "bad EIN",
      data: BRAND_BODY,
    });
    const res = await harness.request(
      "/v1/registration",
      jsonInit("PUT", { brand: { ...BRAND_BODY, ein: "98-7654321" } }),
    );
    expect(res.status).toBe(200);
    const brand = harness.rest
      .rows("messaging_registrations")
      .find((row) => row.kind === "brand");
    expect(brand?.data).toMatchObject({ ein: "98-7654321" });
    expect(brand?.status).toBe("rejected"); // submit flips it, not PUT
  });
});

describe("POST /v1/registration/submit", () => {
  it("409s when the fee has not been paid", async () => {
    const harness = buildHarness({ registration_fee_paid_at: null });
    const res = await harness.request("/v1/registration/submit", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("409s for CA companies without us_texting_enabled", async () => {
    const harness = buildHarness({
      country: "CA",
      us_texting_enabled: false,
    });
    const res = await harness.request("/v1/registration/submit", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("submits a complete draft (R1) and reports the action", async () => {
    const harness = buildHarness();
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      data: BRAND_BODY,
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      data: CAMPAIGN_BODY,
    });
    harness.telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-1" },
    }));

    const res = await harness.request("/v1/registration/submit", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      action: string;
      brand: { status: string };
    };
    expect(body.action).toBe("brand_submitted");
    expect(body.brand.status).toBe("submitted");
  });

  it("409s (with the reason) when there is nothing to submit", async () => {
    const harness = buildHarness();
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "pending",
      telnyx_id: "brand-1",
      data: BRAND_BODY,
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      data: CAMPAIGN_BODY,
    });
    const res = await harness.request("/v1/registration/submit", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/registration/otp and /otp/resend", () => {
  function seedSoleProp(harness: ReturnType<typeof buildHarness>) {
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      status: "submitted",
      sole_proprietor: true,
      telnyx_id: "brand-sp",
      data: SOLE_PROP_BODY,
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      sole_proprietor: true,
      data: CAMPAIGN_BODY,
    });
  }

  it("verifies the PIN via PUT smsOtp and applies the VERIFIED transition (R2 follows)", async () => {
    const harness = buildHarness();
    seedSoleProp(harness);
    harness.telnyx.on(
      "PUT",
      /^\/v2\/10dlc\/brand\/brand-sp\/smsOtp$/,
      (call) => {
        expect(call.body).toEqual({ otpPin: "123456" });
        return {};
      },
    );
    harness.telnyx.on("GET", /^\/v2\/10dlc\/brand\/brand-sp$/, () => ({
      data: { brandId: "brand-sp", identityStatus: "VERIFIED" },
    }));
    harness.telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    const res = await harness.request(
      "/v1/registration/otp",
      jsonInit("POST", { code: "123456" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brand: { status: string };
      campaign: { status: string };
    };
    expect(body.brand.status).toBe("approved");
    expect(body.campaign.status).toBe("submitted");
  });

  it("maps a wrong/expired PIN to 422 validation_failed (§7)", async () => {
    const harness = buildHarness();
    seedSoleProp(harness);
    harness.telnyx.on("PUT", /^\/v2\/10dlc\/brand\/brand-sp\/smsOtp$/, () =>
      telnyxError(422, "10015", "OTP mismatch"),
    );
    const res = await harness.request(
      "/v1/registration/otp",
      jsonInit("POST", { code: "000000" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("validates the code shape before calling Telnyx", async () => {
    const harness = buildHarness();
    seedSoleProp(harness);
    const res = await harness.request(
      "/v1/registration/otp",
      jsonInit("POST", { code: "12" }),
    );
    expect(res.status).toBe(422);
    expect(harness.telnyx.calls).toHaveLength(0);
  });

  it("409s when there is no submitted sole-prop brand", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/registration/otp",
      jsonInit("POST", { code: "123456" }),
    );
    expect(res.status).toBe(409);
  });

  it("resends the OTP (fresh PIN) via POST smsOtp", async () => {
    const harness = buildHarness();
    seedSoleProp(harness);
    harness.telnyx.on(
      "POST",
      /^\/v2\/10dlc\/brand\/brand-sp\/smsOtp$/,
      () => ({}),
    );
    const res = await harness.request("/v1/registration/otp/resend", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(harness.telnyx.callsTo("POST", /smsOtp$/)).toHaveLength(1);
  });
});

describe("POST /v1/registration/enable-us", () => {
  function stripeRoute(calls: { path: string; body: URLSearchParams }[]): FetchRoute {
    return async (url, request) => {
      if (url.origin !== "https://api.stripe.com") return undefined;
      const body = new URLSearchParams(await request.clone().text());
      calls.push({ path: url.pathname, body });
      if (url.pathname === "/v1/invoices" && request.method === "POST") {
        return Response.json({ id: "in_1", object: "invoice", status: "draft" });
      }
      if (url.pathname === "/v1/invoiceitems" && request.method === "POST") {
        return Response.json({ id: "ii_1", object: "invoiceitem" });
      }
      if (url.pathname === "/v1/invoices/in_1/finalize") {
        return Response.json({ id: "in_1", object: "invoice", status: "open" });
      }
      return Response.json(
        { error: { message: `unexpected ${url.pathname}` } },
        { status: 500 },
      );
    };
  }

  function seedCompleteWizard(harness: ReturnType<typeof buildHarness>) {
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "brand",
      data: BRAND_BODY,
    });
    harness.rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      data: CAMPAIGN_BODY,
    });
  }

  it("is owner-only (§10 role matrix)", async () => {
    const harness = buildHarness({ country: "CA", us_texting_enabled: false });
    harness.state.role = "admin";
    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("409s for US companies", async () => {
    const harness = buildHarness();
    harness.state.role = "owner";
    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("409s when US texting is already enabled", async () => {
    const harness = buildHarness({ country: "CA", us_texting_enabled: true });
    harness.state.role = "owner";
    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("409s while the wizard is incomplete (mirrors the checkout gate)", async () => {
    const harness = buildHarness({
      country: "CA",
      us_texting_enabled: false,
      registration_fee_paid_at: null,
    });
    harness.state.role = "owner";
    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("creates the $29 invoice with metadata purpose=us_registration (§4.2)", async () => {
    const harness = buildHarness({
      country: "CA",
      us_texting_enabled: false,
      registration_fee_paid_at: null,
    });
    harness.state.role = "owner";
    seedCompleteWizard(harness);
    const stripeCalls: { path: string; body: URLSearchParams }[] = [];
    harness.addRoute(stripeRoute(stripeCalls));

    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      us_texting_enabled: boolean;
      invoice_id: string;
    };
    expect(body.us_texting_enabled).toBe(true);
    expect(body.invoice_id).toBe("in_1");

    expect(harness.rest.rows("companies")[0].us_texting_enabled).toBe(true);

    const invoiceCreate = stripeCalls.find((call) => call.path === "/v1/invoices");
    expect(invoiceCreate?.body.get("metadata[purpose]")).toBe("us_registration");
    expect(invoiceCreate?.body.get("metadata[company_id]")).toBe(COMPANY_ID);
    expect(invoiceCreate?.body.get("collection_method")).toBe(
      "charge_automatically",
    );

    const itemCreate = stripeCalls.find((call) => call.path === "/v1/invoiceitems");
    expect(itemCreate?.body.get("invoice")).toBe("in_1");
    expect(itemCreate?.body.get("pricing[price]")).toBe(
      harness.env.STRIPE_US_FEE_PRICE_ID,
    );

    expect(
      stripeCalls.some((call) => call.path === "/v1/invoices/in_1/finalize"),
    ).toBe(true);
    // Submission happens on invoice.paid (§9), never here.
    expect(harness.telnyx.calls).toHaveLength(0);
  });

  it("skips the invoice and submits immediately when the fee was already paid (§2)", async () => {
    const harness = buildHarness({
      country: "CA",
      us_texting_enabled: false,
      registration_fee_paid_at: "2026-01-01T00:00:00.000Z",
    });
    harness.state.role = "owner";
    seedCompleteWizard(harness);
    harness.telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-1" },
    }));

    const res = await harness.request("/v1/registration/enable-us", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; invoice_id: null };
    expect(body.invoice_id).toBeNull();
    expect(body.action).toBe("brand_submitted");
    expect(harness.telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(1);
  });
});
