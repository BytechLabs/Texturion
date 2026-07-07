import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest, telnyxUpload, TelnyxApiError } from "./client";
import {
  portBridgeReleaseNudgeCopy,
  portCompletedCopy,
  portExceptionCopy,
  portFocConfirmedCopy,
  portMessagingExceptionCopy,
  portSubmittedCopy,
} from "./emails";
import {
  ensureMessagingProfile,
  fetchProvisioningCompany,
  lookupOwnedNumber,
  releaseNumberRow,
  type PhoneNumberRow,
} from "./provisioning";
import { assignNumbersToCampaign, fetchRegistrationRows } from "./registration";
import { billingRecipients } from "../billing/recipients";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * The PORTING.md §3–§6 port-in feature: the Telnyx Porting API v2 calls, the
 * port saga (parallel to the §4.3 provisioning saga), the `porting_order.*`
 * webhook handler, and the daily reconcile helper.
 *
 * Reuse (do NOT duplicate — PORTING.md §4 reuse map + Verification correction
 * 1): the per-company messaging profile via `ensureMessagingProfile`, the
 * post-cutover Telnyx-number resolution via `lookupOwnedNumber`, and the R3
 * campaign assignment via `assignNumbersToCampaign` — all from the existing
 * telnyx track. A ported number rides the exact same `phone_numbers.status`
 * semantics the send/threading paths already respect: it stays `provisioning`
 * (invisible to the composer) until messaging finishes porting, then P6 flips
 * it to `active` — so no send-path code learns about porting.
 *
 * Verified Telnyx endpoints (PORTING.md §3, §12):
 *   POST   /v2/portability_checks                         (§3.1, pre-pay OK)
 *   POST   /v2/documents                    (multipart)    (§3.2, LOA + invoice)
 *   POST   /v2/porting_orders                              (§3.3, create)
 *   PATCH  /v2/porting_orders/{id}                         (§3.4, fill/resubmit)
 *   POST   /v2/porting_orders/{id}/actions/confirm         (§3.5, submit)
 *   GET    /v2/porting_orders/{id}                         (§3.6, reconcile)
 *   POST   /v2/10dlc/phoneNumberCampaign     (via R3)      (§3.7, on completion)
 *   POST   /v2/porting_orders/{id}/actions/cancel          (§3.8, abandon)
 */

// ---------------------------------------------------------------------------
// Status enums (mirror the schema track's port_status / port_messaging_status)
// ---------------------------------------------------------------------------

export type PortStatus =
  | "draft"
  | "in-process"
  | "submitted"
  | "exception"
  | "foc-date-confirmed"
  | "activation-in-progress"
  | "ported"
  | "cancel-pending"
  | "cancelled";

export type PortMessagingStatus =
  | "not_applicable"
  | "pending"
  | "activating"
  | "ported"
  | "exception";

/** Telnyx porting_order.status.value → local port_status (identity map, §1). */
const PORT_STATUS_VALUES: readonly PortStatus[] = [
  "draft",
  "in-process",
  "submitted",
  "exception",
  "foc-date-confirmed",
  "activation-in-progress",
  "ported",
  "cancel-pending",
  "cancelled",
];

const MESSAGING_STATUS_VALUES: readonly PortMessagingStatus[] = [
  "not_applicable",
  "pending",
  "activating",
  "ported",
  "exception",
];

/**
 * Guarded transition table (PORTING.md §5.1, mirroring registration.ts's
 * ALLOWED_TRANSITIONS): duplicate/out-of-order webhook deliveries and the
 * webhook/cron overlap are harmless no-ops, and each email fires exactly once.
 * Terminal states (`ported`, `cancelled`) accept nothing further on the voice
 * track.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<PortStatus, PortStatus[]> = {
  draft: ["in-process", "submitted", "exception", "cancel-pending", "cancelled"],
  "in-process": [
    "submitted",
    "exception",
    "foc-date-confirmed",
    "activation-in-progress",
    "ported",
    "cancel-pending",
    "cancelled",
  ],
  submitted: [
    "exception",
    "foc-date-confirmed",
    "activation-in-progress",
    "ported",
    "cancel-pending",
    "cancelled",
  ],
  exception: [
    "submitted",
    "in-process",
    "foc-date-confirmed",
    "activation-in-progress",
    "ported",
    "cancel-pending",
    "cancelled",
  ],
  "foc-date-confirmed": [
    "activation-in-progress",
    "ported",
    "exception",
    "cancel-pending",
    "cancelled",
  ],
  "activation-in-progress": ["ported", "exception", "cancel-pending", "cancelled"],
  ported: [],
  "cancel-pending": ["cancelled"],
  cancelled: [],
};

/**
 * #50 — the messaging track's guarded transition table, mirroring
 * {@link ALLOWED_STATUS_TRANSITIONS}: Telnyx retries failed webhook
 * deliveries for hours, so a stale `messaging_changed('exception')` (or
 * 'pending'/'activating') can land AFTER messaging already ported. Without a
 * guard that regressed `messaging_port_status` from the terminal 'ported',
 * overwrote `rejection_reason`, and sent a spurious "texting is delayed"
 * email for a live number. `ported` is terminal; forward skips are allowed
 * (webhooks can coalesce states) but `exception` is customer-visible and only
 * leaves on real progress (activating/ported), never back to pending.
 */
const ALLOWED_MESSAGING_TRANSITIONS: Record<
  PortMessagingStatus,
  PortMessagingStatus[]
> = {
  not_applicable: ["pending", "activating", "ported", "exception"],
  pending: ["activating", "ported", "exception"],
  activating: ["ported", "exception"],
  ported: [],
  exception: ["activating", "ported"],
};

// ---------------------------------------------------------------------------
// Row shape (columns the saga/webhook read — mirrors the schema track's table)
// ---------------------------------------------------------------------------

export interface PortRequestRow {
  id: string;
  company_id: string;
  phone_number_id: string;
  phone_e164: string;
  country: "US" | "CA";
  telnyx_porting_order_id: string | null;
  telnyx_loa_document_id: string | null;
  telnyx_invoice_document_id: string | null;
  entity_name: string;
  auth_person_name: string;
  billing_phone_number: string | null;
  account_number: string;
  pin_passcode: string | null;
  is_wireless: boolean;
  ssn_sin_last4: string | null;
  service_street: string;
  service_extended: string | null;
  service_locality: string;
  service_admin_area: string;
  service_postal_code: string;
  foc_datetime_requested: string | null;
  foc_date: string | null;
  status: PortStatus;
  messaging_port_status: PortMessagingStatus;
  rejection_reason: string | null;
  submission_count: number;
  wants_bridge_number: boolean;
  bridge_number_id: string | null;
  submitted_at: string | null;
  ported_at: string | null;
  cancelled_at: string | null;
  updated_at?: string;
}

const PORT_COLUMNS =
  "id,company_id,phone_number_id,phone_e164,country,telnyx_porting_order_id," +
  "telnyx_loa_document_id,telnyx_invoice_document_id,entity_name," +
  "auth_person_name,billing_phone_number,account_number,pin_passcode," +
  "is_wireless,ssn_sin_last4,service_street,service_extended,service_locality," +
  "service_admin_area,service_postal_code,foc_datetime_requested,foc_date," +
  "status,messaging_port_status,rejection_reason,submission_count," +
  "wants_bridge_number,bridge_number_id,submitted_at,ported_at,cancelled_at," +
  "updated_at";

const PHONE_COLUMNS =
  "id,company_id,status,provisioning_key,requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,updated_at";

/** PORTING.md §4 failure handling: bounded resume attempts, like provisioning. */
export const MAX_PORT_ATTEMPTS = 5;

async function updatePortRow(
  db: SupabaseClient,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<PortRequestRow> {
  const { data, error } = await db
    .from("port_requests")
    .update(patch)
    .eq("id", rowId)
    .select(PORT_COLUMNS);
  if (error) throw new Error(`port_requests update failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as PortRequestRow | null;
  if (!row) throw new Error(`port_requests row ${rowId} vanished mid-update`);
  return row;
}

async function fetchPortRow(
  db: SupabaseClient,
  rowId: string,
): Promise<PortRequestRow | null> {
  const { data, error } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .eq("id", rowId)
    .limit(1);
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  return (data?.[0] ?? null) as unknown as PortRequestRow | null;
}

async function fetchPortRowByOrderId(
  db: SupabaseClient,
  orderId: string,
): Promise<PortRequestRow | null> {
  const { data, error } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .eq("telnyx_porting_order_id", orderId)
    .limit(1);
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  return (data?.[0] ?? null) as unknown as PortRequestRow | null;
}

async function fetchPhoneRow(
  db: SupabaseClient,
  rowId: string,
): Promise<PhoneNumberRow | null> {
  const { data, error } = await db
    .from("phone_numbers")
    .select(PHONE_COLUMNS)
    .eq("id", rowId)
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  return (data?.[0] ?? null) as unknown as PhoneNumberRow | null;
}

// ---------------------------------------------------------------------------
// Telnyx Porting API response shapes (only the fields this module reads)
// ---------------------------------------------------------------------------

interface PortabilityCheckResponse {
  data?: {
    phone_number?: string;
    portable?: boolean;
    not_portable_reason?: string | null;
    phone_number_type?: string | null;
    messaging_capable?: boolean;
    fast_portable?: boolean;
    carrier_name?: string | null;
    record_type?: string | null;
  }[];
}

interface DocumentResponse {
  data?: { id?: string };
}

interface PortingOrderResponse {
  data?: {
    id?: string;
    status?: { value?: string; details?: unknown };
    activation_settings?: {
      foc_datetime_requested?: string | null;
      foc_datetime_actual?: string | null;
    };
    messaging?: { messaging_port_status?: string | null };
  };
}

// ---------------------------------------------------------------------------
// §3.1 Portability check (the only pre-payment Telnyx porting call)
// ---------------------------------------------------------------------------

export interface PortabilityResult {
  phoneNumber: string;
  portable: boolean;
  notPortableReason: string | null;
  phoneNumberType: string | null;
  messagingCapable: boolean;
  fastPortable: boolean;
  carrierName: string | null;
}

/**
 * §3.1 — `POST /v2/portability_checks { phone_numbers:[e164] }` (top-level,
 * verified; NOT nested under /v2/porting). Read-only, free, no commitment.
 */
export async function checkPortability(
  env: Env,
  e164: string,
): Promise<PortabilityResult> {
  const response = await telnyxRequest<PortabilityCheckResponse>(env, {
    method: "POST",
    path: "/v2/portability_checks",
    body: { phone_numbers: [e164] },
  });
  const entry =
    response.data?.find((item) => item.phone_number === e164) ??
    response.data?.[0];
  return {
    phoneNumber: entry?.phone_number ?? e164,
    portable: entry?.portable === true,
    notPortableReason: entry?.not_portable_reason ?? null,
    phoneNumberType: entry?.phone_number_type ?? null,
    messagingCapable: entry?.messaging_capable !== false,
    fastPortable: entry?.fast_portable === true,
    carrierName: entry?.carrier_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// §3.2 Upload documents (multipart)
// ---------------------------------------------------------------------------

export interface DocumentUpload {
  file: ArrayBuffer | Uint8Array | Blob;
  filename: string;
  contentType: string;
}

/** §3.2 — `POST /v2/documents` multipart; returns the stored-document UUID. */
export async function uploadPortDocument(
  env: Env,
  document: DocumentUpload,
  documentType: "loa" | "invoice",
): Promise<string> {
  const response = await telnyxUpload<DocumentResponse>(env, {
    path: "/v2/documents",
    file: document.file,
    filename: document.filename,
    contentType: document.contentType,
    fields: { document_type: documentType },
  });
  const id = response.data?.id;
  if (!id) throw new Error(`Telnyx document upload (${documentType}) returned no id`);
  return id;
}

// ---------------------------------------------------------------------------
// §3.3 / §3.4 / §3.5 order create + fill (PATCH) + confirm
// ---------------------------------------------------------------------------

/** §3.3 — `POST /v2/porting_orders { phone_numbers:[e164] }` (create; id only). */
async function createPortingOrder(env: Env, e164: string): Promise<string> {
  const response = await telnyxRequest<PortingOrderResponse>(env, {
    method: "POST",
    path: "/v2/porting_orders",
    body: { phone_numbers: [e164] },
  });
  const id = response.data?.id;
  if (!id) throw new Error("Telnyx porting order create returned no id");
  return id;
}

/**
 * §3.4 — the single declarative PATCH that fills end_user.admin/location,
 * activation_settings.foc_datetime_requested, phone_number_configuration.
 * messaging_profile_id, messaging.enable_messaging=true, and documents.loa/
 * invoice. Idempotent; the fix-and-resubmit path re-issues this same PATCH and
 * MUST re-send messaging.enable_messaging=true + messaging_profile_id every
 * time (a rejection can drop the messaging sub-order; `exception` is in-window).
 */
async function patchPortingOrder(
  env: Env,
  row: PortRequestRow,
  messagingProfileId: string,
): Promise<void> {
  if (!row.telnyx_porting_order_id) {
    throw new Error("cannot PATCH porting order: no telnyx_porting_order_id");
  }
  const admin: Record<string, unknown> = {
    entity_name: row.entity_name,
    auth_person_name: row.auth_person_name,
    billing_phone_number: row.billing_phone_number ?? row.phone_e164,
    account_number: row.account_number,
  };
  if (row.pin_passcode) admin.pin_passcode = row.pin_passcode;

  const documents: Record<string, string> = {};
  if (row.telnyx_loa_document_id) documents.loa = row.telnyx_loa_document_id;
  if (row.telnyx_invoice_document_id) {
    documents.invoice = row.telnyx_invoice_document_id;
  }

  const body: Record<string, unknown> = {
    customer_reference: row.company_id,
    end_user: {
      admin,
      location: {
        street_address: row.service_street,
        extended_address: row.service_extended ?? undefined,
        locality: row.service_locality,
        administrative_area: row.service_admin_area,
        postal_code: row.service_postal_code,
        country_code: row.country,
      },
    },
    phone_number_configuration: {
      // The EXACT field name (§3.4) — messaging_profile_id, not message_profile_id.
      messaging_profile_id: messagingProfileId,
      tags: ["loonext", `company:${row.company_id}`],
    },
    // SMS is a SEPARATE sub-order; must be explicit and re-sent every submit.
    messaging: { enable_messaging: true },
  };
  if (row.foc_datetime_requested) {
    body.activation_settings = {
      foc_datetime_requested: row.foc_datetime_requested,
    };
  }
  if (Object.keys(documents).length > 0) body.documents = documents;

  await telnyxRequest(env, {
    method: "PATCH",
    path: `/v2/porting_orders/${row.telnyx_porting_order_id}`,
    body,
  });
}

/** §3.5 — `POST /v2/porting_orders/{id}/actions/confirm` (draft → in-process). */
async function confirmPortingOrder(env: Env, orderId: string): Promise<void> {
  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/porting_orders/${orderId}/actions/confirm`,
  });
}

/** §3.6 — authoritative order read for the reconcile cron + detail refresh. */
export async function getPortingOrder(
  env: Env,
  orderId: string,
): Promise<{
  status: PortStatus | null;
  focDatetimeActual: string | null;
  messagingPortStatus: PortMessagingStatus | null;
  statusDetails: unknown;
}> {
  const response = await telnyxRequest<PortingOrderResponse>(env, {
    method: "GET",
    path: `/v2/porting_orders/${orderId}`,
  });
  const rawStatus = response.data?.status?.value;
  const status =
    typeof rawStatus === "string" &&
    (PORT_STATUS_VALUES as readonly string[]).includes(rawStatus)
      ? (rawStatus as PortStatus)
      : null;
  const rawMessaging = response.data?.messaging?.messaging_port_status;
  const messagingPortStatus =
    typeof rawMessaging === "string" &&
    (MESSAGING_STATUS_VALUES as readonly string[]).includes(rawMessaging)
      ? (rawMessaging as PortMessagingStatus)
      : null;
  return {
    status,
    focDatetimeActual:
      response.data?.activation_settings?.foc_datetime_actual ?? null,
    messagingPortStatus,
    statusDetails: response.data?.status?.details ?? null,
  };
}

/** §3.8 — `POST /v2/porting_orders/{id}/actions/cancel`. */
export async function cancelPortingOrder(
  env: Env,
  orderId: string,
): Promise<void> {
  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/porting_orders/${orderId}/actions/cancel`,
  });
}

// ---------------------------------------------------------------------------
// Emails + reason flattening
// ---------------------------------------------------------------------------

/**
 * Exported for the paid-checkout tail (webhooks/stripe.ts), which sends the
 * "upload your documents" nudge the moment a port-carrying signup pays.
 */
export async function sendPortEmail(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  copy: { subject: string; text: string; html: string },
): Promise<void> {
  try {
    const to = await billingRecipients(env, companyId, db);
    if (to.length > 0) await sendEmail(env, { to, ...copy });
  } catch (cause) {
    // Best-effort side effect of an already-applied transition (like
    // registration.ts) — a Resend outage must not wedge the state machine.
    Sentry.captureException(cause);
  }
}

/**
 * Flatten Telnyx porting status `details` (codes like ACCOUNT_NUMBER_MISMATCH,
 * AUTH_PERSON_MISMATCH, ENTITY_NAME_MISMATCH, LOCATION_MISMATCH,
 * PASSCODE_PIN_INVALID, FOC_REJECTED) into a human-readable reason — same
 * shape-tolerance as registration.ts's formatReasons.
 */
function flattenDetails(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item !== null && typeof item === "object") {
          const obj = item as { description?: unknown; code?: unknown };
          if (typeof obj.description === "string") return obj.description;
          if (typeof obj.code === "string") return obj.code;
          return JSON.stringify(item);
        }
        return String(item);
      })
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("; ").slice(0, 2000) : null;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value).slice(0, 2000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The port saga (PORTING.md §4, P1–P5). Steps are independently retryable and
// keyed to the port_requests row; failures land on the row for the daily cron.
// ---------------------------------------------------------------------------

export interface StartPortSagaInput {
  companyId: string;
  portRequestId: string;
}

/**
 * §4 entry point — called from the paid `checkout.session.completed` handler
 * (parallel to `provisionCompanyNumber`) and from `POST /v1/port-requests`
 * (post-signup path). Structurally identical to the provisioning saga: it does
 * NOT throw for step failures (those land on `port_requests` as
 * `rejection_reason` for the cron); only infrastructure failures propagate so
 * the webhook ledger retries. Every step is idempotent on persisted ids.
 *
 * **Create-draft-then-complete (D16 / §3.5 / §6, honest paid-first):** the saga
 * runs P1–P4 (ensure profile, create the Telnyx porting order, PATCH it) and
 * STOPS at a Telnyx `draft` — it does NOT auto-confirm. Confirmation is a
 * distinct post-payment step ({@link submitPortRequest}) that is HARD-GATED on
 * BOTH the LOA and invoice documents being attached to the row. The customer
 * (now on an active subscription) uploads the LOA + invoice via
 * `PUT /:id/documents`, then the submit route confirms the order. A
 * draft-without-documents is therefore a valid resting state awaiting the
 * customer — never an order confirmed with no documents (which the carrier
 * would reject).
 */
export async function startPortSaga(
  env: Env,
  input: StartPortSagaInput,
): Promise<PortRequestRow | null> {
  const db = getDb(env);
  const row = await fetchPortRow(db, input.portRequestId);
  if (!row) {
    throw new Error(`startPortSaga: port_requests ${input.portRequestId} not found`);
  }
  // Terminal / already-submitted rows: nothing to drive from here (the async
  // half runs on webhooks/cron). Resuming a submitted+ order re-reads it in the
  // reconcile cron, not here.
  if (
    row.status === "cancelled" ||
    row.status === "cancel-pending" ||
    row.status === "ported"
  ) {
    return row;
  }

  try {
    return await runPortSagaSteps(env, db, row);
  } catch (cause) {
    return recordPortFailure(env, db, row, cause);
  }
}

/** Both LOA and invoice UUIDs are attached to the row (§3.2 / §6 confirm gate). */
export function hasRequiredDocuments(row: PortRequestRow): boolean {
  return (
    typeof row.telnyx_loa_document_id === "string" &&
    row.telnyx_loa_document_id.length > 0 &&
    typeof row.telnyx_invoice_document_id === "string" &&
    row.telnyx_invoice_document_id.length > 0
  );
}

/**
 * P1–P4 — ensure the profile, create the porting order (persist the id
 * immediately), and PATCH it. Stops at a Telnyx `draft`; the row stays
 * `status='draft'`. Does NOT confirm — that is {@link submitPortRequest},
 * gated on documents being present.
 */
async function runPortSagaSteps(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
): Promise<PortRequestRow> {
  // P1 — ensure the per-company messaging profile (reuse S1). A port-only
  // signup still needs one.
  const company = await fetchProvisioningCompany(db, row.company_id);
  const messagingProfileId = await ensureMessagingProfile(env, db, company);

  // P2 — create the porting order; persist the id IMMEDIATELY (crash-after-
  // create protection). Idempotent: skip if already created.
  let current = row;
  if (!current.telnyx_porting_order_id) {
    const orderId = await createPortingOrder(env, current.phone_e164);
    current = await updatePortRow(db, current.id, {
      telnyx_porting_order_id: orderId,
      status: current.status === "draft" ? "draft" : current.status,
    });
  }

  // P3 — upload LOA + invoice if present and not already stored. Documents are
  // optional at row-insert time (two-step upload path via PUT /:id/documents);
  // (Uploads that already have a UUID are skipped — idempotent.)

  // P4 — the declarative PATCH (end_user + FOC + messaging + documents). The
  // documents object carries whatever UUIDs are on the row so far (possibly
  // none, during onboarding before the customer uploads them); the confirm-time
  // re-PATCH re-attaches them once present.
  await patchPortingOrder(env, current, messagingProfileId);

  // The saga stops here at a Telnyx `draft`. Confirmation is submitPortRequest,
  // hard-gated on LOA + invoice — never auto-confirmed with no documents.
  return current;
}

/**
 * §3.5 / §6 — the post-payment completion step: re-PATCH the order (so the
 * now-uploaded LOA + invoice, and messaging enablement, are attached) then
 * `POST /actions/confirm`, moving the order `draft → in-process`. HARD-GATED on
 * both documents: throws {@link PortDocumentsMissingError} (mapped to §7
 * `conflict` by the route) when either the LOA or the invoice is missing —
 * confirming an order with no documents is exactly the carrier-rejection bug
 * this gate prevents.
 *
 * Shared by `POST /:id/submit` (draft) and `POST /:id/resubmit` (exception).
 * Idempotent per Telnyx (the PATCH is declarative); it stamps submitted_at,
 * increments submission_count, moves the messaging track not_applicable →
 * pending, and sends the §9 "submitted" email.
 */
export async function submitPortRequest(
  env: Env,
  input: StartPortSagaInput,
): Promise<PortRequestRow | null> {
  const db = getDb(env);
  const row = await fetchPortRow(db, input.portRequestId);
  if (!row) {
    throw new Error(`submitPortRequest: port_requests ${input.portRequestId} not found`);
  }
  if (
    row.status === "cancelled" ||
    row.status === "cancel-pending" ||
    row.status === "ported"
  ) {
    return row;
  }

  // The confirm gate (§6): never confirm a Telnyx porting order without the LOA
  // AND the invoice attached — the carrier rejects an order with no documents.
  if (!hasRequiredDocuments(row)) {
    throw new PortDocumentsMissingError();
  }

  try {
    return await runPortConfirmSteps(env, db, row);
  } catch (cause) {
    if (cause instanceof PortDocumentsMissingError) throw cause;
    return recordPortFailure(env, db, row, cause);
  }
}

/**
 * Thrown by {@link submitPortRequest} when the confirm gate fails (LOA and/or
 * invoice not attached). The route maps it to the §7 `conflict` code.
 */
export class PortDocumentsMissingError extends Error {
  constructor() {
    super("Upload the signed LOA and a recent bill before submitting the transfer.");
    this.name = "PortDocumentsMissingError";
  }
}

/** P4 (re-PATCH, docs now present) + P5 (confirm). Documents already verified. */
async function runPortConfirmSteps(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
): Promise<PortRequestRow> {
  const company = await fetchProvisioningCompany(db, row.company_id);
  const messagingProfileId = await ensureMessagingProfile(env, db, company);

  // P2 idempotent backstop: an order must exist to confirm. A resubmit/submit
  // that somehow lost its order id re-creates it (crash-after-create healing).
  let current = row;
  if (!current.telnyx_porting_order_id) {
    const orderId = await createPortingOrder(env, current.phone_e164);
    current = await updatePortRow(db, current.id, {
      telnyx_porting_order_id: orderId,
    });
  }

  // P4 — the declarative PATCH, now re-attaching the LOA + invoice + messaging
  // enablement (re-sent every confirm; a rejection can drop the messaging
  // sub-order and `exception` is in-window).
  await patchPortingOrder(env, current, messagingProfileId);

  // P5 — submit/confirm: draft/exception → in-process; stamp submitted_at,
  // count++.
  await confirmPortingOrder(env, current.telnyx_porting_order_id as string);
  const submitted = await updatePortRow(db, current.id, {
    status: "in-process",
    submitted_at: current.submitted_at ?? new Date().toISOString(),
    submission_count: current.submission_count + 1,
    rejection_reason: null,
    messaging_port_status:
      current.messaging_port_status === "not_applicable"
        ? "pending"
        : current.messaging_port_status,
  });

  await sendPortEmail(
    env,
    db,
    submitted.company_id,
    portSubmittedCopy(submitted.phone_e164, env),
  );
  return submitted;
}

/**
 * §4 failure handling (mirrors recordProvisionFailure): store the error on the
 * row + a Sentry event, leaving the row in a resumable status for the daily
 * cron. A carrier rejection is DIFFERENT — it arrives as a Telnyx `exception`
 * status via webhook, not a thrown error, and routes to fix-and-resubmit (§6).
 */
async function recordPortFailure(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
  cause: unknown,
): Promise<PortRequestRow> {
  const message = cause instanceof Error ? cause.message : String(cause);
  Sentry.captureException(cause);
  return updatePortRow(db, row.id, {
    rejection_reason: message.slice(0, 2000),
  });
}

// ---------------------------------------------------------------------------
// P6 — messaging ported → number goes live (guarded, idempotent)
// ---------------------------------------------------------------------------

/**
 * §4 P6 (also the webhook-missed cron recovery path, §5.2): flip the
 * `phone_numbers` row provisioning → active, resolve its Telnyx id, assign it
 * to the approved campaign (R3), stamp ported_at, email + fire completion.
 * Idempotent: a no-op when the number row is already `active` (guard on
 * phone_numbers.status).
 */
async function runP6Completion(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
): Promise<PortRequestRow> {
  const phone = await fetchPhoneRow(db, row.phone_number_id);
  if (!phone) {
    throw new Error(`P6: phone_numbers ${row.phone_number_id} not found`);
  }
  // Idempotency guard — P6 already ran (or was resubscribe-adopted).
  if (phone.status === "active" && row.ported_at) return row;

  if (phone.status !== "active") {
    // P6a — the number is now Telnyx-owned; resolve its id from the listing.
    const owned = await lookupOwnedNumber(env, row.phone_e164);
    const { error } = await db
      .from("phone_numbers")
      .update({
        status: "active",
        number_e164: row.phone_e164,
        telnyx_phone_number_id: owned?.id ?? null,
        porting_status: "ported",
        last_provision_error: null,
      })
      .eq("id", row.phone_number_id)
      .neq("status", "active");
    if (error) throw new Error(`P6a number activation failed: ${error.message}`);
  }

  // P6b — assign to the already-approved campaign (identical R3 call). The
  // 10dlc.phone_number.update webhook confirms ADDED / records FAILED; the
  // §4.4 retry cron re-runs failures.
  const { campaign } = await fetchRegistrationRows(db, row.company_id);
  if (campaign) {
    try {
      await assignNumbersToCampaign(env, db, campaign);
    } catch (cause) {
      // A FAILED assignment is surfaced via the ledger + §9 copy, not here.
      Sentry.captureException(cause);
    }
  }

  // P6c — stamp ported_at.
  const updated = await updatePortRow(db, row.id, {
    ported_at: row.ported_at ?? new Date().toISOString(),
    rejection_reason: null,
  });

  // P6d — "your number is live" email.
  await sendPortEmail(
    env,
    db,
    updated.company_id,
    portCompletedCopy(updated.phone_e164, env),
  );

  // P6e — bridge nudge: the opt-in tide-me-over number has done its job; nudge
  // the owner to release it (their call — never automatic). Rides P6's
  // idempotency guard, so it fires once with P6d. Best-effort: a nudge failure
  // must not wedge the completed port (P6c already stamped ported_at).
  if (updated.bridge_number_id) {
    try {
      const bridge = await fetchPhoneRow(db, updated.bridge_number_id);
      if (bridge?.status === "active" && bridge.number_e164) {
        await sendPortEmail(
          env,
          db,
          updated.company_id,
          portBridgeReleaseNudgeCopy(
            updated.phone_e164,
            bridge.number_e164,
            env,
          ),
        );
      }
    } catch (cause) {
      Sentry.captureException(cause);
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Guarded transition appliers (shared by webhook + reconcile cron)
// ---------------------------------------------------------------------------

/**
 * Apply a voice-track `status` transition with its §5.1 side effects. No-op
 * (returns the row unchanged) when the transition is not allowed from the
 * current status — this is what makes duplicate/out-of-order deliveries and the
 * webhook/cron overlap harmless and fires each email exactly once.
 *
 * `getOrderForFoc` supplies the §3.6 order read used ONLY on the
 * `foc-date-confirmed` transition (the status webhook carries no FOC date).
 */
async function applyStatusTransition(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
  next: PortStatus,
  options: {
    statusDetails?: unknown;
    focDatetimeActual?: string | null;
  },
): Promise<PortRequestRow> {
  if (!ALLOWED_STATUS_TRANSITIONS[row.status].includes(next)) return row;

  const patch: Record<string, unknown> = { status: next };
  const now = new Date().toISOString();

  if (next === "foc-date-confirmed" && options.focDatetimeActual) {
    patch.foc_date = options.focDatetimeActual;
  }
  if (next === "exception") {
    patch.rejection_reason =
      flattenDetails(options.statusDetails) ??
      "Your carrier flagged something on the transfer.";
  }
  if (next === "in-process" || next === "submitted") {
    patch.rejection_reason = null;
  }
  if (next === "cancelled") {
    patch.cancelled_at = row.cancelled_at ?? now;
  }

  const updated = await updatePortRow(db, row.id, patch);

  if (next === "foc-date-confirmed") {
    await sendPortEmail(
      env,
      db,
      updated.company_id,
      portFocConfirmedCopy(updated.phone_e164, updated.foc_date, env),
    );
  }
  if (next === "exception") {
    await sendPortEmail(
      env,
      db,
      updated.company_id,
      portExceptionCopy(
        updated.phone_e164,
        updated.rejection_reason ?? "",
        env,
      ),
    );
  }
  if (next === "cancelled") {
    // The linked number never went live — release/mark it released (§3.8).
    const phone = await fetchPhoneRow(db, updated.phone_number_id);
    if (phone && phone.status !== "released") {
      try {
        await releaseNumberRow(env, phone);
      } catch (cause) {
        Sentry.captureException(cause);
      }
    }
  }
  return updated;
}

/**
 * Apply a `messaging_port_status` transition with its P6 / exception side
 * effects. Messaging is a separate track with its own field; `ported` is what
 * unlocks Loonext texting. Idempotent (P6 no-ops on already-active rows).
 * Guarded by {@link ALLOWED_MESSAGING_TRANSITIONS} (#50): a late/replayed
 * webhook can never regress the track — in particular never un-port it.
 */
async function applyMessagingTransition(
  env: Env,
  db: SupabaseClient,
  row: PortRequestRow,
  next: PortMessagingStatus,
): Promise<PortRequestRow> {
  if (row.messaging_port_status === next) {
    // Same value — still run P6 if we somehow landed on `ported` without the
    // number being active yet (webhook/cron overlap recovery).
    if (next === "ported") return runP6Completion(env, db, row);
    return row;
  }
  if (!ALLOWED_MESSAGING_TRANSITIONS[row.messaging_port_status].includes(next)) {
    // Out-of-order / replayed delivery (#50) — harmless no-op, exactly like
    // the voice track's guard.
    return row;
  }

  const updated = await updatePortRow(db, row.id, {
    messaging_port_status: next,
    ...(next === "exception"
      ? {
          rejection_reason:
            "Texting routing not yet released by the losing carrier; Telnyx is escalating.",
        }
      : {}),
  });

  if (next === "ported") {
    return runP6Completion(env, db, updated);
  }
  if (next === "exception") {
    await sendPortEmail(
      env,
      db,
      updated.company_id,
      portMessagingExceptionCopy(updated.phone_e164),
    );
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Cancel (PORTING.md §3.8 / §6) — shared by the route + any programmatic caller
// ---------------------------------------------------------------------------

/**
 * §3.8 / §6 cancel: abandon a pre-completion port. Two shapes, per the spec's
 * "released on completion" rule and the paid-first onboarding deferral (D16):
 *
 *   - **A Telnyx order exists** — ask Telnyx to cancel it (tolerating a 404 for
 *     a never-created / already-gone order), then park the row in
 *     `cancel-pending`. Telnyx then drives it `cancel-pending → cancelled` via
 *     the `porting_order.status_changed` webhook (or the §5.2 reconcile poll),
 *     and the guarded `cancelled` transition releases the linked number.
 *
 *   - **No Telnyx order yet** (the onboarding path: the order is deferred to the
 *     paid webhook, so a pre-payment cancel has `telnyx_porting_order_id=NULL`)
 *     — there is nothing at Telnyx to cancel and NOTHING will ever drive the row
 *     out of `cancel-pending` (the §5.2 poll skips cancel-pending rows and rows
 *     with no order id). So complete the cancel IMMEDIATELY: apply the guarded
 *     `→ cancelled` transition here, which releases the still-`provisioning`
 *     phone_numbers row (it never went live) and frees the company's number slot.
 *
 * Idempotent: an already-`cancelled` row (or one whose transition is not allowed
 * from its current status) is returned unchanged by `applyStatusTransition`.
 */
export async function cancelPortRequest(
  env: Env,
  row: PortRequestRow,
): Promise<PortRequestRow> {
  const db = getDb(env);

  if (row.telnyx_porting_order_id) {
    // Order exists → Telnyx-driven cancel; the webhook/cron completes it.
    try {
      await cancelPortingOrder(env, row.telnyx_porting_order_id);
    } catch (cause) {
      if (!(cause instanceof TelnyxApiError && cause.status === 404)) {
        throw cause;
      }
    }
    return applyStatusTransition(env, db, row, "cancel-pending", {});
  }

  // No order at Telnyx (onboarding pre-payment) → complete the cancel now so the
  // number slot is released instead of wedging forever in cancel-pending.
  return applyStatusTransition(env, db, row, "cancelled", {});
}

// ---------------------------------------------------------------------------
// Webhook entry point (PORTING.md §5.1) — dispatched from dispatchTelnyxEvent
// ---------------------------------------------------------------------------

interface PortingEventEnvelope {
  event_type?: unknown;
  payload?: unknown;
}

/** Accept the full `{ data: {...} }` envelope and the bare `data`. */
function normalizePortingEvent(event: unknown): {
  eventType: string;
  payload: Record<string, unknown>;
} | null {
  if (event === null || typeof event !== "object") return null;
  let data = event as PortingEventEnvelope;
  if (
    typeof data.event_type !== "string" &&
    "data" in event &&
    (event as { data?: unknown }).data !== null &&
    typeof (event as { data?: unknown }).data === "object"
  ) {
    data = (event as { data: PortingEventEnvelope }).data;
  }
  if (typeof data.event_type !== "string") return null;
  const payload =
    data.payload !== null && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : {};
  return { eventType: data.event_type, payload };
}

function payloadPortingOrderId(payload: Record<string, unknown>): string | null {
  // The status_changed payload keys the order under `id`; other shapes may use
  // `porting_order_id`.
  if (typeof payload.id === "string") return payload.id;
  if (typeof payload.porting_order_id === "string") {
    return payload.porting_order_id;
  }
  return null;
}

/**
 * §5.1 `porting_order.*` handler — imported into `dispatchTelnyxEvent` behind
 * `if (eventType.startsWith("porting_order.")) return handlePortingEvent(...)`.
 * Because the webhook sweeper re-drives ledgered rows through the same
 * dispatcher, this one handler also covers sweeper replay (no separate change).
 *
 * Handled: status_changed, messaging_changed, new_comment. split/deleted/
 * loa_updated → Sentry breadcrumb + let the daily cron reconcile.
 * sharing_token_expired (Verification correction 5) never fires for our
 * API-created single-number ports and falls through to the acked no-op.
 */
export async function handlePortingEvent(
  env: Env,
  event: unknown,
): Promise<void> {
  const normalized = normalizePortingEvent(event);
  if (!normalized) return;
  const { eventType, payload } = normalized;
  const db = getDb(env);

  const orderId = payloadPortingOrderId(payload);
  if (!orderId) return; // unusable envelope → acked no-op

  if (eventType === "porting_order.status_changed") {
    const row = await fetchPortRowByOrderId(db, orderId);
    if (!row) return; // out-of-order / foreign order → acked no-op
    const statusObj =
      payload.status !== null && typeof payload.status === "object"
        ? (payload.status as { value?: unknown; details?: unknown })
        : {};
    const rawValue =
      typeof statusObj.value === "string" ? statusObj.value : null;
    if (
      !rawValue ||
      !(PORT_STATUS_VALUES as readonly string[]).includes(rawValue)
    ) {
      return;
    }
    const next = rawValue as PortStatus;

    // On foc-date-confirmed the webhook carries NO FOC date — read the order
    // (§3.6) for activation_settings.foc_datetime_actual.
    let focDatetimeActual: string | null = null;
    if (next === "foc-date-confirmed") {
      const order = await getPortingOrder(env, orderId);
      focDatetimeActual = order.focDatetimeActual;
    }
    await applyStatusTransition(env, db, row, next, {
      statusDetails: statusObj.details,
      focDatetimeActual,
    });
    return;
  }

  if (eventType === "porting_order.messaging_changed") {
    const row = await fetchPortRowByOrderId(db, orderId);
    if (!row) return;
    const rawMessaging =
      typeof payload.messaging_port_status === "string"
        ? payload.messaging_port_status
        : null;
    if (
      !rawMessaging ||
      !(MESSAGING_STATUS_VALUES as readonly string[]).includes(rawMessaging)
    ) {
      return;
    }
    await applyMessagingTransition(
      env,
      db,
      row,
      rawMessaging as PortMessagingStatus,
    );
    return;
  }

  if (eventType === "porting_order.new_comment") {
    const row = await fetchPortRowByOrderId(db, orderId);
    if (!row) return;
    // MVP (§5.1): fold an actionable comment into rejection_reason only while
    // the order is in `exception` (the fix-and-resubmit surface); otherwise it
    // is a processing note the detail UI reads from the order resource.
    const text =
      typeof payload.body === "string"
        ? payload.body
        : typeof payload.comment === "string"
          ? payload.comment
          : null;
    if (text && row.status === "exception") {
      await updatePortRow(db, row.id, {
        rejection_reason: text.slice(0, 2000),
      });
    }
    return;
  }

  // split / deleted / loa_updated (and unknown porting_order.*): breadcrumb +
  // let the daily cron reconcile from GET /v2/porting_orders/{id}.
  Sentry.addBreadcrumb({
    category: "porting",
    level: "info",
    message: `unhandled ${eventType}; cron will reconcile order ${orderId}`,
  });
}

// ---------------------------------------------------------------------------
// §5.2 Reconciliation cron: poll in-flight orders, recover messaging exceptions
// ---------------------------------------------------------------------------

export interface PortReconcileSummary {
  polled: number;
  resumed: number;
  statusTransitioned: number;
  messagingTransitioned: number;
}

/** Exponential backoff for resuming stalled pre-submit sagas (like provisioning). */
function resumeDue(row: PortRequestRow, now: Date): boolean {
  if (!row.updated_at) return true;
  const waitMs = 2 ** Math.min(row.submission_count, MAX_PORT_ATTEMPTS) * 60_000;
  return now.getTime() - new Date(row.updated_at).getTime() >= waitMs;
}

/**
 * §5.2 "Port reconcile & resume" cron body (daily). Work-set: every
 * `port_requests` row NOT fully done — `status NOT IN ('ported','cancelled')`
 * OR `messaging_port_status NOT IN ('ported','not_applicable')` (a voice-
 * ported row whose messaging is still pending/activating/exception is NOT
 * terminal and stays in the set). For each row:
 *   1. stalled pre-submit (no order id, or draft) → resume startPortSaga;
 *   2. else GET the order and apply any missed `status` transition (guarded),
 *      refreshing foc_datetime_actual → foc_date;
 *   3. reconcile messaging_port_status from the same GET — INCLUDING rows stuck
 *      at `exception`: on the reconciled `→ ported` transition, run P6 (the
 *      webhook-missed path; P6 is idempotent);
 *   4. re-run assignNumbersToCampaign for ported numbers — handled by the §4.4
 *      retryCampaignAssignments cron (shared 15-min slot), so not duplicated
 *      here.
 */
export async function pollPortRequests(
  env: Env,
  now: Date = new Date(),
): Promise<PortReconcileSummary> {
  const db = getDb(env);
  const summary: PortReconcileSummary = {
    polled: 0,
    resumed: 0,
    statusTransitioned: 0,
    messagingTransitioned: 0,
  };

  // Work-set part 1: rows whose voice status is not terminal (§5.2). Two
  // chained .neq are ANDed by PostgREST — "status NOT IN (ported, cancelled)".
  const { data, error } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .neq("status", "ported")
    .neq("status", "cancelled");
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);

  // Work-set part 2: voice-ported rows whose messaging is still non-terminal
  // must ALSO be in the set (their status is 'ported', so part 1 excludes them).
  const { data: portedRows, error: portedError } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .eq("status", "ported")
    .neq("messaging_port_status", "ported")
    .neq("messaging_port_status", "not_applicable");
  if (portedError) {
    throw new Error(`port_requests lookup failed: ${portedError.message}`);
  }

  const rows = [
    ...((data ?? []) as unknown as PortRequestRow[]),
    ...((portedRows ?? []) as unknown as PortRequestRow[]),
  ];

  const failures: unknown[] = [];
  for (const row of rows) {
    try {
      summary.polled += 1;

      // 1a. No Telnyx order yet → resume the saga (P1–P4) to create the draft.
      // Idempotent on persisted order/doc ids. A draft-without-documents is a
      // valid resting state (awaiting the customer's LOA + invoice upload), so
      // this only creates the order; it does NOT confirm.
      if (
        !row.telnyx_porting_order_id &&
        row.status === "draft" &&
        resumeDue(row, now)
      ) {
        await startPortSaga(env, {
          companyId: row.company_id,
          portRequestId: row.id,
        });
        summary.resumed += 1;
        continue; // next cron pass confirms once documents are present
      }

      // 1b. A draft order WITH both documents attached that was never confirmed
      // (missed confirm call / crash after upload) → drive the documents-gated
      // confirm now. A draft still missing documents stays put (resting state).
      if (
        row.telnyx_porting_order_id &&
        row.status === "draft" &&
        hasRequiredDocuments(row) &&
        resumeDue(row, now)
      ) {
        await submitPortRequest(env, {
          companyId: row.company_id,
          portRequestId: row.id,
        });
        summary.resumed += 1;
        continue; // next cron pass reconciles the freshly-submitted order
      }

      if (!row.telnyx_porting_order_id) continue;

      // 2 + 3. Reconcile from the authoritative order read.
      const order = await getPortingOrder(env, row.telnyx_porting_order_id);

      let currentRow = row;
      if (order.status && order.status !== currentRow.status) {
        const before = currentRow.status;
        currentRow = await applyStatusTransition(
          env,
          db,
          currentRow,
          order.status,
          {
            statusDetails: order.statusDetails,
            focDatetimeActual: order.focDatetimeActual,
          },
        );
        if (currentRow.status !== before) summary.statusTransitioned += 1;
      } else if (
        order.focDatetimeActual &&
        currentRow.foc_date !== order.focDatetimeActual &&
        (currentRow.status === "foc-date-confirmed" ||
          currentRow.status === "activation-in-progress")
      ) {
        // Same status but a newly-available confirmed FOC — refresh it.
        currentRow = await updatePortRow(db, currentRow.id, {
          foc_date: order.focDatetimeActual,
        });
      }

      if (
        order.messagingPortStatus &&
        order.messagingPortStatus !== currentRow.messaging_port_status
      ) {
        const before = currentRow.messaging_port_status;
        currentRow = await applyMessagingTransition(
          env,
          db,
          currentRow,
          order.messagingPortStatus,
        );
        if (currentRow.messaging_port_status !== before) {
          summary.messagingTransitioned += 1;
        }
      } else if (
        order.messagingPortStatus === "ported" &&
        currentRow.messaging_port_status === "ported" &&
        !currentRow.ported_at
      ) {
        // Messaging is 'ported' but P6 never completed (missed webhook) — run
        // the idempotent completion now.
        await runP6Completion(env, db, currentRow);
        summary.messagingTransitioned += 1;
      }
    } catch (cause) {
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `port reconcile finished with ${failures.length} failure(s)`,
    );
  }
  return summary;
}
