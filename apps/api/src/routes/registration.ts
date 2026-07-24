import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import {
  owesUsRegistration,
  registrationDraftComplete,
  type RegistrationRow as DraftGateRow,
} from "../billing/registration-draft";
import { idempotencyKey } from "../billing/idempotency";
import { getStripe } from "../billing/stripe";
import type { AppEnv, MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { parseJsonBody, parseWith } from "./core/http";
import { TelnyxApiError } from "../telnyx/client";
import {
  fetchRegistrationRows,
  refreshBrandFromRemote,
  submitRegistration,
  triggerBrandOtp,
  verifyBrandOtp,
  type RegistrationRow,
} from "../telnyx/registration";
import {
  brandDraftSchema,
  campaignDraftSchema,
  isSoleProprietorDraft,
} from "../telnyx/wizard";

/**
 * Registration routes (SPEC §7 route table, §4.2, §4.4). Mounted by the
 * integration layer under `/v1/registration`, behind the /v1 middleware chain
 * (JWT + company context). Roles per the §10 matrix: read = any member;
 * wizard writes/submission/OTP = owner or admin; enable-us = owner only.
 */
export const registrationRoutes = new Hono<AppEnv>();

interface RegistrationCompanyRow {
  id: string;
  name: string;
  country: string;
  us_texting_enabled: boolean;
  subscription_status: string;
  stripe_customer_id: string | null;
  registration_fee_paid_at: string | null;
}

async function fetchCompanyRow(
  db: SupabaseClient,
  companyId: string,
): Promise<RegistrationCompanyRow> {
  const { data, error } = await db
    .from("companies")
    .select(
      "id,name,country,us_texting_enabled,subscription_status," +
        "stripe_customer_id,registration_fee_paid_at",
    )
    .eq("id", companyId)
    // Match usage.ts + the billing jobs: a soft-deleted company is not_found
    // here rather than an actionable registration/billing target.
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as RegistrationCompanyRow | null;
  if (!row) throw new ApiError("not_found", "Company not found.");
  return row;
}

/**
 * SPEC §7: GET returns "brand + campaign rows (status, rejection_reason,
 * timestamps)". The wizard `data` (which carries the full EIN/BN — SPEC §10)
 * is included only for owner/admin, who edit the wizard.
 */
function sanitizeRow(
  row: RegistrationRow | null,
  role: MemberRole,
): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sole_proprietor: row.sole_proprietor,
    rejection_reason: row.rejection_reason,
    submission_count: row.submission_count,
    submitted_at: row.submitted_at,
    approved_at: row.approved_at,
    rejected_at: row.rejected_at,
    deactivated_at: row.deactivated_at,
    ...(role === "owner" || role === "admin" ? { data: row.data } : {}),
  };
}

async function registrationResponse(
  db: SupabaseClient,
  companyId: string,
  role: MemberRole,
): Promise<Record<string, unknown>> {
  const { brand, campaign } = await fetchRegistrationRows(db, companyId);
  return {
    brand: sanitizeRow(brand, role),
    campaign: sanitizeRow(campaign, role),
  };
}

/** GET /v1/registration — any member. */
registrationRoutes.get("/", async (c) => {
  const db = getDb(getEnv(c.env));
  return c.json(
    await registrationResponse(db, c.get("companyId"), c.get("role")),
  );
});

const wizardBodySchema = z
  .strictObject({
    brand: brandDraftSchema.optional(),
    campaign: campaignDraftSchema.optional(),
  })
  .refine((body) => body.brand !== undefined || body.campaign !== undefined, {
    message: "Provide brand and/or campaign wizard data.",
  });

/**
 * Editable statuses: `draft` (pre-submission) and `rejected` (fix-and-
 * resubmit, §4.4 R4). Submitted/pending/approved rows are immutable from the
 * wizard — 409.
 */
function assertEditable(row: RegistrationRow | null, what: string): void {
  if (row && row.status !== "draft" && row.status !== "rejected") {
    throw new ApiError(
      "conflict",
      `The ${what} registration is ${row.status} and can no longer be edited.`,
    );
  }
}

async function upsertDraftRow(
  db: SupabaseClient,
  companyId: string,
  kind: "brand" | "campaign",
  existing: RegistrationRow | null,
  data: Record<string, unknown>,
  soleProprietor: boolean,
): Promise<void> {
  if (existing) {
    const { error } = await db
      .from("messaging_registrations")
      .update({ data, sole_proprietor: soleProprietor })
      .eq("id", existing.id);
    if (error) throw new Error(`wizard update failed: ${error.message}`);
    return;
  }
  const { error } = await db.from("messaging_registrations").upsert(
    {
      company_id: companyId,
      kind,
      status: "draft",
      data,
      sole_proprietor: soleProprietor,
    },
    { onConflict: "company_id,kind", ignoreDuplicates: true },
  );
  if (error) throw new Error(`wizard insert failed: ${error.message}`);
}

/** PUT /v1/registration — owner/admin: draft upsert (§4.1 step 3, §7). */
registrationRoutes.put("/", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const body = await parseJsonBody(c, wizardBodySchema);

  const { brand, campaign } = await fetchRegistrationRows(db, companyId);

  // Resolve the sole-prop flag from the freshest brand data available: the
  // §4.2 cap and the campaign usecase both key on it.
  const soleProprietor = body.brand
    ? isSoleProprietorDraft(body.brand)
    : (brand?.sole_proprietor ?? false);

  if (body.brand) {
    assertEditable(brand, "brand");
    await upsertDraftRow(db, companyId, "brand", brand, body.brand, soleProprietor);
  }
  if (body.campaign) {
    assertEditable(campaign, "campaign");
    await upsertDraftRow(
      db,
      companyId,
      "campaign",
      campaign,
      body.campaign,
      soleProprietor,
    );
  }

  return c.json(await registrationResponse(db, companyId, c.get("role")));
});

/**
 * POST /v1/registration/submit — owner/admin (§7): first-submission recovery
 * and rejected-resubmit. The normal first submission rides the paid-checkout
 * webhook (§4.1 step 5); this route exists for the recovery/fix paths and is
 * gated on the fee having been paid (§4.2).
 */
registrationRoutes.post("/submit", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const company = await fetchCompanyRow(db, companyId);

  if (!owesUsRegistration(company)) {
    return errorResponse(
      c,
      "conflict",
      "US registration is not required for this company. Canadian companies enable it via POST /v1/registration/enable-us.",
    );
  }
  if (company.registration_fee_paid_at === null) {
    return errorResponse(
      c,
      "conflict",
      "The US registration fee has not been paid yet — complete checkout first.",
    );
  }

  const result = await submitRegistration(env, companyId);
  if (result.action === "noop") {
    return errorResponse(c, "conflict", result.reason);
  }
  return c.json({
    action: result.action,
    ...(await registrationResponse(db, companyId, c.get("role"))),
  });
});

const otpBodySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "must be the 6-digit code"),
});

async function requireSolePropBrand(
  db: SupabaseClient,
  companyId: string,
): Promise<RegistrationRow> {
  const { brand } = await fetchRegistrationRows(db, companyId);
  if (!brand || !brand.sole_proprietor || !brand.telnyx_id) {
    throw new ApiError(
      "conflict",
      "No submitted Sole Proprietor brand to verify.",
    );
  }
  if (brand.status === "approved") {
    throw new ApiError("conflict", "This brand is already verified.");
  }
  return brand;
}

/** POST /v1/registration/otp { code } — owner/admin (§4.2, §7). */
registrationRoutes.post("/otp", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const { code } = await parseJsonBody(c, otpBodySchema);
  const brand = await requireSolePropBrand(db, companyId);

  try {
    await verifyBrandOtp(env, brand.telnyx_id as string, code);
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) {
      // Wrong or expired PIN (§7: 422 validation_failed).
      return errorResponse(
        c,
        "validation_failed",
        "That code is wrong or has expired. Request a new one and try again.",
      );
    }
    throw cause;
  }

  // Verification flips the brand to VERIFIED on the Telnyx side; pull that
  // truth in now so the dashboard unblocks immediately (webhook + daily poll
  // remain the durable fallbacks).
  try {
    await refreshBrandFromRemote(env, brand);
  } catch (cause) {
    Sentry.captureException(cause);
  }

  return c.json(await registrationResponse(db, companyId, c.get("role")));
});

/**
 * #38 lifetime resend ceiling per brand row. Each resend is a Telnyx-committing
 * SMS PIN delivery to the registered sole-prop mobile — the same class of
 * action the text-enablement track caps at 10 sends per order. Consumed via
 * bump_registration_otp_counter (guarded UPDATE ... RETURNING, race-safe)
 * AFTER the rate limiter (a 429'd request never burns budget) and BEFORE the
 * Telnyx call (fail-closed: a Telnyx failure still counts).
 */
const MAX_OTP_RESENDS = 10;

/**
 * POST /v1/registration/otp/resend — owner/admin: fresh PIN, new 24h window.
 * Bounded twice (#38, mirroring the text-enablement verification posture):
 * VERIFY_RATE_LIMITER (3/60s) keyed on the OTP TARGET mobile bounds the rate
 * — a wizard edit changing the number can never reset it faster than the
 * window — and the durable per-brand lifetime counter bounds the total.
 */
registrationRoutes.post("/otp/resend", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const brand = await requireSolePropBrand(db, companyId);

  // RATE: reuse the VERIFY_RATE_LIMITER binding (absent in local dev/tests →
  // gate skipped, exactly like the text-enablement call sites). Keyed on the
  // sole-prop mobile the PIN is delivered to; brand row id as the backstop
  // key when the draft somehow lacks one.
  if (env.VERIFY_RATE_LIMITER) {
    const mobile = brand.data.mobilePhone;
    const target =
      typeof mobile === "string" && mobile.length > 0 ? mobile : brand.id;
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `brand-otp-resend:${target}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many verification codes requested. Wait a minute and try again.",
      );
    }
  }

  // LIFETIME: one unit of the brand row's durable resend budget, spent before
  // Telnyx is called.
  const { data: budget, error: budgetError } = await db.rpc(
    "bump_registration_otp_counter",
    {
      p_registration_id: brand.id,
      p_company_id: companyId,
      p_cap: MAX_OTP_RESENDS,
    },
  );
  if (budgetError) {
    throw new Error(
      `bump_registration_otp_counter failed: ${budgetError.message}`,
    );
  }
  const allowed = parseWith(z.object({ allowed: z.boolean() }), budget).allowed;
  if (!allowed) {
    return errorResponse(
      c,
      "conflict",
      "This brand has reached its verification-code limit. Contact support to finish verification.",
    );
  }

  try {
    await triggerBrandOtp(env, brand.telnyx_id as string);
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) {
      return errorResponse(
        c,
        "conflict",
        "Telnyx declined to resend the code for this brand.",
      );
    }
    throw cause;
  }
  return c.json({ ok: true });
});

/**
 * POST /v1/registration/enable-us — owner only (§4.2, §7, §10): CA companies
 * turning on US texting later. Requires a complete wizard draft (mirrors the
 * checkout gate). Creates the one-off $29 invoice with metadata
 * `{ purpose: 'us_registration', company_id }`, auto-charged to the default
 * payment method; the §9 `invoice.paid` handler stamps the fee and the
 * registration submission follows (R1). A company whose fee was already paid
 * (§2: charged at most once, ever) submits immediately with no new invoice.
 */
registrationRoutes.post("/enable-us", requireRole("owner"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const company = await fetchCompanyRow(db, companyId);

  if (company.country !== "CA") {
    return errorResponse(
      c,
      "conflict",
      "US companies are registered automatically — enable-us is for Canadian companies.",
    );
  }
  if (company.us_texting_enabled) {
    return errorResponse(c, "conflict", "US texting is already enabled.");
  }
  if (!company.stripe_customer_id) {
    return errorResponse(
      c,
      "conflict",
      "Complete checkout before enabling US texting.",
    );
  }

  const { brand, campaign } = await fetchRegistrationRows(db, companyId);
  const gateRows: DraftGateRow[] = [brand, campaign].filter(
    (row): row is RegistrationRow => row !== null,
  );
  if (!registrationDraftComplete(gateRows)) {
    return errorResponse(
      c,
      "conflict",
      "Complete the registration wizard before enabling US texting.",
    );
  }

  const { error: enableError } = await db
    .from("companies")
    .update({ us_texting_enabled: true })
    .eq("id", companyId);
  if (enableError) {
    throw new Error(`us_texting_enabled update failed: ${enableError.message}`);
  }

  // §2: the fee is charged at most once per company, ever. Already paid
  // (e.g. canceled + resubscribed) → submit right away, no invoice.
  if (company.registration_fee_paid_at !== null) {
    const result = await submitRegistration(env, companyId);
    return c.json({
      us_texting_enabled: true,
      invoice_id: null,
      action: result.action,
    });
  }

  // §2 double-charge fail-safe: claim the fee charge atomically BEFORE invoicing.
  // registration_fee_paid_at is stamped only LATER, by the async invoice.paid
  // webhook — so two concurrent enable-us calls both saw it null and each
  // finalized a $29 invoice. This start-marker (set only when the fee is neither
  // in-flight nor paid) lets exactly ONE request create the invoice; the marker
  // is cleared on invoice.payment_failed (webhooks/stripe.ts) so a genuine retry
  // after a decline is never blocked.
  const { data: claimed, error: claimError } = await db
    .from("companies")
    .update({ registration_fee_charge_started_at: new Date().toISOString() })
    .eq("id", companyId)
    .is("registration_fee_charge_started_at", null)
    .is("registration_fee_paid_at", null)
    .select("id");
  if (claimError) {
    throw new Error(`registration fee claim failed: ${claimError.message}`);
  }
  if (!claimed || claimed.length === 0) {
    // Another request already started (or completed) the $29 charge — never
    // invoice twice. It resolves via that request's invoice + the invoice.paid
    // webhook (which submits the §4.4 registration).
    return c.json({
      us_texting_enabled: true,
      invoice_id: null,
      action: "charge_in_progress",
    });
  }

  const stripe = getStripe(env);
  // Stable keys (backstop): if this request crashes between the claim and the
  // POSTs and is retried, Stripe replays the same invoice instead of a second.
  const feeKey = idempotencyKey(companyId, "us_registration_fee");
  try {
    const invoice = await stripe.invoices.create(
      {
        customer: company.stripe_customer_id,
        collection_method: "charge_automatically",
        auto_advance: true,
        metadata: { purpose: "us_registration", company_id: companyId },
      },
      { idempotencyKey: feeKey },
    );
    if (!invoice.id) throw new Error("Stripe invoice create returned no id");
    await stripe.invoiceItems.create(
      {
        customer: company.stripe_customer_id,
        invoice: invoice.id,
        pricing: { price: env.STRIPE_US_FEE_PRICE_ID },
      },
      { idempotencyKey: `${feeKey}:item` },
    );
    // Finalize now → Stripe attempts the default payment method immediately;
    // `invoice.paid` (§9) stamps the fee and triggers the §4.4 R1 submission.
    await stripe.invoices.finalizeInvoice(invoice.id, undefined, {
      idempotencyKey: `${feeKey}:finalize`,
    });

    return c.json({
      us_texting_enabled: true,
      invoice_id: invoice.id,
      action: "invoice_created",
    });
  } catch (invoiceError) {
    // The charge never got off the ground — roll back the start-marker so the
    // owner can retry (otherwise a failed create would wedge enable-us forever).
    const { error: rollbackError } = await db
      .from("companies")
      .update({ registration_fee_charge_started_at: null })
      .eq("id", companyId)
      .is("registration_fee_paid_at", null);
    if (rollbackError) Sentry.captureException(rollbackError);
    throw invoiceError;
  }
});
