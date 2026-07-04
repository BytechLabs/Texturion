/**
 * Keep-your-number: TEXT-ENABLEMENT of an existing number (FEATURE-GAPS voice
 * wave, keep-your-number path B). The owner keeps VOICE on their current carrier
 * and Telnyx adds SMS to the number via a hosted-messaging order
 * (POST /v2/messaging_hosted_number_orders). This is the alternative to a full
 * port-in (path A, D16/PORTING) for owners who only want to text FROM their
 * advertised number without moving voice.
 *
 * Honest about timelines: a hosted-SMS order is carrier-reviewed (LOA + a recent
 * bill), typically a few business days, and messaging is not live until the
 * order reaches 'completed'. The state machine mirrors Telnyx's REAL order
 * status vocabulary (verified against team-telnyx/openapi,
 * MessagingHostedNumberOrder.status):
 *
 *   pending                        → pending
 *   provisioning, loa_file_successful → in-progress
 *   incomplete_documentation, loa_file_invalid,
 *   incorrect_billing_information  → action-required (fix + re-attach docs)
 *   carrier_rejected, ineligible_carrier,
 *   compliance_review_failed, failed → failed (raw status kept in last_error)
 *   deleted                        → cancelled
 *   successful                     → completed
 *
 * An UNKNOWN status keeps the row's current status (and Sentry-warns) rather
 * than silently resetting to 'pending'.
 *
 * Number-ownership verification: the hosted-messaging API supports an optional
 * carrier verification step (spec-verified endpoints:
 * POST /v2/messaging_hosted_number_orders/{id}/verification_codes sends an
 * sms/call code to the number; POST .../validation_codes checks the code(s)).
 * {@link requestHostedVerificationCodes} / {@link submitHostedVerificationCode}
 * wrap them for the owner-facing routes. NO local verification state is kept —
 * the Telnyx order itself is the source of truth.
 *
 * The saga (mirrors the §4.3 number-provisioning saga discipline):
 *   S1  ensure the per-company messaging profile (reused: ensureMessagingProfile)
 *   S2  create the hosted-number order for the E.164, on the profile; persist
 *       telnyx_hosted_order_id IMMEDIATELY (crash-after-order protection).
 *       Skipped (with a clear last_error) while the subscription is not active
 *       — creating a NEW Telnyx order is a paid action; polling an EXISTING
 *       order is not and continues regardless.
 *   S2b attach the owner's LOA + recent bill to the order. The hosted API takes
 *       the FILES themselves (multipart loa/bill parts on POST
 *       /v2/messaging_hosted_number_orders/{id}/actions/file_upload), NOT
 *       document ids like porting's PATCH — so the documents (uploaded to
 *       POST /v2/documents by the route, ids on the row) are downloaded back
 *       from GET /v2/documents/{id}/download and re-posted to the order.
 *       Re-attached whenever Telnyx holds the order at 'action-required' with
 *       both docs on the row (self-healing for a failed attach).
 *   S3  poll/complete the order to 'completed' and flip the phone_numbers row to
 *       'active' (messaging live). Until then the number stays 'provisioning'.
 *
 * Cancel-race safety: every saga write carries `.neq(status,'cancelled')` so a
 * concurrent cancel/release can never be overwritten. When a write hits 0 rows
 * because the order was cancelled mid-flight, the saga converges instead of
 * throwing: it re-reads the row and — if a Telnyx order was JUST created (so
 * the cancel path's DELETE could not have seen it) — deletes that fresh Telnyx
 * order (404-tolerated). Likewise the number-activation write is guarded to
 * `status='provisioning'` so a released row can never flip back to 'active'.
 *
 * Attempt budget: a FAILED pass increments `attempts`; a successful pass resets
 * it to 0 (transient errors never permanently eat the budget). Exhausting
 * MAX_ENABLEMENT_ATTEMPTS lands the order at status='failed' with last_error
 * retained — visible to the owner (who can fix + resubmit), plus the Sentry
 * fatal for the operator.
 *
 * The phone_numbers row (source='hosted') and text_enablement_orders row are
 * inserted by claim_text_enablement_slot BEFORE the saga runs (the atomic slot
 * claim, idempotent on the provisioning_key) — same insert-first idempotency the
 * provisioned/ported paths use.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  telnyxRequest,
  TelnyxApiError,
  TELNYX_API_BASE,
  type TelnyxErrorItem,
} from "./client";
import {
  ensureMessagingProfile,
  fetchProvisioningCompany,
} from "./provisioning";
import { getDb } from "../db";
import type { Env } from "../env";

export const MAX_ENABLEMENT_ATTEMPTS = 5;

export interface TextEnablementOrderRow {
  id: string;
  company_id: string;
  phone_number_id: string;
  phone_e164: string;
  country: string;
  provisioning_key: string;
  telnyx_hosted_order_id: string | null;
  telnyx_hosted_number_id: string | null;
  telnyx_loa_document_id: string | null;
  telnyx_bill_document_id: string | null;
  status:
    | "pending"
    | "action-required"
    | "in-progress"
    | "completed"
    | "failed"
    | "cancelled";
  last_error: string | null;
  attempts: number;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at?: string;
}

export const ORDER_COLUMNS =
  "id,company_id,phone_number_id,phone_e164,country,provisioning_key," +
  "telnyx_hosted_order_id,telnyx_hosted_number_id,telnyx_loa_document_id," +
  "telnyx_bill_document_id,status,last_error,attempts,completed_at," +
  "cancelled_at,created_at,updated_at";

// Telnyx hosted-order response shapes (only fields we read).
interface HostedOrderResponse {
  data?: {
    id?: string;
    status?: string;
    phone_numbers?: { id?: string; phone_number?: string }[];
  };
}

/**
 * Map a Telnyx hosted-order status onto our local enum. The input vocabulary
 * is the REAL MessagingHostedNumberOrder.status enum from the Telnyx OpenAPI
 * spec (see the module header) — an unknown value keeps the row's CURRENT
 * status (never a silent reset to 'pending') and Sentry-warns with the raw
 * value so new vendor statuses surface to the operator.
 */
export function mapHostedStatus(
  raw: string | undefined,
  current: TextEnablementOrderRow["status"],
): TextEnablementOrderRow["status"] {
  switch ((raw ?? "").toLowerCase()) {
    case "successful":
      return "completed";
    case "pending":
      return "pending";
    case "provisioning":
    case "loa_file_successful":
      return "in-progress";
    case "incomplete_documentation":
    case "loa_file_invalid":
    case "incorrect_billing_information":
      return "action-required";
    case "carrier_rejected":
    case "ineligible_carrier":
    case "compliance_review_failed":
    case "failed":
      return "failed";
    case "deleted":
      return "cancelled";
    default:
      Sentry.captureMessage(
        `unknown Telnyx hosted-order status ${JSON.stringify(raw ?? null)} — keeping '${current}'`,
        "warning",
      );
      return current;
  }
}

/** Owner-visible copy for the terminal Telnyx failure statuses. */
const HOSTED_FAILURE_COPY: Record<string, string> = {
  carrier_rejected: "Carrier rejected the hosted-messaging order",
  ineligible_carrier: "This number's carrier doesn't support hosted messaging",
  compliance_review_failed:
    "The hosted-messaging order failed compliance review",
  failed: "The hosted-messaging order failed",
};

/** last_error for a 'failed' mapping — keeps the RAW Telnyx status visible. */
function hostedFailureError(raw: string | undefined): string {
  const key = (raw ?? "").toLowerCase();
  const copy = HOSTED_FAILURE_COPY[key] ?? "The hosted-messaging order failed";
  return `${copy} (Telnyx status: ${key || "unknown"})`;
}

async function readOrder(
  db: SupabaseClient,
  orderId: string,
): Promise<TextEnablementOrderRow> {
  const { data, error } = await db
    .from("text_enablement_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .limit(1);
  if (error) {
    throw new Error(`text_enablement_orders lookup failed: ${error.message}`);
  }
  const row = (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
  if (!row) throw new Error(`text_enablement_orders row ${orderId} vanished`);
  return row;
}

/** Unguarded write — cancel's own use only (it is the writer of 'cancelled'). */
async function updateOrder(
  db: SupabaseClient,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<TextEnablementOrderRow> {
  const { data, error } = await db
    .from("text_enablement_orders")
    .update(patch)
    .eq("id", orderId)
    .select(ORDER_COLUMNS);
  if (error) {
    throw new Error(`text_enablement_orders update failed: ${error.message}`);
  }
  const row = (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
  if (!row) throw new Error(`text_enablement_orders row ${orderId} vanished`);
  return row;
}

/**
 * Saga-side guarded write: never overwrite a cancel that landed mid-flight
 * (`.neq(status,'cancelled')`). On 0 rows the order was cancelled between the
 * saga's read and this write — re-read and converge: when a Telnyx order was
 * JUST created (`justCreatedTelnyxOrderId`), the concurrent cancel's DELETE
 * could not have seen it, so delete it here (404-tolerated); then return the
 * cancelled row instead of throwing.
 */
async function updateOrderUnlessCancelled(
  env: Env,
  db: SupabaseClient,
  orderId: string,
  patch: Record<string, unknown>,
  justCreatedTelnyxOrderId?: string,
): Promise<TextEnablementOrderRow> {
  const { data, error } = await db
    .from("text_enablement_orders")
    .update(patch)
    .eq("id", orderId)
    .neq("status", "cancelled")
    .select(ORDER_COLUMNS);
  if (error) {
    throw new Error(`text_enablement_orders update failed: ${error.message}`);
  }
  const row = (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
  if (row) return row;
  const current = await readOrder(db, orderId);
  if (current.status === "cancelled" && justCreatedTelnyxOrderId) {
    await deleteHostedOrder(env, justCreatedTelnyxOrderId);
  }
  return current;
}

/**
 * Flip the linked phone_numbers row to active once messaging is live. Guarded
 * to `status='provisioning'` so a row released by a concurrent cancel can
 * NEVER flip back to 'active'. Returns false when activation was skipped
 * (0 rows and the row is not already active) — the caller must then skip
 * completion and leave the order for the cancel/release path to converge.
 */
async function activateHostedNumber(
  db: SupabaseClient,
  order: TextEnablementOrderRow,
): Promise<boolean> {
  const { data, error } = await db
    .from("phone_numbers")
    .update({ status: "active", last_provision_error: null })
    .eq("id", order.phone_number_id)
    .eq("company_id", order.company_id)
    .eq("status", "provisioning")
    .select("id");
  if (error) {
    throw new Error(`hosted number activate failed: ${error.message}`);
  }
  if ((data ?? []).length > 0) return true;
  // 0 rows — the number left 'provisioning' out of band. Only an ALREADY
  // ACTIVE row (an earlier completed pass whose order write failed) may
  // proceed idempotently; a released/suspended row must never flip back.
  const { data: reread, error: rereadError } = await db
    .from("phone_numbers")
    .select("status")
    .eq("id", order.phone_number_id)
    .limit(1);
  if (rereadError) {
    throw new Error(`phone_numbers lookup failed: ${rereadError.message}`);
  }
  return (reread?.[0] as { status?: string } | undefined)?.status === "active";
}

/** Release the linked provisioning row (never leave a dangling slot). */
async function releaseHostedPhoneRow(
  db: SupabaseClient,
  order: TextEnablementOrderRow,
): Promise<void> {
  const { error } = await db
    .from("phone_numbers")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("id", order.phone_number_id)
    .eq("company_id", order.company_id)
    .neq("status", "released");
  if (error) {
    throw new Error(`hosted number release failed: ${error.message}`);
  }
}

/**
 * DELETE a Telnyx hosted-messaging order, tolerating a 404 (already gone).
 * DELETE is the documented cancel ("delete a messaging hosted number order and
 * all associated phone numbers") — the hosted-messaging API has no
 * /actions/cancel. Reused by cancel, the cancel-race convergence, and the
 * resubmit path (which deletes a dead order before creating a fresh one).
 */
export async function deleteHostedOrder(
  env: Env,
  telnyxHostedOrderId: string,
): Promise<void> {
  try {
    await telnyxRequest(env, {
      method: "DELETE",
      path: `/v2/messaging_hosted_number_orders/${telnyxHostedOrderId}`,
    });
  } catch (cause) {
    if (!(cause instanceof TelnyxApiError && cause.status === 404)) {
      throw cause;
    }
  }
}

/** Build a TelnyxApiError from a raw (non-JSON-client) response, like client.ts does. */
async function telnyxApiErrorFrom(
  response: Response,
  label: string,
): Promise<TelnyxApiError> {
  let errors: TelnyxErrorItem[] = [];
  try {
    const parsed = (await response.json()) as { errors?: unknown };
    if (Array.isArray(parsed.errors)) {
      errors = parsed.errors.filter(
        (item): item is TelnyxErrorItem =>
          item !== null && typeof item === "object",
      );
    }
  } catch {
    // Non-JSON error body — status alone still identifies the failure.
  }
  return new TelnyxApiError(response.status, errors, label);
}

/**
 * Fetch a stored document's bytes (GET /v2/documents/{id}/download). Raw fetch
 * rather than telnyxRequest because the response is the file, not JSON.
 */
async function downloadTelnyxDocument(
  env: Env,
  documentId: string,
): Promise<ArrayBuffer> {
  const label = `GET /v2/documents/${documentId}/download`;
  const response = await fetch(
    new URL(`/v2/documents/${documentId}/download`, TELNYX_API_BASE).toString(),
    { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } },
  );
  if (!response.ok) throw await telnyxApiErrorFrom(response, label);
  return response.arrayBuffer();
}

/**
 * S2b — attach the LOA + bill to the Telnyx hosted order. Unlike porting
 * (document ids in the order PATCH), the hosted-messaging API wants the files
 * themselves: multipart `loa` + `bill` PDF parts on
 * `POST /v2/messaging_hosted_number_orders/{id}/actions/file_upload`. The two
 * documents live in Telnyx's Documents API (uploaded by the route, ids on the
 * row), so they are downloaded back and re-posted. Idempotent — re-attaching
 * replaces the files on the order. Raw fetch because telnyxUpload carries a
 * single `file` part; this action needs two named binary parts.
 */
export async function attachHostedOrderDocuments(
  env: Env,
  order: TextEnablementOrderRow,
): Promise<void> {
  if (!order.telnyx_hosted_order_id) {
    throw new Error("cannot attach documents: no telnyx_hosted_order_id");
  }
  if (!order.telnyx_loa_document_id || !order.telnyx_bill_document_id) {
    throw new Error(
      "cannot attach documents: both the LOA and bill must be uploaded first",
    );
  }
  const [loa, bill] = await Promise.all([
    downloadTelnyxDocument(env, order.telnyx_loa_document_id),
    downloadTelnyxDocument(env, order.telnyx_bill_document_id),
  ]);
  const form = new FormData();
  // Plain filenames — Telnyx rejects special characters in hosted-doc names.
  form.append("loa", new Blob([loa], { type: "application/pdf" }), "loa.pdf");
  form.append("bill", new Blob([bill], { type: "application/pdf" }), "bill.pdf");
  const path = `/v2/messaging_hosted_number_orders/${order.telnyx_hosted_order_id}/actions/file_upload`;
  const response = await fetch(new URL(path, TELNYX_API_BASE).toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      Accept: "application/json",
      // No Content-Type: fetch sets multipart/form-data + boundary.
    },
    body: form,
  });
  if (!response.ok) throw await telnyxApiErrorFrom(response, `POST ${path}`);
}

export type HostedVerificationMethod = "sms" | "call";
export type HostedValidationOutcome =
  | "verified"
  | "rejected"
  | "already_verified";

interface VerificationCodesResponse {
  data?: {
    phone_number?: string;
    verification_code_id?: string;
    type?: string;
    error?: string;
  }[];
}

interface ValidationCodesResponse {
  data?: {
    order_id?: string;
    phone_numbers?: { phone_number?: string; status?: string }[];
  };
}

/**
 * Number-ownership verification, step 1: ask Telnyx to send a verification
 * code to the number being hosted (sms or a voice call — the owner still
 * controls the line on their current carrier). Spec-verified endpoint:
 * POST /v2/messaging_hosted_number_orders/{id}/verification_codes. Returns the
 * per-number error Telnyx reported (e.g. a landline that can't receive SMS),
 * or null when the code was sent. No local state — the Telnyx order is the
 * source of truth for verification.
 */
export async function requestHostedVerificationCodes(
  env: Env,
  order: TextEnablementOrderRow,
  method: HostedVerificationMethod,
): Promise<{ error: string | null }> {
  if (!order.telnyx_hosted_order_id) {
    throw new Error(
      "cannot request verification codes: no telnyx_hosted_order_id",
    );
  }
  const response = await telnyxRequest<VerificationCodesResponse>(env, {
    method: "POST",
    path: `/v2/messaging_hosted_number_orders/${order.telnyx_hosted_order_id}/verification_codes`,
    body: { phone_numbers: [order.phone_e164], verification_method: method },
  });
  const entry =
    (response.data ?? []).find(
      (item) => item.phone_number === order.phone_e164,
    ) ??
    response.data?.[0] ??
    null;
  return { error: entry?.error ?? null };
}

/**
 * Number-ownership verification, step 2: check the code the owner received.
 * Spec-verified endpoint:
 * POST /v2/messaging_hosted_number_orders/{id}/validation_codes. Returns
 * Telnyx's per-number outcome ('verified' | 'rejected' | 'already_verified').
 */
export async function submitHostedVerificationCode(
  env: Env,
  order: TextEnablementOrderRow,
  code: string,
): Promise<HostedValidationOutcome> {
  if (!order.telnyx_hosted_order_id) {
    throw new Error(
      "cannot validate a verification code: no telnyx_hosted_order_id",
    );
  }
  const response = await telnyxRequest<ValidationCodesResponse>(env, {
    method: "POST",
    path: `/v2/messaging_hosted_number_orders/${order.telnyx_hosted_order_id}/validation_codes`,
    body: {
      verification_codes: [{ phone_number: order.phone_e164, code }],
    },
  });
  const entry =
    (response.data?.phone_numbers ?? []).find(
      (item) => item.phone_number === order.phone_e164,
    ) ??
    response.data?.phone_numbers?.[0] ??
    null;
  const status = entry?.status;
  if (
    status === "verified" ||
    status === "rejected" ||
    status === "already_verified"
  ) {
    return status;
  }
  throw new Error(
    `hosted-order code validation returned no outcome for ${order.phone_e164}`,
  );
}

/**
 * S2+S3 for one order: create the hosted order (persist id first), attach the
 * documents when both are on the row, then read the order status; on
 * 'completed' activate the number. Never throws for a step failure — the
 * failure lands on the row (status/last_error/attempts) for the reconcile
 * cron; only infrastructure failures (DB unreachable) propagate. Every write
 * is cancel-guarded (see the module header): a cancel that lands mid-flight
 * wins, and the saga converges to the cancelled row instead of overwriting it.
 */
export async function resumeTextEnablement(
  env: Env,
  order: TextEnablementOrderRow,
): Promise<TextEnablementOrderRow> {
  const db = getDb(env);
  try {
    const company = await fetchProvisioningCompany(db, order.company_id);

    // S2: create the hosted-messaging order (once). Persist the order id
    // immediately so a crash after create is recoverable, never a double-order.
    const orderId = order.telnyx_hosted_order_id;
    if (!orderId) {
      // Paid-first: creating a NEW Telnyx order is a committing action and
      // waits for an active subscription (polling an EXISTING order does not).
      // Not a failure — no attempt consumed; the reconcile cron retries after
      // billing is restored.
      if (company.subscription_status !== "active") {
        return updateOrderUnlessCancelled(env, db, order.id, {
          last_error:
            "Subscription is not active; the hosted-messaging order will be created once billing is restored.",
        });
      }
      const profileId = await ensureMessagingProfile(env, db, company);
      const created = await telnyxRequest<HostedOrderResponse>(env, {
        method: "POST",
        path: "/v2/messaging_hosted_number_orders",
        body: {
          messaging_profile_id: profileId,
          phone_numbers: [order.phone_e164],
        },
      });
      const createdId = created.data?.id ?? null;
      if (!createdId) {
        throw new Error("hosted-number order create returned no id");
      }
      const createdStatus = mapHostedStatus(created.data?.status, order.status);
      order = await updateOrderUnlessCancelled(
        env,
        db,
        order.id,
        {
          telnyx_hosted_order_id: createdId,
          telnyx_hosted_number_id: created.data?.phone_numbers?.[0]?.id ?? null,
          status: createdStatus,
          // A successful pass returns the attempt budget.
          attempts: 0,
          last_error:
            createdStatus === "failed"
              ? hostedFailureError(created.data?.status)
              : null,
        },
        createdId,
      );
      // Cancelled mid-flight: the guarded write converged (fresh Telnyx order
      // deleted) — return the cancelled row untouched.
      if (order.status === "cancelled") return order;
      // S2b: documents uploaded before the order existed (an earlier create
      // failed) — attach them now the order is real (unless it is already dead).
      if (
        order.status !== "failed" &&
        order.telnyx_loa_document_id &&
        order.telnyx_bill_document_id
      ) {
        await attachHostedOrderDocuments(env, order);
      }
      // A synchronously-successful create can already be complete.
      if (order.status === "completed") {
        if (!(await activateHostedNumber(db, order))) return readOrder(db, order.id);
        return updateOrderUnlessCancelled(env, db, order.id, {
          completed_at: new Date().toISOString(),
        });
      }
      return order;
    }

    // S3: poll the existing order; complete when the carrier finishes.
    const fetched = await telnyxRequest<HostedOrderResponse>(env, {
      method: "GET",
      path: `/v2/messaging_hosted_number_orders/${orderId}`,
    });
    const rawStatus = fetched.data?.status;
    const status = mapHostedStatus(rawStatus, order.status);
    if (status === "cancelled") {
      // Telnyx reports the order 'deleted' (our cancel/release, or a portal-
      // side delete) — converge like cancel: free the slot, mark cancelled.
      await releaseHostedPhoneRow(db, order);
      return updateOrderUnlessCancelled(env, db, order.id, {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      });
    }
    // Telnyx holds an order at action-required while the LOA/bill are missing
    // or invalid (incomplete_documentation / loa_file_invalid /
    // incorrect_billing_information); when both docs are already on the row,
    // (re-)attach — self-healing for an attach that failed on an earlier pass
    // or documents the carrier bounced.
    if (
      status === "action-required" &&
      order.telnyx_loa_document_id &&
      order.telnyx_bill_document_id
    ) {
      await attachHostedOrderDocuments(env, order);
    }
    const patch: Record<string, unknown> = {
      status,
      // A successful poll resets the budget — only FAILED passes consume it.
      attempts: 0,
      // A terminal carrier failure keeps the RAW Telnyx status visible to the
      // owner; every other status clears the stale error.
      last_error: status === "failed" ? hostedFailureError(rawStatus) : null,
    };
    // Backfill the hosted-number id if the create response lacked it (needed
    // to delete the hosted number on release once the order completes).
    const polledNumberId = fetched.data?.phone_numbers?.[0]?.id ?? null;
    if (!order.telnyx_hosted_number_id && polledNumberId) {
      patch.telnyx_hosted_number_id = polledNumberId;
    }
    if (status === "completed") {
      if (!(await activateHostedNumber(db, order))) {
        // The number row left 'provisioning' out of band (released by a
        // concurrent cancel/release) — skip completion; that path owns
        // convergence of the order row.
        return readOrder(db, order.id);
      }
      patch.completed_at = new Date().toISOString();
    }
    return updateOrderUnlessCancelled(env, db, order.id, patch);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    Sentry.captureException(cause);
    const attempts = order.attempts + 1;
    const patch: Record<string, unknown> = {
      last_error: message.slice(0, 2000),
      attempts,
    };
    if (attempts >= MAX_ENABLEMENT_ATTEMPTS) {
      // The stall must be VISIBLE to the owner, not only a Sentry page: the
      // order lands 'failed' with last_error retained (resubmit resets both).
      patch.status = "failed";
      Sentry.captureMessage(
        `text-enablement exhausted ${attempts} attempts for order ${order.id}`,
        "fatal",
      );
    }
    return updateOrderUnlessCancelled(env, db, order.id, patch);
  }
}

/**
 * §11-style reconcile for hosted text-enablement orders (webhooks/polling): poll
 * every non-terminal order under the attempt budget and advance it. Idempotent;
 * safe to run on a cron. Returns a small summary.
 */
export async function reconcileTextEnablement(
  env: Env,
): Promise<{ polled: number; completed: number }> {
  const db = getDb(env);
  const summary = { polled: 0, completed: 0 };
  const { data, error } = await db
    .from("text_enablement_orders")
    .select(ORDER_COLUMNS)
    .in("status", ["pending", "action-required", "in-progress"]);
  if (error) {
    throw new Error(`text_enablement_orders lookup failed: ${error.message}`);
  }
  for (const order of (data ?? []) as unknown as TextEnablementOrderRow[]) {
    if (order.attempts >= MAX_ENABLEMENT_ATTEMPTS) continue;
    summary.polled += 1;
    const result = await resumeTextEnablement(env, order);
    if (result.status === "completed") summary.completed += 1;
  }
  return summary;
}

/**
 * Cancel a pending text-enablement order: ask Telnyx to cancel the hosted order
 * (DELETE, tolerating a 404), release the still-provisioning phone_numbers row,
 * and mark the order cancelled. Used by the abandon path; releaseNumberRow's
 * hosted branch converges the same way (same DELETE, re-issued there to avoid a
 * module cycle with provisioning.ts).
 */
export async function cancelTextEnablement(
  env: Env,
  order: TextEnablementOrderRow,
): Promise<TextEnablementOrderRow> {
  const db = getDb(env);
  if (order.telnyx_hosted_order_id) {
    await deleteHostedOrder(env, order.telnyx_hosted_order_id);
  }
  // Release the provisioning number row (never leave a dangling slot).
  await releaseHostedPhoneRow(db, order);
  return updateOrder(db, order.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
  });
}
