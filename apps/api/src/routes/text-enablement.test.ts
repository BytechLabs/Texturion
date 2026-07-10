/**
 * Keep-your-number TEXT-ENABLEMENT routes (FEATURE-GAPS voice wave, path B).
 * Create (with idempotent slot claim + hosted-order saga), list, get, document
 * upload (LOA + bill → /v2/documents → hosted-order file_upload), ownership
 * verification (verification_codes / validation_codes), resubmit (including
 * the dead-order recreate), cancel. The claim_text_enablement_slot RPC is
 * doubled faithfully (the SQL itself is covered by supabase/tests + a pgTAP
 * block); the Telnyx hosted-order endpoints are the real client against a
 * TelnyxMock. Only fetch is stubbed. Telnyx statuses in the mocks are the REAL
 * MessagingHostedNumberOrder.status vocabulary from the OpenAPI spec.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { textEnablementRoutes } from "./text-enablement";
import type { AppEnv, MemberRole } from "../context";
import type { Bindings, RateLimiter } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  FakeRest,
  registerTextEnablementRpcs,
  resendRoute,
  TelnyxMock,
} from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const NUMBER_E164 = "+13035550000";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const PHONE_DEFAULTS = {
  status: "provisioning",
  source: "provisioned",
  porting_status: null,
  number_e164: null,
  telnyx_phone_number_id: null,
};

const ORDER_DEFAULTS = {
  telnyx_hosted_order_id: null,
  telnyx_hosted_number_id: null,
  telnyx_loa_document_id: null,
  telnyx_bill_document_id: null,
  status: "pending",
  last_error: null,
  attempts: 0,
  verification_requests: 0,
  resubmit_count: 0,
  completed_at: null,
  cancelled_at: null,
};

/** Faithful double of claim_text_enablement_slot (SQL covered by pgTAP). */
function installSlotRpc(rest: FakeRest) {
  rest.rpc("claim_text_enablement_slot", (args) => {
    const orders = rest.rows("text_enablement_orders");
    const existing = orders.find(
      (o) => o.provisioning_key === args.p_provisioning_key,
    );
    if (existing) {
      const num = rest
        .rows("phone_numbers")
        .find((n) => n.id === existing.phone_number_id);
      return { outcome: "exists", number: num, order: existing };
    }
    const nonReleased = rest
      .rows("phone_numbers")
      .filter(
        (n) => n.company_id === args.p_company_id && n.status !== "released",
      );
    const soleProp = rest
      .rows("messaging_registrations")
      .some(
        (r) =>
          r.company_id === args.p_company_id &&
          r.kind === "brand" &&
          r.sole_proprietor === true,
      );
    if (soleProp && nonReleased.length >= 1) {
      return { outcome: "sole_prop_cap", number: null, order: null };
    }
    if (nonReleased.length >= Number(args.p_max_numbers)) {
      return { outcome: "plan_limit", number: null, order: null };
    }
    // The phone_numbers unique index is the cross-company arbiter: inserting a
    // number already in service raises unique_violation → 'number_taken'.
    const taken = rest
      .rows("phone_numbers")
      .some(
        (n) => n.number_e164 === args.p_phone_e164 && n.status !== "released",
      );
    if (taken) {
      return { outcome: "number_taken", number: null, order: null };
    }
    const number = rest.insert("phone_numbers", {
      company_id: args.p_company_id,
      status: "provisioning",
      source: "hosted",
      provisioning_key: args.p_provisioning_key,
      country: args.p_country,
      number_e164: args.p_phone_e164,
    });
    const order = rest.insert("text_enablement_orders", {
      company_id: args.p_company_id,
      phone_number_id: number.id,
      phone_e164: args.p_phone_e164,
      country: args.p_country,
      provisioning_key: args.p_provisioning_key,
      status: "pending",
    });
    return { outcome: "created", number, order };
  });
}

/** Faithful double of bump_text_enablement_counter (SQL covered by VW-18). */
function installBumpRpc(rest: FakeRest) {
  rest.rpc("bump_text_enablement_counter", (args) => {
    const counter = String(args.p_counter) as
      | "verification_requests"
      | "resubmit_count";
    const order = rest
      .rows("text_enablement_orders")
      .find(
        (o) => o.id === args.p_order_id && o.company_id === args.p_company_id,
      );
    if (!order || Number(order[counter]) >= Number(args.p_cap)) {
      return { allowed: false };
    }
    order[counter] = Number(order[counter]) + 1;
    return { allowed: true, count: order[counter] };
  });
}

function buildHarness(
  companyOverrides: Record<string, unknown> = {},
  extraRoutes: FetchRoute[] = [],
) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("phone_numbers", PHONE_DEFAULTS);
  rest.table("text_enablement_orders", ORDER_DEFAULTS);
  rest.table("company_members");
  rest.table("messaging_registrations");
  // §4.3 double-order fail-safe: the saga claims a per-row lease + order key.
  registerTextEnablementRpcs(rest);
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
  installSlotRpc(rest);
  installBumpRpc(rest);

  const telnyx = new TelnyxMock();
  const state = {
    role: "admin" as MemberRole,
    hostedStatus: "pending" as string,
    docSeq: 0,
  };
  telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => ({
    data: {
      id: "hosted-order-1",
      status: state.hostedStatus,
      phone_numbers: [{ id: "hosted-number-1", phone_number: NUMBER_E164 }],
    },
  }));
  telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/[^/]+$/, () => ({
    data: { id: "hosted-order-1", status: state.hostedStatus },
  }));
  // Cancel = DELETE the hosted order (no /actions/cancel in the hosted API).
  telnyx.on("DELETE", /^\/v2\/messaging_hosted_number_orders\/[^/]+$/, () => ({
    data: { id: "hosted-order-1", status: "deleted" },
  }));
  // Documents API: store (returns a fresh UUID-ish id) + download-back.
  telnyx.on("POST", /^\/v2\/documents$/, () => ({
    data: { id: `doc-${++state.docSeq}` },
  }));
  telnyx.on(
    "GET",
    /^\/v2\/documents\/[^/]+\/download$/,
    () => new Response(new Uint8Array([1, 2, 3])),
  );
  telnyx.on(
    "POST",
    /^\/v2\/messaging_hosted_number_orders\/[^/]+\/actions\/file_upload$/,
    () => ({ data: { id: "hosted-order-1", status: state.hostedStatus } }),
  );

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", state.role);
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1/text-enablements", textEnablementRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  stubFetch(...extraRoutes, rest.route(), telnyx.route(), resendRoute([]));

  return {
    env,
    rest,
    telnyx,
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
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** Seed a phone_numbers[source=hosted] row + its order directly (no POST). */
function seedOrder(
  h: ReturnType<typeof buildHarness>,
  orderOverrides: Record<string, unknown> = {},
) {
  const number = h.rest.insert("phone_numbers", {
    company_id: COMPANY_ID,
    status: "provisioning",
    source: "hosted",
    provisioning_key: "seed-key",
    country: "US",
    number_e164: NUMBER_E164,
  });
  return h.rest.insert("text_enablement_orders", {
    company_id: COMPANY_ID,
    phone_number_id: number.id,
    phone_e164: NUMBER_E164,
    country: "US",
    provisioning_key: "seed-key",
    telnyx_hosted_order_id: "hosted-order-1",
    telnyx_hosted_number_id: "hosted-number-1",
    ...orderOverrides,
  });
}

function docForm(fields: ("loa" | "bill")[], type = "application/pdf"): FormData {
  const form = new FormData();
  for (const field of fields) {
    form.append(
      field,
      new Blob([new Uint8Array([1, 2, 3])], { type }),
      `${field}.pdf`,
    );
  }
  return form;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/text-enablements", () => {
  it("creates a hosted text-enablement order for an existing number", async () => {
    const h = buildHarness();
    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { phone_e164: string; status: string };
    expect(body.phone_e164).toBe(NUMBER_E164);
    expect(body.status).toBe("pending");
    // A source='hosted' phone_numbers row + a text_enablement_orders row exist.
    expect(
      h.rest.rows("phone_numbers").some((n) => n.source === "hosted"),
    ).toBe(true);
    // The Telnyx hosted order was created.
    expect(
      h.telnyx.callsTo("POST", /messaging_hosted_number_orders$/),
    ).toHaveLength(1);
  });

  it("requires an Idempotency-Key", async () => {
    const h = buildHarness();
    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }),
    );
    expect(res.status).toBe(422);
  });

  it("is idempotent on the Idempotency-Key (replay returns the same order)", async () => {
    const h = buildHarness();
    const first = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(first.status).toBe(201);
    const replay = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(replay.status).toBe(200);
    // Only one hosted order was ever created.
    expect(h.rest.rows("text_enablement_orders")).toHaveLength(1);
  });

  it("rejects a non-US/CA number", async () => {
    const h = buildHarness();
    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: "+447700900000" }, KEY),
    );
    expect(res.status).toBe(422);
  });

  it("blocks when the subscription is not active", async () => {
    const h = buildHarness({ subscription_status: "past_due" });
    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(res.status).toBe(402);
  });

  it("409s a second enablement for the same number", async () => {
    const h = buildHarness();
    await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    const second = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    );
    expect(second.status).toBe(409);
  });

  it("409s a number already in service on Loonext (RPC outcome number_taken)", async () => {
    const h = buildHarness();
    // Another company's live number occupies the unique index.
    h.rest.insert("phone_numbers", {
      company_id: "99999999-9999-4999-8999-999999999999",
      status: "active",
      source: "provisioned",
      number_e164: NUMBER_E164,
    });
    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("already in service");
    // No slot was claimed and no Telnyx order created.
    expect(h.rest.rows("text_enablement_orders")).toHaveLength(0);
    expect(h.telnyx.calls).toHaveLength(0);
  });

  // #108: text-enablement counts the company's PAID extra-number capacity.
  const PRO_EXTRA_PRICE = completeEnv()
    .STRIPE_EXTRA_NUMBER_PRO_PRICE_ID as string;

  /** A Stripe stub for sub_1 carrying the given subscription items. */
  function stripeSubStub(
    items: { id: string; price: string; quantity: number }[],
  ): FetchRoute {
    return (url) => {
      if (url.host !== "api.stripe.com") return undefined;
      if (url.pathname === "/v1/subscriptions/sub_1") {
        return Response.json({
          id: "sub_1",
          object: "subscription",
          status: "active",
          schedule: null,
          items: {
            object: "list",
            has_more: false,
            data: items.map((i) => ({
              id: i.id,
              object: "subscription_item",
              price: { id: i.price, object: "price" },
              quantity: i.quantity,
            })),
          },
        });
      }
      return Response.json({ error: { message: "unhandled" } }, { status: 500 });
    };
  }

  function seedActiveNumber(h: ReturnType<typeof buildHarness>, e164: string) {
    h.rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      source: "provisioned",
      number_e164: e164,
    });
  }

  it("#108: text-enables INTO paid extra capacity — no plan_limit at the included cap", async () => {
    // Pro (2 included) with 1 PAID extra → effective allowance 3. Already at the
    // included cap (2 numbers): the old code capped at 2 and 409'd; now the paid
    // slot admits the enable.
    const h = buildHarness({ stripe_subscription_id: "sub_1", plan: "pro" }, [
      stripeSubStub([{ id: "si_x", price: PRO_EXTRA_PRICE, quantity: 1 }]),
    ]);
    seedActiveNumber(h, "+13035550001");
    seedActiveNumber(h, "+13035550002");

    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(res.status).toBe(201);
    expect(h.rest.rows("text_enablement_orders")).toHaveLength(1);
  });

  it("#108: 409s only once every included AND paid slot is full", async () => {
    // Pro (2 included) + 1 paid = allowance 3, and already holding 3 numbers.
    const h = buildHarness({ stripe_subscription_id: "sub_1", plan: "pro" }, [
      stripeSubStub([{ id: "si_x", price: PRO_EXTRA_PRICE, quantity: 1 }]),
    ]);
    seedActiveNumber(h, "+13035550001");
    seedActiveNumber(h, "+13035550002");
    seedActiveNumber(h, "+13035550003");

    const res = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("using all 3");
    expect(h.rest.rows("text_enablement_orders")).toHaveLength(0);
  });
});

describe("GET + cancel", () => {
  it("lists the company's enablements", async () => {
    const h = buildHarness();
    await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    const res = await h.request("/v1/text-enablements");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { created_at: unknown }[] };
    expect(body.data).toHaveLength(1);
    // created_at is part of the response (the UI sorts/labels by it).
    expect(typeof body.data[0].created_at).toBe("string");
  });

  it("owner cancels a pending enablement and releases the number", async () => {
    const h = buildHarness();
    const created = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    const { id } = (await created.json()) as { id: string };

    // Cancel is owner-only.
    h.state.role = "owner";
    const res = await h.request(
      `/v1/text-enablements/${id}/cancel`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("cancelled");
    // The phone_numbers row is released (slot freed).
    const number = h.rest
      .rows("phone_numbers")
      .find((n) => n.source === "hosted");
    expect(number?.status).toBe("released");
    // Cancel = DELETE the hosted order on Telnyx.
    expect(
      h.telnyx.callsTo("DELETE", /^\/v2\/messaging_hosted_number_orders\//),
    ).toHaveLength(1);
  });
});

describe("PUT /v1/text-enablements/:id/documents", () => {
  it("uploads both documents, stores their ids, and attaches them to the hosted order", async () => {
    const h = buildHarness();
    const order = seedOrder(h);

    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa", "bill"]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { has_loa: boolean; has_bill: boolean };
    expect(body.has_loa).toBe(true);
    expect(body.has_bill).toBe(true);

    // Both files went to the Documents API and their ids landed on the row.
    expect(h.telnyx.callsTo("POST", /^\/v2\/documents$/)).toHaveLength(2);
    const row = h.rest.rows("text_enablement_orders")[0];
    expect(row.telnyx_loa_document_id).toBe("doc-1");
    expect(row.telnyx_bill_document_id).toBe("doc-2");

    // Both present → downloaded back and attached to the hosted order.
    expect(h.telnyx.callsTo("GET", /\/download$/)).toHaveLength(2);
    expect(h.telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(1);
  });

  it("accepts one document at a time; attach fires only once both are present", async () => {
    const h = buildHarness();
    const order = seedOrder(h);

    const first = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa"]),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { has_bill: boolean }).has_bill).toBe(false);
    expect(h.telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(0);

    const second = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["bill"]),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { has_bill: boolean }).has_bill).toBe(true);
    expect(h.telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(1);
  });

  it("rejects an oversized declared Content-Length before buffering the body (§10)", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      // The body is never parsed: the declared length alone is refused.
      body: "irrelevant",
      headers: { "Content-Length": String(64 * 1024 * 1024) },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("upload limit");
    expect(h.telnyx.calls).toHaveLength(0);
  });

  it("rejects a non-PDF file (the hosted file_upload action is PDF-only)", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa"], "image/png"),
    });
    expect(res.status).toBe(422);
    expect(h.telnyx.callsTo("POST", /^\/v2\/documents$/)).toHaveLength(0);
  });

  it("blocks the upload until the subscription is active (paid-first) — no Telnyx call", async () => {
    const h = buildHarness({ subscription_status: "past_due" });
    const order = seedOrder(h);
    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa", "bill"]),
    });
    expect(res.status).toBe(402);
    expect(h.telnyx.callsTo("POST", /^\/v2\/documents$/)).toHaveLength(0);
    const row = h.rest.rows("text_enablement_orders")[0];
    expect(row.telnyx_loa_document_id ?? null).toBeNull();
  });

  it("409s outside the upload window (completed order)", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { status: "completed" });
    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa"]),
    });
    expect(res.status).toBe(409);
  });

  it("is owner/admin only", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.state.role = "member";
    const res = await h.request(`/v1/text-enablements/${order.id}/documents`, {
      method: "PUT",
      body: docForm(["loa"]),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/text-enablements/:id/resubmit", () => {
  it("recreates a dead Telnyx order from 'failed': old order deleted, fresh order created, docs re-attached", async () => {
    const h = buildHarness();
    const order = seedOrder(h, {
      status: "failed",
      attempts: 5,
      last_error:
        "Carrier rejected the hosted-messaging order (Telnyx status: carrier_rejected)",
      telnyx_loa_document_id: "doc-loa",
      telnyx_bill_document_id: "doc-bill",
    });
    h.state.hostedStatus = "provisioning";

    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(200);

    // The dead Telnyx order was deleted (a rejected order is never
    // re-reviewed) and a FRESH one was created — not polled.
    expect(
      h.telnyx.callsTo(
        "DELETE",
        /^\/v2\/messaging_hosted_number_orders\/hosted-order-1$/,
      ),
    ).toHaveLength(1);
    expect(
      h.telnyx.callsTo("POST", /messaging_hosted_number_orders$/),
    ).toHaveLength(1);
    // The already-uploaded LOA/bill were re-attached to the fresh order.
    expect(h.telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(1);

    // The saga ran (no executionCtx in tests → awaited inline): the create
    // response status landed and the budget returned.
    const row = h.rest.rows("text_enablement_orders")[0];
    expect(row.status).toBe("in-progress"); // Telnyx 'provisioning'
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.telnyx_hosted_order_id).toBe("hosted-order-1");
    // The resubmit consumed one unit of the durable lifetime budget — the
    // attempts reset above never touches it.
    expect(row.resubmit_count).toBe(1);
  });

  it("is allowed from 'action-required' and KEEPS the existing Telnyx order", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { status: "action-required" });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(200);
    // Not a dead order — nothing deleted, the saga polls it instead.
    expect(
      h.telnyx.callsTo("DELETE", /^\/v2\/messaging_hosted_number_orders\//),
    ).toHaveLength(0);
    expect(
      h.telnyx.callsTo("GET", /^\/v2\/messaging_hosted_number_orders\//),
    ).toHaveLength(1);
  });

  it("402s while the subscription is not active (paid-first) — no Telnyx call", async () => {
    const h = buildHarness({ subscription_status: "past_due" });
    const order = seedOrder(h, { status: "failed" });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(402);
    expect(h.telnyx.calls).toHaveLength(0);
  });

  it("409s from any other status", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { status: "pending" });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(409);
  });

  it("is owner/admin only", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { status: "failed" });
    h.state.role = "member";
    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(403);
  });
});

describe("verification codes (number-ownership check)", () => {
  it("asks Telnyx to send a code to the number (sms) for an order under review", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [
        {
          phone_number: NUMBER_E164,
          verification_code_id: "vc-1",
          type: "sms",
        },
      ],
    }));

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requested: boolean };
    expect(body.requested).toBe(true);
    const calls = h.telnyx.callsTo("POST", /\/verification_codes$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      phone_numbers: [NUMBER_E164],
      verification_method: "sms",
    });
  });

  it("422s when Telnyx reports a per-number delivery error", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [
        { phone_number: NUMBER_E164, error: "landline cannot receive sms" },
      ],
    }));

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("landline cannot receive sms");
  });

  it("verifies the received code against Telnyx", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/validation_codes$/, () => ({
      data: {
        order_id: "hosted-order-1",
        phone_numbers: [{ phone_number: NUMBER_E164, status: "verified" }],
      },
    }));

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes/verify`,
      jsonInit("POST", { code: "123456" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean };
    expect(body.verified).toBe(true);
    const calls = h.telnyx.callsTo("POST", /\/validation_codes$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      verification_codes: [{ phone_number: NUMBER_E164, code: "123456" }],
    });
  });

  it("422s a rejected code", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/validation_codes$/, () => ({
      data: {
        order_id: "hosted-order-1",
        phone_numbers: [{ phone_number: NUMBER_E164, status: "rejected" }],
      },
    }));

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes/verify`,
      jsonInit("POST", { code: "000000" }),
    );
    expect(res.status).toBe(422);
  });

  it("409s before the Telnyx hosted order exists", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { telnyx_hosted_order_id: null });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(409);
    expect(h.telnyx.calls).toHaveLength(0);
  });

  it("409s once the order is terminal (completed)", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { status: "completed" });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "call" }),
    );
    expect(res.status).toBe(409);
  });

  it("is owner/admin only", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.state.role = "member";
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes/verify`,
      jsonInit("POST", { code: "123456" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("verification rate limit (VERIFY_RATE_LIMITER, per target number)", () => {
  function fakeLimiter(success: boolean): RateLimiter & {
    limit: ReturnType<typeof vi.fn>;
  } {
    return { limit: vi.fn(async (_options: { key: string }) => ({ success })) };
  }

  it("429s a denied code request — the SMS/call-bomb path never reaches Telnyx", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    const limiter = fakeLimiter(false);
    h.env.VERIFY_RATE_LIMITER = limiter;

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "call" }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
    // Keyed on the TARGET number (the would-be victim), not the order id — a
    // cancel-and-recreate cycle can never reset the budget.
    expect(limiter.limit).toHaveBeenCalledExactlyOnceWith({
      key: `te-verify-send:${NUMBER_E164}`,
    });
    expect(h.telnyx.calls).toHaveLength(0);
  });

  it("passes an allowed code request through to Telnyx", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.env.VERIFY_RATE_LIMITER = fakeLimiter(true);
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [{ phone_number: NUMBER_E164, verification_code_id: "vc-1" }],
    }));

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(200);
    expect(h.telnyx.callsTo("POST", /\/verification_codes$/)).toHaveLength(1);
  });

  it("429s a denied code check — the brute-force path never reaches Telnyx", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    const limiter = fakeLimiter(false);
    h.env.VERIFY_RATE_LIMITER = limiter;

    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes/verify`,
      jsonInit("POST", { code: "123456" }),
    );
    expect(res.status).toBe(429);
    // A separate key from the send path: requesting codes never burns the
    // check budget (and vice versa).
    expect(limiter.limit).toHaveBeenCalledExactlyOnceWith({
      key: `te-verify-check:${NUMBER_E164}`,
    });
    expect(h.telnyx.calls).toHaveLength(0);
  });

  it("is skipped when the binding is absent (local dev/tests)", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [{ phone_number: NUMBER_E164, verification_code_id: "vc-1" }],
    }));
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("lifetime caps (durable per-order budgets, §10)", () => {
  it("counts each verification-code send against the order's budget", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [{ phone_number: NUMBER_E164, verification_code_id: "vc-1" }],
    }));
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(200);
    expect(
      h.rest.rows("text_enablement_orders")[0].verification_requests,
    ).toBe(1);
  });

  it("409s the send once the lifetime cap is spent — Telnyx is never called", async () => {
    const h = buildHarness();
    const order = seedOrder(h, { verification_requests: 10 });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain(
      "Too many verification attempts for this order",
    );
    expect(h.telnyx.calls).toHaveLength(0);
    // A capped bump never increments past the cap.
    expect(
      h.rest.rows("text_enablement_orders")[0].verification_requests,
    ).toBe(10);
  });

  it("a rate-limited send never burns the lifetime budget (429 first)", async () => {
    const h = buildHarness();
    const order = seedOrder(h);
    h.env.VERIFY_RATE_LIMITER = {
      limit: vi.fn(async (_options: { key: string }) => ({ success: false })),
    };
    const res = await h.request(
      `/v1/text-enablements/${order.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(res.status).toBe(429);
    expect(
      h.rest.rows("text_enablement_orders")[0].verification_requests,
    ).toBe(0);
  });

  it("409s the resubmit once its lifetime cap is spent — order left untouched", async () => {
    const h = buildHarness();
    const order = seedOrder(h, {
      status: "failed",
      attempts: 5,
      resubmit_count: 5,
    });
    const res = await h.request(
      `/v1/text-enablements/${order.id}/resubmit`,
      jsonInit("POST", undefined),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("resubmitted too many times");
    // No Telnyx side effects, no reset: the dead order stays exactly as it was.
    expect(h.telnyx.calls).toHaveLength(0);
    const row = h.rest.rows("text_enablement_orders")[0];
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
    expect(row.resubmit_count).toBe(5);
  });

  it("caps are per ORDER row: cancel/recreate mints a fresh budget while the per-NUMBER rate limiter spans orders", async () => {
    const h = buildHarness();
    const capped = seedOrder(h, { verification_requests: 10 });
    const limiter = {
      limit: vi.fn(async (_options: { key: string }) => ({ success: true })),
    };
    h.env.VERIFY_RATE_LIMITER = limiter;
    h.telnyx.on("POST", /\/verification_codes$/, () => ({
      data: [{ phone_number: NUMBER_E164, verification_code_id: "vc-1" }],
    }));
    h.state.role = "owner"; // owner ⊃ admin: covers cancel + create + verify

    // The capped order 409s even though the rate limiter allows the request.
    const denied = await h.request(
      `/v1/text-enablements/${capped.id}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(denied.status).toBe(409);

    // Cancel, then text-enable the same number again → a NEW order row.
    const cancelled = await h.request(
      `/v1/text-enablements/${capped.id}/cancel`,
      jsonInit("POST", undefined),
    );
    expect(cancelled.status).toBe(200);
    const created = await h.request(
      "/v1/text-enablements",
      jsonInit("POST", { phone_e164: NUMBER_E164 }, KEY),
    );
    expect(created.status).toBe(201);
    const { id: freshId } = (await created.json()) as { id: string };

    // The fresh order's budget starts at 0 (by design — per order row) and
    // this send consumes its first unit; the old row stays at its cap.
    const allowed = await h.request(
      `/v1/text-enablements/${freshId}/verification-codes`,
      jsonInit("POST", { verification_method: "sms" }),
    );
    expect(allowed.status).toBe(200);
    const rows = h.rest.rows("text_enablement_orders");
    expect(rows.find((o) => o.id === capped.id)?.verification_requests).toBe(10);
    expect(rows.find((o) => o.id === freshId)?.verification_requests).toBe(1);

    // The cross-order guard is the per-NUMBER rate-limit key: both orders'
    // sends hit the SAME key, so recreation never resets the RATE budget.
    expect(limiter.limit).toHaveBeenCalledTimes(2);
    for (const call of limiter.limit.mock.calls) {
      expect(call[0]).toEqual({ key: `te-verify-send:${NUMBER_E164}` });
    }
  });
});
