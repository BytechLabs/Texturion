/**
 * Keep-your-number TEXT-ENABLEMENT routes (FEATURE-GAPS voice wave, path B).
 * Text-enable an existing landline/VoIP number the owner keeps on their current
 * carrier (Telnyx hosted-messaging order) — the alternative to a full port-in
 * (path A: /v1/port-requests, D16). Mounted under /v1/text-enablements behind
 * the /v1 middleware chain. Roles per the §10 matrix: read = any member;
 * create / documents / resubmit / verification = owner/admin; cancel = owner
 * only. Stable §7 error codes only.
 *
 * Honest timelines: a hosted-SMS order is carrier-reviewed (a few business days)
 * and texting is not live until the order reaches 'completed' — the status the
 * UI surfaces plainly. Besides the LOA + bill documents, Telnyx supports a
 * number-ownership verification step (a code sent to the number by sms/call):
 * exposed as POST /:id/verification-codes (request) and
 * POST /:id/verification-codes/verify (check). No verification state is stored
 * locally — the Telnyx order is the source of truth.
 *
 * Abuse budgets (SPEC §10), two layers on the Telnyx-committing actions:
 *   - RATE: VERIFY_RATE_LIMITER, 3/min keyed on the TARGET number — the
 *     cross-order guard (a cancel-and-recreate cycle never resets it).
 *   - LIFETIME: durable per-ORDER caps consumed by an atomic guarded
 *     increment (bump_text_enablement_counter): 10 verification-code sends
 *     and 5 resubmits per order, 409 conflict once exhausted. Per order row
 *     by design — a fresh order starts a fresh budget, and the per-number
 *     rate limiter covers the cross-order angle.
 */
import { lookupAreaCode } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { PLAN_LIMITS, type PlanId } from "../billing/plans";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { uploadPortDocument } from "../telnyx/porting";
import {
  attachHostedOrderDocuments,
  cancelTextEnablement,
  deleteHostedOrder,
  requestHostedVerificationCodes,
  resumeTextEnablement,
  submitHostedVerificationCode,
  type TextEnablementOrderRow,
  ORDER_COLUMNS,
} from "../telnyx/text-enablement";
import {
  assertBodyWithinLimit,
  parseJsonBody,
  parseWith,
  pathUuid,
} from "./core/http";

export const textEnablementRoutes = new Hono<AppEnv>();

interface CompanyRow {
  id: string;
  country: "US" | "CA";
  subscription_status: string;
  plan: PlanId | null;
}

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<CompanyRow> {
  const { data, error } = await db
    .from("companies")
    .select("id,country,subscription_status,plan")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as CompanyRow | null;
  if (!row) throw new ApiError("not_found", "Company not found.");
  return row;
}

/** Vendor ids stay server-side; expose only status + the honest fields. */
function sanitize(row: TextEnablementOrderRow) {
  return {
    id: row.id,
    phone_e164: row.phone_e164,
    country: row.country,
    status: row.status,
    has_loa: row.telnyx_loa_document_id !== null,
    has_bill: row.telnyx_bill_document_id !== null,
    last_error: row.last_error,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
  };
}

async function loadOrder(
  db: SupabaseClient,
  companyId: string,
  orderId: string,
): Promise<TextEnablementOrderRow | null> {
  const { data, error } = await db
    .from("text_enablement_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .eq("company_id", companyId)
    .limit(1);
  if (error) {
    throw new Error(`text_enablement_orders lookup failed: ${error.message}`);
  }
  return (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
}

const e164Schema = z
  .string()
  .trim()
  .regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/, "must be a +1 US/CA E.164 number");

const createSchema = z.strictObject({ phone_e164: e164Schema });
const idempotencyKeySchema = z.uuid();

interface SlotResult {
  outcome:
    | "created"
    | "exists"
    | "plan_limit"
    | "sole_prop_cap"
    | "number_taken";
  number: Record<string, unknown> | null;
  order: (TextEnablementOrderRow & Record<string, unknown>) | null;
}

/** Hono's `c.executionCtx` throws when there is no runtime context; probe it. */
function executionCtxOf(
  c: Context<AppEnv>,
): Context<AppEnv>["executionCtx"] | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

/**
 * POST /v1/text-enablements — owner/admin: text-enable an existing number.
 * Gate order: role → Idempotency-Key (client UUID) → US/CA local geographic
 * number matching the company country → active subscription → atomic slot claim
 * (claim_text_enablement_slot: company lock + count-vs-plan + sole-prop cap +
 * insert phone_numbers[source=hosted] + text_enablement_orders) → start the saga
 * (create the hosted order) in the background.
 */
textEnablementRoutes.post("/", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");

  const rawKey = c.req.header("Idempotency-Key");
  const parsedKey = idempotencyKeySchema.safeParse(rawKey);
  if (!parsedKey.success) {
    return errorResponse(
      c,
      "validation_failed",
      "Idempotency-Key header (a client-generated UUID) is required.",
    );
  }
  const body = await parseJsonBody(c, createSchema);
  const company = await fetchCompany(db, companyId);

  const entry = lookupAreaCode(body.phone_e164);
  if (!entry || !entry.geographic) {
    return errorResponse(
      c,
      "validation_failed",
      "This number isn't a US or Canadian local number we can text-enable.",
    );
  }
  if (entry.country !== company.country) {
    return errorResponse(
      c,
      "validation_failed",
      `This number is a ${entry.country} number; your company is registered in ${company.country}.`,
    );
  }

  if (company.subscription_status !== "active" || company.plan === null) {
    return errorResponse(
      c,
      "subscription_inactive",
      "An active subscription is required to text-enable a number.",
    );
  }

  // Idempotent replay: same Idempotency-Key → return the existing order BEFORE
  // the dup-number conflict check (a retry must never 409 against its own row).
  const { data: existingByKey, error: keyError } = await db
    .from("text_enablement_orders")
    .select(ORDER_COLUMNS)
    .eq("company_id", companyId)
    .eq("provisioning_key", parsedKey.data)
    .limit(1);
  if (keyError) {
    throw new Error(`text_enablement_orders lookup failed: ${keyError.message}`);
  }
  if (existingByKey && existingByKey.length > 0) {
    return c.json(
      sanitize(existingByKey[0] as unknown as TextEnablementOrderRow),
      200,
    );
  }

  // No non-cancelled enablement may already exist for this number.
  const { data: existingByNumber, error: dupError } = await db
    .from("text_enablement_orders")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone_e164", body.phone_e164)
    .neq("status", "cancelled")
    .limit(1);
  if (dupError) {
    throw new Error(`text_enablement_orders lookup failed: ${dupError.message}`);
  }
  if (existingByNumber && existingByNumber.length > 0) {
    return errorResponse(
      c,
      "conflict",
      "This number already has a text-enablement in progress.",
    );
  }

  const { data: slotData, error: slotError } = await db.rpc(
    "claim_text_enablement_slot",
    {
      p_company_id: companyId,
      p_provisioning_key: parsedKey.data,
      p_phone_e164: body.phone_e164,
      p_country: entry.country,
      p_max_numbers: PLAN_LIMITS[company.plan].numbers,
    },
  );
  if (slotError) {
    throw new Error(`claim_text_enablement_slot failed: ${slotError.message}`);
  }
  const slot = parseWith(
    z.object({
      outcome: z.enum([
        "created",
        "exists",
        "plan_limit",
        "sole_prop_cap",
        "number_taken",
      ]),
      number: z.record(z.string(), z.unknown()).nullable(),
      order: z.record(z.string(), z.unknown()).nullable(),
    }),
    slotData,
  ) as SlotResult;

  if (slot.outcome === "number_taken") {
    // The phone_numbers unique index fired inside the RPC: the number is live
    // on Loonext (this company or another) — a hosted order can't take it.
    return errorResponse(
      c,
      "conflict",
      "This number is already in service on Loonext and can't be text-enabled.",
    );
  }
  if (slot.outcome === "plan_limit") {
    return errorResponse(
      c,
      "conflict",
      // #105: text-enablement doesn't buy paid-extra capacity yet (tracked on
      // #80) — the honest remedy today is releasing a number or upgrading.
      `Your plan includes ${PLAN_LIMITS[company.plan].numbers} phone number${PLAN_LIMITS[company.plan].numbers === 1 ? "" : "s"}, and enabling texting on another needs a free slot. Release a number or upgrade first.`,
    );
  }
  if (slot.outcome === "sole_prop_cap") {
    return errorResponse(
      c,
      "conflict",
      "Sole Proprietor registration allows 1 phone number.",
    );
  }
  if (!slot.order) throw new Error("claim_text_enablement_slot returned no order");

  if (slot.outcome === "exists") {
    // Idempotent replay: same Idempotency-Key → return the existing order.
    return c.json(sanitize(slot.order as TextEnablementOrderRow), 200);
  }

  // Start the saga (create the Telnyx hosted order) in the background; it never
  // throws for step failures (those land on the row for the reconcile cron), so
  // the 201 returns immediately with the order in 'pending'.
  const saga = resumeTextEnablement(env, slot.order as TextEnablementOrderRow);
  const ctx = executionCtxOf(c);
  if (ctx) ctx.waitUntil(saga.then(() => undefined));
  else await saga;

  return c.json(sanitize(slot.order as TextEnablementOrderRow), 201);
});

/** GET /v1/text-enablements — any member: list the company's enablements. */
textEnablementRoutes.get("/", async (c) => {
  const db = getDb(getEnv(c.env));
  const { data, error } = await db
    .from("text_enablement_orders")
    .select(ORDER_COLUMNS)
    .eq("company_id", c.get("companyId"))
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`text_enablement_orders lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as (TextEnablementOrderRow &
    Record<string, unknown>)[];
  return c.json({ data: rows.map(sanitize), next_cursor: null });
});

/** GET /v1/text-enablements/:id — any member: one enablement's state. */
textEnablementRoutes.get("/:id", async (c) => {
  const db = getDb(getEnv(c.env));
  const id = pathUuid(c, "id");
  const order = await loadOrder(db, c.get("companyId"), id);
  if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
  return c.json(sanitize(order));
});

// 5 MB — the Telnyx hosted-SMS per-file limit (STRICTER than porting's 10 MB;
// the file_upload action rejects larger documents, so the cap is enforced here
// before any Telnyx call).
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

// Whole-request ceiling for the documents route: two 5 MB files + generous
// multipart overhead. Checked from Content-Length BEFORE formData() buffers
// the body (SPEC §10 DoS posture).
const MAX_DOCUMENTS_BODY_BYTES = 2 * MAX_DOCUMENT_BYTES + 1024 * 1024;

/** The upload window: before the carrier review starts, or after it rejects. */
function documentsUploadable(order: TextEnablementOrderRow): boolean {
  return (
    order.status === "pending" ||
    order.status === "action-required" ||
    order.status === "failed"
  );
}

/**
 * PUT /v1/text-enablements/:id/documents — owner/admin: upload the signed LOA
 * and/or recent phone bill (multipart `loa` / `bill` file parts, at least one).
 * Mirrors the porting documents route (paid-first gate, upload to Telnyx
 * `POST /v2/documents` via the same helper, UUIDs stored on the order row) but
 * with the hosted-SMS 5 MB per-file cap.
 * PDF ONLY — stricter than porting, because the hosted-messaging file_upload
 * action both files feed is PDF-only. Once BOTH documents are on the row they
 * are attached to the hosted order (POST /v2/messaging_hosted_number_orders/
 * {id}/actions/file_upload — the hosted API takes files, not document ids);
 * when the hosted order does not exist yet (a failed create), the saga
 * attaches them on its next pass instead.
 */
textEnablementRoutes.put("/:id/documents", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const order = await loadOrder(db, companyId, id);
  if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
  if (!documentsUploadable(order)) {
    return errorResponse(
      c,
      "conflict",
      `This text-enablement is ${order.status}; documents can no longer be uploaded.`,
    );
  }
  // Paid-first (mirrors the porting documents route): the upload is a
  // Telnyx-committing action and must wait for an active subscription.
  const company = await fetchCompany(db, companyId);
  if (company.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "Documents can be uploaded once your subscription is active.",
    );
  }

  // Declared-size gate BEFORE formData() buffers the whole body (§10).
  assertBodyWithinLimit(c, MAX_DOCUMENTS_BODY_BYTES);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return errorResponse(
      c,
      "validation_failed",
      "Expected multipart/form-data with loa and/or bill file parts.",
    );
  }

  const patch: Record<string, unknown> = {};
  for (const field of ["loa", "bill"] as const) {
    const raw: unknown = form.get(field);
    if (raw === null || raw === undefined) continue;
    // A file part is a Blob/File (arrayBuffer + size + type); a plain text
    // field is a string. Duck-type rather than `instanceof File` (not a global
    // type in the Workers tsconfig, and FormDataEntryValue there is `string`).
    const file = raw as {
      arrayBuffer?: () => Promise<ArrayBuffer>;
      size?: number;
      type?: string;
      name?: string;
    };
    if (typeof raw === "string" || typeof file.arrayBuffer !== "function") {
      return errorResponse(
        c,
        "validation_failed",
        `${field} must be a file upload.`,
      );
    }
    const size = file.size ?? 0;
    if (size === 0 || size > MAX_DOCUMENT_BYTES) {
      return errorResponse(
        c,
        "validation_failed",
        `${field} must be a non-empty file under 5 MB (the carrier's hosted-SMS file limit).`,
      );
    }
    const contentType = file.type || "application/pdf";
    if (contentType !== "application/pdf") {
      return errorResponse(
        c,
        "validation_failed",
        `${field} must be a PDF (the carrier accepts only PDF for hosted-SMS documents).`,
      );
    }
    const bytes = await file.arrayBuffer();
    // Same Documents-API machinery as porting; the bill is Telnyx's 'invoice'.
    const documentId = await uploadPortDocument(
      env,
      {
        file: bytes,
        filename: file.name || `${field}.pdf`,
        contentType,
      },
      field === "loa" ? "loa" : "invoice",
    );
    patch[
      field === "loa" ? "telnyx_loa_document_id" : "telnyx_bill_document_id"
    ] = documentId;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(
      c,
      "validation_failed",
      "Provide a loa and/or bill file part.",
    );
  }

  const { data, error } = await db
    .from("text_enablement_orders")
    .update(patch)
    .eq("id", id)
    .eq("company_id", companyId)
    .select(ORDER_COLUMNS);
  if (error) {
    throw new Error(`text_enablement_orders update failed: ${error.message}`);
  }
  const updated = (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
  if (!updated) return errorResponse(c, "not_found", "No such text-enablement.");

  if (
    updated.telnyx_loa_document_id &&
    updated.telnyx_bill_document_id &&
    updated.telnyx_hosted_order_id
  ) {
    // Document ids are already persisted above, so a failure here (a 500)
    // loses nothing: a re-upload retries, and the saga re-attaches on any
    // action-required poll.
    await attachHostedOrderDocuments(env, updated);
  }
  return c.json(sanitize(updated));
});

/**
 * POST /v1/text-enablements/:id/resubmit — owner/admin: try again after a
 * stall. Allowed from 'failed' (attempt budget exhausted or carrier-rejected)
 * or 'action-required' (documents fixed): clears last_error, returns the
 * attempt budget (attempts=0), moves the row back to 'pending' so the §11
 * reconcile cron polls it again, and re-runs the saga in the background.
 * A 'failed' order whose Telnyx hosted order exists is DEAD on the vendor side
 * (carrier_rejected et al. are terminal — Telnyx never re-reviews them), so
 * resubmit deletes it (404-tolerated) and clears the vendor ids: the saga's
 * create branch then makes a FRESH hosted order and re-attaches the
 * already-uploaded LOA/bill. Paid-first: resubmit is a Telnyx-committing
 * action → 402 while the subscription is not active. 409 conflict from any
 * status other than failed/action-required.
 * Lifetime budget (§10): each resubmit consumes one unit of the order's
 * durable resubmit_count (MAX_RESUBMITS; 409 conflict once spent). The cap is
 * intentionally NOT `attempts` — that is the saga's poll budget, which
 * resubmit resets; reusing it would let every resubmit refill the cap.
 * Consumed BEFORE any Telnyx side effect (fail-closed).
 */
textEnablementRoutes.post("/:id/resubmit", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const order = await loadOrder(db, companyId, id);
  if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
  if (order.status !== "failed" && order.status !== "action-required") {
    return errorResponse(
      c,
      "conflict",
      `Only a failed or action-required text-enablement can be resubmitted (this one is ${order.status}).`,
    );
  }
  const company = await fetchCompany(db, companyId);
  if (company.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "An active subscription is required to resubmit a text-enablement.",
    );
  }
  const withinCap = await consumeOrderBudget(
    db,
    order,
    "resubmit_count",
    MAX_RESUBMITS,
  );
  if (!withinCap) {
    return errorResponse(
      c,
      "conflict",
      "This order has been resubmitted too many times — cancel it and start again, or contact support.",
    );
  }

  const reset: Record<string, unknown> = {
    last_error: null,
    attempts: 0,
    status: "pending",
  };
  if (order.status === "failed" && order.telnyx_hosted_order_id) {
    // The dead order can't be revived — remove it on Telnyx and detach it so
    // resumeTextEnablement's create branch starts a fresh one. Null the
    // idempotency key too, so the fresh create mints a FRESH key rather than
    // replaying the just-deleted order (§4.3 backstop).
    await deleteHostedOrder(env, order.telnyx_hosted_order_id);
    reset.telnyx_hosted_order_id = null;
    reset.telnyx_hosted_number_id = null;
    reset.telnyx_order_idempotency_key = null;
  }

  const { data, error } = await db
    .from("text_enablement_orders")
    .update(reset)
    .eq("id", id)
    .eq("company_id", companyId)
    // Double-click lock: a losing concurrent resubmit finds the row already
    // flipped off its expected status and matches 0 rows (the saga lease is the
    // primary double-order guard; this just stops a second saga launch).
    .eq("status", order.status)
    .select(ORDER_COLUMNS);
  if (error) {
    throw new Error(`text_enablement_orders update failed: ${error.message}`);
  }
  const resetRow = (data?.[0] ?? null) as unknown as TextEnablementOrderRow | null;
  if (!resetRow) return errorResponse(c, "not_found", "No such text-enablement.");

  // Same background pattern as create: the saga never throws for step
  // failures (they land on the row for the reconcile cron).
  const saga = resumeTextEnablement(env, resetRow);
  const ctx = executionCtxOf(c);
  if (ctx) ctx.waitUntil(saga.then(() => undefined));
  else await saga;

  return c.json(sanitize(resetRow));
});

const verificationRequestSchema = z.strictObject({
  verification_method: z.enum(["sms", "call"]),
});
const verificationSubmitSchema = z.strictObject({
  code: z.string().trim().min(1).max(16),
});

/** Lifetime cap on ownership-verification code sends per order (§10). */
export const MAX_VERIFICATION_REQUESTS = 10;
/** Lifetime cap on resubmits per order (§10). */
export const MAX_RESUBMITS = 5;

/**
 * Atomically consume one unit of a per-order lifetime budget
 * (bump_text_enablement_counter: a single guarded
 * `UPDATE ... SET counter = counter + 1 WHERE ... AND counter < cap RETURNING`
 * — a read-check-increment here would race two concurrent requests past the
 * cap). Returns false when the budget is exhausted (0 rows updated). The caps
 * are PER ORDER ROW: a cancel/recreate mints a fresh budget on purpose, and
 * the per-NUMBER rate limiter is the cross-order guard.
 */
async function consumeOrderBudget(
  db: SupabaseClient,
  order: TextEnablementOrderRow,
  counter: "verification_requests" | "resubmit_count",
  cap: number,
): Promise<boolean> {
  const { data, error } = await db.rpc("bump_text_enablement_counter", {
    p_order_id: order.id,
    p_company_id: order.company_id,
    p_counter: counter,
    p_cap: cap,
  });
  if (error) {
    throw new Error(`bump_text_enablement_counter failed: ${error.message}`);
  }
  return parseWith(z.object({ allowed: z.boolean() }), data).allowed;
}

/**
 * Per-number bound on the ownership-verification endpoints (SPEC §10 DoS
 * posture). Requesting a code makes Telnyx SMS or CALL the order's number — a
 * number the company has NOT yet proven it owns — and the verify endpoint
 * accepts code guesses, so without a bound these are a call/SMS-bombing and
 * code-brute-force primitive against an arbitrary victim landline. The limiter
 * (VERIFY_RATE_LIMITER, 3/min) is keyed on the TARGET number with a
 * per-endpoint prefix, never the order id, so a cancel-and-recreate cycle can
 * never reset the budget. Absent binding (local dev/tests) → gate skipped,
 * exactly like SEND_RATE_LIMITER at the dispatch choke point. The limiter
 * bounds the RATE only; the durable per-order lifetime cap
 * (consumeOrderBudget + MAX_VERIFICATION_REQUESTS) bounds the total.
 */
async function verificationRateLimit(
  c: Context<AppEnv>,
  env: Env,
  action: "send" | "check",
  phoneE164: string,
): Promise<Response | null> {
  if (!env.VERIFY_RATE_LIMITER) return null;
  const { success } = await env.VERIFY_RATE_LIMITER.limit({
    key: `te-verify-${action}:${phoneE164}`,
  });
  if (success) return null;
  return errorResponse(
    c,
    "rate_limited",
    action === "send"
      ? "Too many verification codes requested for this number. Wait a minute and try again."
      : "Too many code attempts. Wait a minute and try again.",
  );
}

/** Verification needs a live Telnyx order that is still under review. */
function verificationGate(
  c: Context<AppEnv>,
  order: TextEnablementOrderRow,
): Response | null {
  if (!order.telnyx_hosted_order_id) {
    return errorResponse(
      c,
      "conflict",
      "The hosted-messaging order hasn't been created yet; verification isn't available until it exists.",
    );
  }
  if (
    order.status !== "pending" &&
    order.status !== "action-required" &&
    order.status !== "in-progress"
  ) {
    return errorResponse(
      c,
      "conflict",
      `This text-enablement is ${order.status}; ownership verification no longer applies.`,
    );
  }
  return null;
}

/**
 * POST /v1/text-enablements/:id/verification-codes — owner/admin: ask Telnyx
 * to send a number-ownership verification code to the number (by 'sms' or a
 * voice 'call' — the owner still controls the line on their current carrier).
 * Spec-verified vendor endpoint:
 * POST /v2/messaging_hosted_number_orders/{id}/verification_codes. Nothing
 * verification-side is stored locally — the Telnyx order is the source of
 * truth — but each send consumes one unit of the order's durable lifetime
 * budget (MAX_VERIFICATION_REQUESTS; 409 conflict once spent). The budget is
 * consumed AFTER the rate limiter (a rate-limited request never burns it) and
 * BEFORE the Telnyx call (fail-closed: a Telnyx failure still counts).
 */
textEnablementRoutes.post(
  "/:id/verification-codes",
  requireRole("admin"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, verificationRequestSchema);
    const order = await loadOrder(db, c.get("companyId"), id);
    if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
    const gate = verificationGate(c, order);
    if (gate) return gate;
    const limited = await verificationRateLimit(c, env, "send", order.phone_e164);
    if (limited) return limited;
    const withinCap = await consumeOrderBudget(
      db,
      order,
      "verification_requests",
      MAX_VERIFICATION_REQUESTS,
    );
    if (!withinCap) {
      return errorResponse(
        c,
        "conflict",
        "Too many verification attempts for this order — cancel it and start again, or contact support.",
      );
    }

    const { error } = await requestHostedVerificationCodes(
      env,
      order,
      body.verification_method,
    );
    if (error) {
      // Telnyx could not deliver a code this way (e.g. a landline can't
      // receive SMS) — surface it so the owner can try the other method.
      return errorResponse(
        c,
        "validation_failed",
        `The verification code couldn't be sent by ${body.verification_method}: ${error}`,
      );
    }
    return c.json({
      requested: true,
      verification_method: body.verification_method,
    });
  },
);

/**
 * POST /v1/text-enablements/:id/verification-codes/verify — owner/admin:
 * submit the code the owner received on the number. Spec-verified vendor
 * endpoint: POST /v2/messaging_hosted_number_orders/{id}/validation_codes.
 * 'verified' / 'already_verified' → 200; 'rejected' → 422.
 */
textEnablementRoutes.post(
  "/:id/verification-codes/verify",
  requireRole("admin"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, verificationSubmitSchema);
    const order = await loadOrder(db, c.get("companyId"), id);
    if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
    const gate = verificationGate(c, order);
    if (gate) return gate;
    const limited = await verificationRateLimit(
      c,
      env,
      "check",
      order.phone_e164,
    );
    if (limited) return limited;

    const outcome = await submitHostedVerificationCode(env, order, body.code);
    if (outcome === "rejected") {
      return errorResponse(
        c,
        "validation_failed",
        "That code didn't match. Request a new code and try again.",
      );
    }
    return c.json({ verified: true });
  },
);

/**
 * POST /v1/text-enablements/:id/cancel — owner only: abandon a pending
 * enablement. 409 conflict if already completed/cancelled.
 */
textEnablementRoutes.post("/:id/cancel", requireRole("owner"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const order = await loadOrder(db, c.get("companyId"), id);
  if (!order) return errorResponse(c, "not_found", "No such text-enablement.");
  if (order.status === "completed" || order.status === "cancelled") {
    return errorResponse(
      c,
      "conflict",
      `This text-enablement is ${order.status} and can no longer be cancelled.`,
    );
  }
  const updated = await cancelTextEnablement(env, order);
  return c.json(sanitize(updated));
});
