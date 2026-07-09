/**
 * Keep-your-number text-enablement saga (telnyx level, D13 style): only global
 * fetch is stubbed — resumeTextEnablement / cancelTextEnablement /
 * releaseNumberRow run their real Supabase + Telnyx HTTP paths against
 * FakeRest + TelnyxMock. Covers the REAL Telnyx hosted-order status mapping
 * (spec vocabulary: pending/provisioning/loa_file_successful/…/successful),
 * the attempt-budget discipline (failed passes consume, successful passes
 * return; exhaustion lands VISIBLY at status='failed'), the S2b document
 * attach (download-back from /v2/documents → hosted-order file_upload), the
 * cancel-race guards (a cancel landing mid-flight always wins), the
 * DELETE-based cancel, and the hosted branch of releaseNumberRow.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { releaseNumberRow, type PhoneNumberRow } from "./provisioning";
import {
  FakeRest,
  registerTextEnablementRpcs,
  TelnyxMock,
  telnyxError,
} from "./test-support";
import {
  cancelTextEnablement,
  mapHostedStatus,
  resumeTextEnablement,
  MAX_ENABLEMENT_ATTEMPTS,
  type TextEnablementOrderRow,
} from "./text-enablement";
import { completeEnv, stubFetch } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const E164 = "+13035550000";

const PHONE_DEFAULTS = {
  status: "provisioning",
  source: "hosted",
  requested_area_code: null,
  number_e164: null,
  telnyx_phone_number_id: null,
  telnyx_order_id: null,
  provision_attempts: 0,
  last_provision_error: null,
  suspended_at: null,
  released_at: null,
};

const ORDER_DEFAULTS = {
  telnyx_hosted_order_id: null,
  telnyx_hosted_number_id: null,
  telnyx_loa_document_id: null,
  telnyx_bill_document_id: null,
  status: "pending",
  last_error: null,
  attempts: 0,
  completed_at: null,
  cancelled_at: null,
};

function setup() {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("phone_numbers", PHONE_DEFAULTS);
  rest.table("text_enablement_orders", ORDER_DEFAULTS);
  // §4.3 double-order fail-safe: the saga claims a per-row lease + order key.
  registerTextEnablementRpcs(rest);
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    requested_area_code: "303",
    telnyx_messaging_profile_id: "profile-1",
    subscription_status: "active",
  });
  const telnyx = new TelnyxMock();
  stubFetch(rest.route(), telnyx.route());
  return { env, rest, telnyx };
}

/** Seed a hosted phone_numbers row + its enablement order; returns both. */
function seedHosted(
  rest: FakeRest,
  orderOverrides: Record<string, unknown> = {},
  phoneOverrides: Record<string, unknown> = {},
) {
  const phone = rest.insert("phone_numbers", {
    company_id: COMPANY_ID,
    provisioning_key: "key-1",
    country: "US",
    number_e164: E164,
    ...phoneOverrides,
  });
  const order = rest.insert("text_enablement_orders", {
    company_id: COMPANY_ID,
    phone_number_id: phone.id,
    phone_e164: E164,
    country: "US",
    provisioning_key: "key-1",
    ...orderOverrides,
  });
  return {
    phone: phone as unknown as PhoneNumberRow,
    order: order as unknown as TextEnablementOrderRow,
  };
}

/** Mocks for the S2b attach: document download-back + order file_upload. */
function attachTelnyx(telnyx: TelnyxMock) {
  telnyx.on(
    "GET",
    /^\/v2\/documents\/[^/]+\/download$/,
    () => new Response(new Uint8Array([1, 2, 3])),
  );
  telnyx.on(
    "POST",
    /^\/v2\/messaging_hosted_number_orders\/[^/]+\/actions\/file_upload$/,
    () => ({ data: { id: "ho-1", status: "pending" } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapHostedStatus", () => {
  it("maps the REAL Telnyx hosted-order vocabulary (spec-verified enum)", () => {
    expect(mapHostedStatus("successful", "pending")).toBe("completed");
    expect(mapHostedStatus("pending", "in-progress")).toBe("pending");
    expect(mapHostedStatus("provisioning", "pending")).toBe("in-progress");
    expect(mapHostedStatus("loa_file_successful", "pending")).toBe("in-progress");
    expect(mapHostedStatus("incomplete_documentation", "pending")).toBe(
      "action-required",
    );
    expect(mapHostedStatus("loa_file_invalid", "pending")).toBe("action-required");
    expect(mapHostedStatus("incorrect_billing_information", "pending")).toBe(
      "action-required",
    );
    expect(mapHostedStatus("carrier_rejected", "pending")).toBe("failed");
    expect(mapHostedStatus("ineligible_carrier", "pending")).toBe("failed");
    expect(mapHostedStatus("compliance_review_failed", "pending")).toBe("failed");
    expect(mapHostedStatus("failed", "pending")).toBe("failed");
    expect(mapHostedStatus("deleted", "pending")).toBe("cancelled");
  });

  it("keeps the row's CURRENT status for an unknown value (no 'pending' reset)", () => {
    expect(mapHostedStatus("brand_new_vendor_status", "in-progress")).toBe(
      "in-progress",
    );
    expect(mapHostedStatus(undefined, "action-required")).toBe("action-required");
  });
});

describe("resumeTextEnablement — attempt budget", () => {
  it("a successful poll returns the budget and clears the stale error", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      telnyx_hosted_number_id: "hn-1",
      attempts: 3,
      last_error: "Telnyx 503 on GET (transient)",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "provisioning" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("in-progress");
    expect(result.attempts).toBe(0);
    expect(result.last_error).toBeNull();
  });

  it("a transient failure consumes one attempt without flipping the status", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, { telnyx_hosted_order_id: "ho-1" });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () =>
      telnyxError(503, "service_unavailable"),
    );

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("pending"); // unchanged — budget remains
    expect(result.attempts).toBe(1);
    expect(result.last_error).toContain("Telnyx 503");
  });

  it("exhausting the budget lands status='failed' with last_error retained", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      attempts: MAX_ENABLEMENT_ATTEMPTS - 1,
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () =>
      telnyxError(500, "internal"),
    );

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("failed"); // visible to the owner, not silent
    expect(result.attempts).toBe(MAX_ENABLEMENT_ATTEMPTS);
    expect(result.last_error).toContain("Telnyx 500");
  });
});

describe("resumeTextEnablement — double-order fail-safes (§4.3)", () => {
  it("the loser of a concurrent resubmit/cron race creates NOTHING (lease held)", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => ({
      data: { id: "ho-x", status: "pending", phone_numbers: [{ id: "hn-x", phone_number: E164 }] },
    }));
    const { order } = seedHosted(rest, {
      // A live lease held by the concurrent winner (3 minutes out).
      provisioning_lease_until: new Date(Date.now() + 180_000).toISOString(),
    });

    const result = await resumeTextEnablement(env, order);

    expect(result.telnyx_hosted_order_id ?? null).toBeNull(); // untouched
    expect(
      telnyx.callsTo("POST", /messaging_hosted_number_orders$/),
    ).toHaveLength(0);
  });

  it("sends a deterministic Idempotency-Key on the hosted-order create, matching the persisted key", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => ({
      data: { id: "ho-k", status: "pending", phone_numbers: [{ id: "hn-k", phone_number: E164 }] },
    }));
    const { order } = seedHosted(rest);

    await resumeTextEnablement(env, order);

    const create = telnyx.callsTo("POST", /messaging_hosted_number_orders$/)[0];
    const sentKey = create.headers.get("Idempotency-Key");
    expect(sentKey).toBeTruthy();
    // The exact key the row claimed BEFORE the POST — a crash-retry replays it.
    expect(sentKey).toBe(
      rest.rows("text_enablement_orders")[0].telnyx_order_idempotency_key,
    );
  });

  it("releases the lease at end-of-pass so the next trigger can proceed", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => ({
      data: { id: "ho-r", status: "pending", phone_numbers: [{ id: "hn-r", phone_number: E164 }] },
    }));
    const { order } = seedHosted(rest);

    await resumeTextEnablement(env, order);
    expect(
      rest.rows("text_enablement_orders")[0].provisioning_lease_until,
    ).toBeNull();
  });
});

describe("resumeTextEnablement — S2b document attach", () => {
  it("attaches LOA+bill right after creating the hosted order when both are on the row", async () => {
    const { env, rest, telnyx } = setup();
    // Docs were uploaded while an earlier create kept failing (no order yet).
    const { order } = seedHosted(rest, {
      telnyx_loa_document_id: "doc-loa",
      telnyx_bill_document_id: "doc-bill",
    });
    telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => ({
      data: {
        id: "ho-9",
        status: "pending",
        phone_numbers: [{ id: "hn-9", phone_number: E164 }],
      },
    }));
    attachTelnyx(telnyx);

    const result = await resumeTextEnablement(env, order);
    expect(result.telnyx_hosted_order_id).toBe("ho-9");
    expect(telnyx.callsTo("GET", /\/download$/)).toHaveLength(2);
    expect(telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(1);
  });

  it("re-attaches when the carrier holds the order at action-required", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      telnyx_hosted_number_id: "hn-1",
      telnyx_loa_document_id: "doc-loa",
      telnyx_bill_document_id: "doc-bill",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "incomplete_documentation" },
    }));
    attachTelnyx(telnyx);

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("action-required");
    expect(telnyx.callsTo("POST", /\/actions\/file_upload$/)).toHaveLength(1);
  });

  it("a failed attach lands on the row for the reconcile cron", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      telnyx_loa_document_id: "doc-loa",
      telnyx_bill_document_id: "doc-bill",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "loa_file_invalid" },
    }));
    telnyx.on(
      "GET",
      /^\/v2\/documents\/[^/]+\/download$/,
      () => new Response(new Uint8Array([1])),
    );
    telnyx.on(
      "POST",
      /^\/v2\/messaging_hosted_number_orders\/[^/]+\/actions\/file_upload$/,
      () => telnyxError(500, "upload_failed"),
    );

    const result = await resumeTextEnablement(env, order);
    expect(result.attempts).toBe(1);
    expect(result.last_error).toContain("file_upload");
  });

  it("completes: activates the number and backfills the hosted-number id", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1", // hosted-number id missing → backfilled
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: {
        id: "ho-1",
        status: "successful",
        phone_numbers: [{ id: "hn-1", phone_number: E164 }],
      },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("completed");
    expect(result.completed_at).toBeTruthy();
    expect(result.telnyx_hosted_number_id).toBe("hn-1");
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("active");
  });
});

describe("resumeTextEnablement — terminal carrier statuses", () => {
  it("a carrier rejection lands 'failed' with the RAW Telnyx status in last_error", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      status: "in-progress",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "carrier_rejected" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("failed");
    expect(result.last_error).toContain("carrier_rejected");
    // A definitive carrier answer is not a transient failure — no budget spent.
    expect(result.attempts).toBe(0);
  });

  it("a Telnyx-side 'deleted' order converges to cancelled and frees the slot", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      status: "in-progress",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "deleted" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("cancelled");
    expect(result.cancelled_at).toBeTruthy();
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("released");
  });

  it("an unknown Telnyx status keeps the current status and clears nothing else", async () => {
    const { env, rest, telnyx } = setup();
    const { order } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      status: "in-progress",
    });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "some_future_status" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("in-progress");
    expect(result.attempts).toBe(0);
  });
});

describe("resumeTextEnablement — cancel-race + paid-first guards", () => {
  it("a cancel landing mid-create wins: the fresh Telnyx order is deleted, the cancelled row returned", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(rest);
    telnyx.on("POST", /^\/v2\/messaging_hosted_number_orders$/, () => {
      // Simulate cancelTextEnablement completing while the POST is in flight:
      // the row is cancelled + the slot released BEFORE the saga can persist
      // the new Telnyx order id.
      const row = rest
        .rows("text_enablement_orders")
        .find((o) => o.id === order.id) as Record<string, unknown>;
      row.status = "cancelled";
      row.cancelled_at = new Date().toISOString();
      const phoneRow = rest
        .rows("phone_numbers")
        .find((n) => n.id === phone.id) as Record<string, unknown>;
      phoneRow.status = "released";
      return {
        data: {
          id: "ho-9",
          status: "pending",
          phone_numbers: [{ id: "hn-9", phone_number: E164 }],
        },
      };
    });
    telnyx.on(
      "DELETE",
      /^\/v2\/messaging_hosted_number_orders\/ho-9$/,
      () => new Response(null, { status: 204 }),
    );

    const result = await resumeTextEnablement(env, order);
    // The cancel wins: the row keeps its cancelled state, never 'pending' again.
    expect(result.status).toBe("cancelled");
    expect(result.telnyx_hosted_order_id).toBeNull();
    // The orphaned fresh Telnyx order was deleted to converge.
    expect(
      telnyx.callsTo("DELETE", /^\/v2\/messaging_hosted_number_orders\/ho-9$/),
    ).toHaveLength(1);
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("released");
  });

  it("never re-activates a released number: completion is skipped for the cancel path", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(
      rest,
      {
        telnyx_hosted_order_id: "ho-1",
        telnyx_hosted_number_id: "hn-1",
        status: "in-progress",
      },
      { status: "released" },
    );
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "successful" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("in-progress"); // completion skipped
    expect(result.completed_at).toBeNull();
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("released"); // never flipped back to active
  });

  it("skips creating a NEW Telnyx order while the subscription is not active", async () => {
    const { env, rest, telnyx } = setup();
    rest.rows("companies")[0].subscription_status = "past_due";
    const { order } = seedHosted(rest);

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("pending");
    expect(result.attempts).toBe(0); // not a failure — no budget consumed
    expect(result.last_error).toContain("Subscription is not active");
    expect(telnyx.calls).toHaveLength(0);
  });

  it("still polls an EXISTING order while the subscription is not active", async () => {
    const { env, rest, telnyx } = setup();
    rest.rows("companies")[0].subscription_status = "past_due";
    const { order } = seedHosted(rest, { telnyx_hosted_order_id: "ho-1" });
    telnyx.on("GET", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () => ({
      data: { id: "ho-1", status: "provisioning" },
    }));

    const result = await resumeTextEnablement(env, order);
    expect(result.status).toBe("in-progress");
  });
});

describe("cancelTextEnablement", () => {
  it("DELETEs the hosted order (tolerating 404), releases the row, marks cancelled", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
    });
    // Already gone on the Telnyx side → converge, don't fail.
    telnyx.on("DELETE", /^\/v2\/messaging_hosted_number_orders\/ho-1$/, () =>
      telnyxError(404, "not_found"),
    );

    const result = await cancelTextEnablement(env, order);
    expect(result.status).toBe("cancelled");
    expect(result.cancelled_at).toBeTruthy();
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("released");
    expect(
      telnyx.callsTo("DELETE", /^\/v2\/messaging_hosted_number_orders\//),
    ).toHaveLength(1);
  });
});

describe("releaseNumberRow — hosted rows", () => {
  it("cancels a non-terminal enablement and releases the row (no phone_numbers DELETE)", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      status: "in-progress",
    });
    telnyx.on(
      "DELETE",
      /^\/v2\/messaging_hosted_number_orders\/ho-1$/,
      () => new Response(null, { status: 204 }),
    );

    const released = await releaseNumberRow(env, phone);
    expect(released.status).toBe("released");
    const orderRow = rest
      .rows("text_enablement_orders")
      .find((o) => o.id === order.id);
    expect(orderRow?.status).toBe("cancelled");
    expect(orderRow?.cancelled_at).toBeTruthy();
    // The hosted number was never Telnyx-owned inventory — no number DELETE.
    expect(telnyx.callsTo("DELETE", /^\/v2\/phone_numbers\//)).toHaveLength(0);
  });

  it("deletes the live hosted number when the enablement completed", async () => {
    const { env, rest, telnyx } = setup();
    const { order, phone } = seedHosted(
      rest,
      {
        telnyx_hosted_order_id: "ho-1",
        telnyx_hosted_number_id: "hn-1",
        status: "completed",
        completed_at: new Date().toISOString(),
      },
      { status: "active" },
    );
    telnyx.on(
      "DELETE",
      /^\/v2\/messaging_hosted_numbers\/hn-1$/,
      () => new Response(null, { status: 204 }),
    );

    const released = await releaseNumberRow(env, phone);
    expect(released.status).toBe("released");
    expect(
      telnyx.callsTo("DELETE", /^\/v2\/messaging_hosted_numbers\/hn-1$/),
    ).toHaveLength(1);
    const orderRow = rest
      .rows("text_enablement_orders")
      .find((o) => o.id === order.id);
    expect(orderRow?.status).toBe("cancelled");
  });

  it("tolerates a 404 on the hosted-number delete (already gone → converge)", async () => {
    const { env, rest, telnyx } = setup();
    const { phone } = seedHosted(
      rest,
      {
        telnyx_hosted_order_id: "ho-1",
        telnyx_hosted_number_id: "hn-1",
        status: "completed",
      },
      { status: "active" },
    );
    telnyx.on("DELETE", /^\/v2\/messaging_hosted_numbers\/hn-1$/, () =>
      telnyxError(404, "not_found"),
    );

    const released = await releaseNumberRow(env, phone);
    expect(released.status).toBe("released");
    expect(rest.rows("text_enablement_orders")[0].status).toBe("cancelled");
  });

  it("keeps the row un-released when Telnyx genuinely fails (retry discipline)", async () => {
    const { env, rest, telnyx } = setup();
    const { phone } = seedHosted(
      rest,
      {
        telnyx_hosted_order_id: "ho-1",
        telnyx_hosted_number_id: "hn-1",
        status: "completed",
      },
      { status: "active" },
    );
    telnyx.on("DELETE", /^\/v2\/messaging_hosted_numbers\/hn-1$/, () =>
      telnyxError(500, "internal"),
    );

    await expect(releaseNumberRow(env, phone)).rejects.toThrow(/Telnyx 500/);
    const phoneRow = rest.rows("phone_numbers").find((n) => n.id === phone.id);
    expect(phoneRow?.status).toBe("active"); // un-released → daily cron retries
    expect(rest.rows("text_enablement_orders")[0].status).toBe("completed");
  });

  it("skips Telnyx entirely for an already-cancelled enablement", async () => {
    const { env, rest, telnyx } = setup();
    const { phone } = seedHosted(rest, {
      telnyx_hosted_order_id: "ho-1",
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });

    const released = await releaseNumberRow(env, phone);
    expect(released.status).toBe("released");
    expect(telnyx.calls).toHaveLength(0);
  });
});
