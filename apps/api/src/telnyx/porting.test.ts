import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkPortability,
  handlePortingEvent,
  pollPortRequests,
  PortDocumentsMissingError,
  startPortSaga,
  submitPortRequest,
  type PortRequestRow,
} from "./porting";
import {
  FakeRest,
  resendRoute,
  TelnyxMock,
  type SentEmailCapture,
} from "./test-support";
import { dispatchTelnyxEvent } from "../messaging/dispatch";
import type { TelnyxEvent } from "../messaging/types";
import { completeEnv, stubFetch } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PHONE_ID = "33333333-3333-4333-8333-333333333333";
const PORT_ID = "44444444-4444-4444-8444-444444444444";
const PORT_E164 = "+13035550000";
const ORDER_ID = "po-order-1";

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
  source: "ported",
  porting_status: "draft",
  requested_area_code: null,
  number_e164: null,
  telnyx_phone_number_id: null,
  telnyx_order_id: null,
  provision_attempts: 0,
  last_provision_error: null,
  suspended_at: null,
  released_at: null,
};

function setup(portOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("phone_numbers", PHONE_DEFAULTS);
  rest.table("port_requests", PORT_DEFAULTS);
  rest.table("company_members");
  rest.table("messaging_registrations");
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    requested_area_code: "303",
    telnyx_messaging_profile_id: "profile-1",
    subscription_status: "active",
    us_texting_enabled: true,
  });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });
  rest.insert("phone_numbers", {
    id: PHONE_ID,
    company_id: COMPANY_ID,
    provisioning_key: "cs_port_1",
    country: "US",
  });
  rest.insert("port_requests", {
    id: PORT_ID,
    company_id: COMPANY_ID,
    phone_number_id: PHONE_ID,
    phone_e164: PORT_E164,
    country: "US",
    entity_name: "Acme Plumbing LLC",
    auth_person_name: "Pat Owner",
    account_number: "ACC-12345",
    service_street: "1 Main St",
    service_locality: "Denver",
    service_admin_area: "CO",
    service_postal_code: "80202",
    ...portOverrides,
  });

  const telnyx = new TelnyxMock();
  const emails: SentEmailCapture[] = [];
  stubFetch(rest.route(), telnyx.route(), resendRoute(emails));
  return { env, rest, telnyx, emails };
}

/** Wire up the P2→P5 happy-path Telnyx handlers (create, patch, confirm). */
function sagaTelnyx(telnyx: TelnyxMock, orderId = ORDER_ID) {
  telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
    data: { id: orderId, status: { value: "draft" } },
  }));
  telnyx.on("PATCH", new RegExp(`^/v2/porting_orders/${orderId}$`), () => ({
    data: { id: orderId, status: { value: "draft" } },
  }));
  telnyx.on(
    "POST",
    new RegExp(`^/v2/porting_orders/${orderId}/actions/confirm$`),
    () => ({ data: { id: orderId, status: { value: "in-process" } } }),
  );
}

function portRow(rest: FakeRest): PortRequestRow {
  return rest.rows("port_requests")[0] as unknown as PortRequestRow;
}
function phoneRow(rest: FakeRest): Record<string, unknown> {
  return rest.rows("phone_numbers")[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// §3.1 Portability check
// ---------------------------------------------------------------------------

describe("checkPortability — §3.1", () => {
  it("POSTs the top-level /v2/portability_checks with phone_numbers[]", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/portability_checks$/, () => ({
      data: [
        {
          phone_number: PORT_E164,
          portable: true,
          phone_number_type: "landline",
          messaging_capable: true,
          fast_portable: true,
          carrier_name: "Old Telco",
        },
      ],
    }));

    const result = await checkPortability(env, PORT_E164);
    expect(result.portable).toBe(true);
    expect(result.fastPortable).toBe(true);
    expect(result.carrierName).toBe("Old Telco");

    const call = telnyx.callsTo("POST", /portability_checks/)[0];
    expect(call.path).toBe("/v2/portability_checks");
    expect(call.body).toEqual({ phone_numbers: [PORT_E164] });
  });

  it("surfaces not_portable_reason for a non-portable number", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/portability_checks$/, () => ({
      data: [
        {
          phone_number: PORT_E164,
          portable: false,
          not_portable_reason: "Number is pending disconnect",
        },
      ],
    }));
    const result = await checkPortability(env, PORT_E164);
    expect(result.portable).toBe(false);
    expect(result.notPortableReason).toBe("Number is pending disconnect");
  });
});

// ---------------------------------------------------------------------------
// §4 saga P1–P5 (create order body shape + submit)
// ---------------------------------------------------------------------------

describe("startPortSaga — §4 P1–P4 (create draft, do NOT confirm)", () => {
  it("creates the order (phone_numbers[] only), PATCHes the verified body, and STOPS at draft — no confirm", async () => {
    const { env, rest, telnyx, emails } = setup();
    sagaTelnyx(telnyx);

    const row = await startPortSaga(env, {
      companyId: COMPANY_ID,
      portRequestId: PORT_ID,
    });

    // The saga creates the draft but does NOT confirm — the row stays `draft`
    // awaiting the customer's LOA + invoice upload + POST /:id/submit.
    expect(row?.status).toBe("draft");
    expect(row?.telnyx_porting_order_id).toBe(ORDER_ID);
    expect(row?.submitted_at).toBeFalsy();
    expect(row?.submission_count).toBe(0);
    expect(row?.messaging_port_status).toBe("not_applicable");

    // P2 create: phone_numbers[] is the ONLY field at create (§3.3).
    const create = telnyx.callsTo("POST", /^\/v2\/porting_orders$/)[0];
    expect(create.body).toEqual({ phone_numbers: [PORT_E164] });
    // Persisted immediately (crash-after-create protection).
    expect(portRow(rest).telnyx_porting_order_id).toBe(ORDER_ID);

    // P4 PATCH: the verified body shape (§3.4).
    const patch = telnyx.callsTo("PATCH", /porting_orders/)[0];
    expect(patch.body).toMatchObject({
      customer_reference: COMPANY_ID,
      end_user: {
        admin: {
          entity_name: "Acme Plumbing LLC",
          auth_person_name: "Pat Owner",
          account_number: "ACC-12345",
        },
        location: { administrative_area: "CO", country_code: "US" },
      },
      // The EXACT field name: messaging_profile_id, not message_profile_id.
      phone_number_configuration: { messaging_profile_id: "profile-1" },
      // Messaging must be explicit.
      messaging: { enable_messaging: true },
    });

    // NO confirm — the saga never confirms without documents (§6 gate).
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
    // No submitted email either (nothing was submitted).
    expect(emails).toHaveLength(0);
  });

  it("skips creating a second order when one is already persisted (idempotent)", async () => {
    const { env, telnyx } = setup({ telnyx_porting_order_id: ORDER_ID });
    sagaTelnyx(telnyx);
    await startPortSaga(env, { companyId: COMPANY_ID, portRequestId: PORT_ID });
    // P2 create is skipped; PATCH still runs; confirm does NOT.
    expect(telnyx.callsTo("POST", /^\/v2\/porting_orders$/)).toHaveLength(0);
    expect(telnyx.callsTo("PATCH", /porting_orders/)).toHaveLength(1);
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
  });

  it("records the failure on the row without throwing when a step fails", async () => {
    const { env, rest, telnyx } = setup();
    // Create succeeds (id persisted), PATCH fails.
    telnyx.on("POST", /^\/v2\/porting_orders$/, () => ({
      data: { id: ORDER_ID, status: { value: "draft" } },
    }));
    // No PATCH handler → TelnyxMock returns a 500.

    const row = await startPortSaga(env, {
      companyId: COMPANY_ID,
      portRequestId: PORT_ID,
    });
    // Does not throw; the id is persisted, the error is recorded, status stays
    // resumable (draft) for the cron.
    expect(row?.telnyx_porting_order_id).toBe(ORDER_ID);
    expect(portRow(rest).rejection_reason).toBeTruthy();
    expect(portRow(rest).status).toBe("draft");
  });
});

describe("submitPortRequest — §3.5/§6 documents-gated confirm", () => {
  it("REJECTS confirm when documents are missing (no Telnyx confirm call)", async () => {
    const { env, telnyx } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "draft",
      // No LOA / invoice on the row.
    });
    sagaTelnyx(telnyx);

    await expect(
      submitPortRequest(env, { companyId: COMPANY_ID, portRequestId: PORT_ID }),
    ).rejects.toBeInstanceOf(PortDocumentsMissingError);
    // Hard gate ran BEFORE any Telnyx confirm.
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
    expect(telnyx.callsTo("PATCH", /porting_orders/)).toHaveLength(0);
  });

  it("REJECTS confirm when only the LOA is present (invoice missing)", async () => {
    const { env, telnyx } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "draft",
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: null,
    });
    sagaTelnyx(telnyx);
    await expect(
      submitPortRequest(env, { companyId: COMPANY_ID, portRequestId: PORT_ID }),
    ).rejects.toBeInstanceOf(PortDocumentsMissingError);
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
  });

  it("CONFIRMS and submits when BOTH documents are present", async () => {
    const { env, telnyx, emails } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "draft",
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
    });
    sagaTelnyx(telnyx);

    const row = await submitPortRequest(env, {
      companyId: COMPANY_ID,
      portRequestId: PORT_ID,
    });

    expect(row?.status).toBe("in-process");
    expect(row?.submitted_at).toBeTruthy();
    expect(row?.submission_count).toBe(1);
    // Messaging track moves not_applicable → pending at submit.
    expect(row?.messaging_port_status).toBe("pending");

    // The confirm-time PATCH re-attaches both documents (§3.4).
    const patch = telnyx.callsTo("PATCH", /porting_orders/)[0];
    expect((patch.body as { documents: unknown }).documents).toEqual({
      loa: "doc-loa",
      invoice: "doc-invoice",
    });
    // P5 confirm ran exactly once.
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(1);
    // §9 submitted email.
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("transfer is underway");
  });
});

// ---------------------------------------------------------------------------
// The readiness gate: number stays provisioning until messaging ported
// ---------------------------------------------------------------------------

describe("readiness gate — number stays provisioning until messaging ported", () => {
  it("keeps phone_numbers status=provisioning through submit and voice-ported", async () => {
    // Documents present → submit confirms it to in-process (the create-draft-
    // then-confirm flow); the number stays provisioning throughout.
    const { env, rest, telnyx } = setup({
      telnyx_porting_order_id: ORDER_ID,
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
    });
    sagaTelnyx(telnyx);
    await submitPortRequest(env, { companyId: COMPANY_ID, portRequestId: PORT_ID });
    expect(portRow(rest).status).toBe("in-process");
    expect(phoneRow(rest).status).toBe("provisioning");

    // Voice ports (status_changed → ported) but messaging is still pending:
    // the number MUST NOT go active yet.
    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.status_changed",
        payload: { id: ORDER_ID, status: { value: "ported" } },
      },
    });
    expect(portRow(rest).status).toBe("ported");
    expect(phoneRow(rest).status).toBe("provisioning"); // still not sendable
    expect(portRow(rest).ported_at).toBeFalsy();
  });

  it("flips the number to active only when messaging_changed → ported (P6)", async () => {
    const { env, rest, telnyx, emails } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "ported",
      messaging_port_status: "activating",
    });
    // P6a resolves the now-owned number; R3 assigns it.
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [{ id: "pn-ported", phone_number: PORT_E164 }],
    }));
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({ data: {} }));
    rest.insert("messaging_registrations", {
      company_id: COMPANY_ID,
      kind: "campaign",
      status: "approved",
      telnyx_id: "camp-1",
      data: { numberAssignments: {} },
      deactivated_at: null,
    });

    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.messaging_changed",
        payload: { id: ORDER_ID, messaging_port_status: "ported" },
      },
    });

    // P6a: number is now active with its resolved Telnyx id + e164.
    expect(phoneRow(rest).status).toBe("active");
    expect(phoneRow(rest).number_e164).toBe(PORT_E164);
    expect(phoneRow(rest).telnyx_phone_number_id).toBe("pn-ported");
    // P6b: assigned to the approved campaign (R3).
    expect(
      telnyx.callsTo("POST", /phoneNumberCampaign/),
    ).toHaveLength(1);
    // P6c: ported_at stamped; §9 "live" email.
    expect(portRow(rest).ported_at).toBeTruthy();
    expect(emails.some((e) => e.subject.includes("live on Loonext"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Webhook transitions
// ---------------------------------------------------------------------------

describe("handlePortingEvent — §5.1 transitions", () => {
  it("reads the confirmed FOC via GET on foc-date-confirmed (webhook carries no date)", async () => {
    const { env, rest, telnyx, emails } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "in-process",
      messaging_port_status: "pending",
    });
    telnyx.on("GET", new RegExp(`^/v2/porting_orders/${ORDER_ID}$`), () => ({
      data: {
        id: ORDER_ID,
        status: { value: "foc-date-confirmed" },
        activation_settings: {
          foc_datetime_actual: "2026-07-20T17:00:00Z",
        },
      },
    }));

    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.status_changed",
        payload: { id: ORDER_ID, status: { value: "foc-date-confirmed" } },
      },
    });

    expect(portRow(rest).status).toBe("foc-date-confirmed");
    // FOC date came from the GET, not the (dateless) webhook body.
    expect(portRow(rest).foc_date).toBe("2026-07-20T17:00:00Z");
    expect(telnyx.callsTo("GET", /porting_orders/)).toHaveLength(1);
    expect(emails.some((e) => e.subject.includes("date is locked in"))).toBe(true);
  });

  it("stores the flattened rejection reason + emails on exception", async () => {
    const { env, rest, emails } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "submitted",
      messaging_port_status: "pending",
    });

    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.status_changed",
        payload: {
          id: ORDER_ID,
          status: {
            value: "exception",
            details: [{ code: "ACCOUNT_NUMBER_MISMATCH" }],
          },
        },
      },
    });

    expect(portRow(rest).status).toBe("exception");
    expect(portRow(rest).rejection_reason).toContain("ACCOUNT_NUMBER_MISMATCH");
    expect(emails.some((e) => e.subject.includes("needs a quick fix"))).toBe(true);
  });

  it("is a guarded no-op for an unknown order id (out-of-order / foreign)", async () => {
    const { env, rest } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "submitted",
    });
    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.status_changed",
        payload: { id: "po-unknown", status: { value: "exception" } },
      },
    });
    // Our row is untouched.
    expect(portRow(rest).status).toBe("submitted");
  });

  it("does not re-fire the completion email on a duplicate messaging_changed → ported", async () => {
    const { env, rest, telnyx, emails } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "ported",
      messaging_port_status: "ported",
      ported_at: new Date().toISOString(),
    });
    // The number is already active (P6 ran once).
    rest.rows("phone_numbers")[0].status = "active";
    rest.rows("phone_numbers")[0].number_e164 = PORT_E164;
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [{ id: "pn-ported", phone_number: PORT_E164 }],
    }));

    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.messaging_changed",
        payload: { id: ORDER_ID, messaging_port_status: "ported" },
      },
    });
    // Idempotent P6: no second "live" email.
    expect(emails.filter((e) => e.subject.includes("live on Loonext"))).toHaveLength(0);
  });

  // #50: the messaging track's guarded transition table — Telnyx retries
  // failed deliveries for hours, so stale messaging_changed values can land
  // after messaging already ported. None of them may regress the terminal
  // state, overwrite rejection_reason, or fire a spurious "delayed" email.
  describe("#50 messaging_port_status transition guard", () => {
    function messagingEvent(value: string) {
      return {
        data: {
          event_type: "porting_order.messaging_changed",
          payload: { id: ORDER_ID, messaging_port_status: value },
        },
      };
    }

    function setupPorted() {
      const world = setup({
        telnyx_porting_order_id: ORDER_ID,
        status: "ported",
        messaging_port_status: "ported",
        ported_at: new Date().toISOString(),
      });
      // P6 already completed: the number is live.
      world.rest.rows("phone_numbers")[0].status = "active";
      world.rest.rows("phone_numbers")[0].number_e164 = PORT_E164;
      return world;
    }

    it("a late/replayed 'exception' can never un-port messaging", async () => {
      const { env, rest, emails } = setupPorted();

      await handlePortingEvent(env, messagingEvent("exception"));

      expect(portRow(rest).messaging_port_status).toBe("ported");
      expect(portRow(rest).rejection_reason).toBeNull();
      // No spurious "texting is taking longer" email for a live number.
      expect(emails).toHaveLength(0);
    });

    it("late 'pending' / 'activating' replays after ported are no-ops", async () => {
      const { env, rest, emails } = setupPorted();

      await handlePortingEvent(env, messagingEvent("pending"));
      expect(portRow(rest).messaging_port_status).toBe("ported");

      await handlePortingEvent(env, messagingEvent("activating"));
      expect(portRow(rest).messaging_port_status).toBe("ported");
      expect(emails).toHaveLength(0);
    });

    it("exception → activating (real progress) is still allowed", async () => {
      const { env, rest } = setup({
        telnyx_porting_order_id: ORDER_ID,
        status: "ported",
        messaging_port_status: "exception",
      });

      await handlePortingEvent(env, messagingEvent("activating"));
      expect(portRow(rest).messaging_port_status).toBe("activating");
    });

    it("a stale 'pending' cannot hide a customer-visible exception", async () => {
      const { env, rest } = setup({
        telnyx_porting_order_id: ORDER_ID,
        status: "ported",
        messaging_port_status: "exception",
        rejection_reason: "Texting routing not yet released by the losing carrier; Telnyx is escalating.",
      });

      await handlePortingEvent(env, messagingEvent("pending"));
      expect(portRow(rest).messaging_port_status).toBe("exception");
      expect(portRow(rest).rejection_reason).toContain("not yet released");
    });

    it("'activating' cannot regress to 'pending'", async () => {
      const { env, rest } = setup({
        telnyx_porting_order_id: ORDER_ID,
        status: "activation-in-progress",
        messaging_port_status: "activating",
      });

      await handlePortingEvent(env, messagingEvent("pending"));
      expect(portRow(rest).messaging_port_status).toBe("activating");
    });

    it("the reconcile cron rides the same guard (stale remote exception after ported)", async () => {
      // A voice-ported row whose messaging is 'exception' stays in the §5.2
      // work-set; a remote read still reporting a STALE regression value for
      // an already-ported messaging track must not regress it. Here: local
      // 'exception', remote 'pending' → guarded no-op.
      const { env, rest, telnyx } = setup({
        telnyx_porting_order_id: ORDER_ID,
        status: "ported",
        messaging_port_status: "exception",
        updated_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      telnyx.on("GET", new RegExp(`^/v2/porting_orders/${ORDER_ID}$`), () => ({
        data: {
          id: ORDER_ID,
          status: { value: "ported" },
          messaging: { messaging_port_status: "pending" },
        },
      }));

      const summary = await pollPortRequests(env);
      expect(summary.messagingTransitioned).toBe(0);
      expect(portRow(rest).messaging_port_status).toBe("exception");
    });
  });

  it("acks sharing_token_expired as a no-op (never fires for our ports)", async () => {
    const { env, rest } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "submitted",
    });
    await handlePortingEvent(env, {
      data: {
        event_type: "porting_order.sharing_token_expired",
        payload: { id: ORDER_ID },
      },
    });
    expect(portRow(rest).status).toBe("submitted");
  });
});

// ---------------------------------------------------------------------------
// §5.2 reconcile cron
// ---------------------------------------------------------------------------

describe("pollPortRequests — §5.2 reconcile", () => {
  it("applies a missed status transition from the authoritative GET", async () => {
    const { env, rest, telnyx } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "in-process",
      messaging_port_status: "pending",
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    telnyx.on("GET", new RegExp(`^/v2/porting_orders/${ORDER_ID}$`), () => ({
      data: {
        id: ORDER_ID,
        status: { value: "submitted" },
        activation_settings: {},
        messaging: { messaging_port_status: "pending" },
      },
    }));

    const summary = await pollPortRequests(env);
    expect(summary.statusTransitioned).toBe(1);
    expect(portRow(rest).status).toBe("submitted");
  });

  it("recovers a messaging exception → ported via the GET and runs P6", async () => {
    const { env, rest, telnyx } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "ported",
      messaging_port_status: "exception",
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    telnyx.on("GET", new RegExp(`^/v2/porting_orders/${ORDER_ID}$`), () => ({
      data: {
        id: ORDER_ID,
        status: { value: "ported" },
        messaging: { messaging_port_status: "ported" },
      },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [{ id: "pn-ported", phone_number: PORT_E164 }],
    }));

    const summary = await pollPortRequests(env);
    expect(summary.messagingTransitioned).toBe(1);
    // The webhook-missed path drove P6: number is active now.
    expect(phoneRow(rest).status).toBe("active");
    expect(portRow(rest).ported_at).toBeTruthy();
  });

  it("resumes a stalled pre-create saga (no order id) — creates the draft, does NOT confirm", async () => {
    const { env, rest, telnyx } = setup({
      status: "draft",
      telnyx_porting_order_id: null,
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    sagaTelnyx(telnyx);

    const summary = await pollPortRequests(env);
    expect(summary.resumed).toBe(1);
    // The resume created the draft order; it stays `draft` (no documents yet).
    expect(portRow(rest).status).toBe("draft");
    expect(portRow(rest).telnyx_porting_order_id).toBe(ORDER_ID);
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
  });

  it("leaves a draft-without-documents at rest (valid resting state — no confirm)", async () => {
    const { env, rest, telnyx } = setup({
      status: "draft",
      telnyx_porting_order_id: ORDER_ID,
      // No documents attached yet — awaiting the customer.
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    sagaTelnyx(telnyx);
    telnyx.on("GET", new RegExp(`^/v2/porting_orders/${ORDER_ID}$`), () => ({
      data: { id: ORDER_ID, status: { value: "draft" } },
    }));

    await pollPortRequests(env);
    // Still a draft; never confirmed without documents.
    expect(portRow(rest).status).toBe("draft");
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(0);
  });

  it("confirms a draft that HAS both documents but was never submitted (missed confirm)", async () => {
    const { env, rest, telnyx } = setup({
      status: "draft",
      telnyx_porting_order_id: ORDER_ID,
      telnyx_loa_document_id: "doc-loa",
      telnyx_invoice_document_id: "doc-invoice",
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    sagaTelnyx(telnyx);

    const summary = await pollPortRequests(env);
    expect(summary.resumed).toBe(1);
    // The documents-gated confirm drove it to in-process.
    expect(portRow(rest).status).toBe("in-process");
    expect(telnyx.callsTo("POST", /actions\/confirm/)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §11 step 4: the shared dispatcher routes porting_order.* to handlePortingEvent
// (so both the live waitUntil path AND the webhook sweeper replay reach it).
// ---------------------------------------------------------------------------

describe("dispatchTelnyxEvent routes porting_order.* (sweeper-replay path)", () => {
  it("drives a porting_order.status_changed row through the real dispatcher", async () => {
    const { env, rest } = setup({
      telnyx_porting_order_id: ORDER_ID,
      status: "submitted",
      messaging_port_status: "pending",
    });

    await dispatchTelnyxEvent(env, {
      data: {
        id: "evt-port-1",
        event_type: "porting_order.status_changed",
        payload: {
          id: ORDER_ID,
          status: {
            value: "exception",
            details: [{ code: "LOCATION_MISMATCH" }],
          },
        },
      },
    } as unknown as TelnyxEvent);

    expect(portRow(rest).status).toBe("exception");
    expect(portRow(rest).rejection_reason).toContain("LOCATION_MISMATCH");
  });
});
