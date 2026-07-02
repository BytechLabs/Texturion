import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest, TelnyxApiError } from "./client";
import {
  otpNudgeCopy,
  registrationRejectedCopy,
  usTextingLiveCopy,
} from "./emails";
import {
  brandDraftSchema,
  buildBrandPayload,
  buildCampaignPayload,
  campaignDraftSchema,
  isSoleProprietorDraft,
  type BrandDraft,
  type CampaignDraft,
} from "./wizard";
import { billingRecipients } from "../billing/recipients";
import { owesUsRegistration } from "../billing/registration-draft";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * The §4.4 10DLC registration state machine.
 *
 * `messaging_registrations`: one brand row + one campaign row per company,
 * statuses `draft → submitted → pending → approved | rejected` (rejected →
 * edit → submitted again). Transitions are driven by Telnyx `10dlc.*`
 * webhooks (primary) and {@link pollRegistrations} (daily authoritative
 * fallback, D2). Telnyx calls follow the SPEC §4.4 10DLC API contract table
 * verbatim.
 */

export type RegistrationKind = "brand" | "campaign";
export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "approved"
  | "rejected";

export interface RegistrationRow {
  id: string;
  company_id: string;
  kind: RegistrationKind;
  status: RegistrationStatus;
  sole_proprietor: boolean;
  telnyx_id: string | null;
  data: Record<string, unknown>;
  rejection_reason: string | null;
  submission_count: number;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  deactivated_at: string | null;
  otp_nudged_at: string | null;
}

interface RegistrationCompany {
  id: string;
  name: string;
  country: string;
  us_texting_enabled: boolean;
  subscription_status: string;
}

const ROW_COLUMNS =
  "id,company_id,kind,status,sole_proprietor,telnyx_id,data,rejection_reason," +
  "submission_count,submitted_at,approved_at,rejected_at,deactivated_at,otp_nudged_at";

const COMPANY_COLUMNS =
  "id,name,country,us_texting_enabled,subscription_status";

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<RegistrationCompany> {
  const { data, error } = await db
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const company = (data?.[0] ?? null) as unknown as RegistrationCompany | null;
  if (!company) throw new Error(`registration: company ${companyId} not found`);
  return company;
}

export async function fetchRegistrationRows(
  db: SupabaseClient,
  companyId: string,
): Promise<{ brand: RegistrationRow | null; campaign: RegistrationRow | null }> {
  const { data, error } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("company_id", companyId);
  if (error) {
    throw new Error(`messaging_registrations lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as RegistrationRow[];
  return {
    brand: rows.find((row) => row.kind === "brand") ?? null,
    campaign: rows.find((row) => row.kind === "campaign") ?? null,
  };
}

async function findRowByTelnyxId(
  db: SupabaseClient,
  kind: RegistrationKind,
  telnyxId: string,
): Promise<RegistrationRow | null> {
  const { data, error } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("kind", kind)
    .eq("telnyx_id", telnyxId)
    .limit(1);
  if (error) {
    throw new Error(`messaging_registrations lookup failed: ${error.message}`);
  }
  return (data?.[0] ?? null) as unknown as RegistrationRow | null;
}

async function updateRow(
  db: SupabaseClient,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<RegistrationRow> {
  const { data, error } = await db
    .from("messaging_registrations")
    .update(patch)
    .eq("id", rowId)
    .select(ROW_COLUMNS);
  if (error) {
    throw new Error(`messaging_registrations update failed: ${error.message}`);
  }
  const row = (data?.[0] ?? null) as unknown as RegistrationRow | null;
  if (!row) throw new Error(`messaging_registrations row ${rowId} vanished`);
  return row;
}

// ---------------------------------------------------------------------------
// Telnyx 10DLC response/payload helpers
// ---------------------------------------------------------------------------

/**
 * Telnyx's 10DLC endpoints have historically answered both `{ data: {...} }`
 * envelopes and bare TCR objects; unwrap defensively so either shape works.
 */
function unwrapTendlc(response: unknown): Record<string, unknown> {
  if (response !== null && typeof response === "object" && "data" in response) {
    const inner = (response as { data?: unknown }).data;
    if (inner !== null && typeof inner === "object") {
      return inner as Record<string, unknown>;
    }
  }
  return (response ?? {}) as Record<string, unknown>;
}

/** Flatten TCR `reasons`/`failureReasons` (strings or {description} objects). */
function formatReasons(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item !== null && typeof item === "object") {
          const description = (item as { description?: unknown }).description;
          if (typeof description === "string") return description;
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

type MappedTransition = {
  next: Extract<RegistrationStatus, "pending" | "approved" | "rejected">;
  reason?: string;
};

/**
 * Brand state mapping (§4.4 webhook table + poller): applies to both the
 * `10dlc.brand.update` payload and the `GET /v2/10dlc/brand/{brandId}` body —
 * the same fields carry the state in both.
 *
 *  - `identityStatus` VERIFIED / VETTED_VERIFIED → approved (sole-prop OTP
 *    completion IS `identityStatus='VERIFIED'`)
 *  - explicit failure (`status` FAILED / REGISTRATION_FAILED, or
 *    `identityStatus` UNVERIFIED — the brand cannot run campaigns) → rejected
 *  - anything else (in review) → pending
 */
function mapBrandState(payload: Record<string, unknown>): MappedTransition {
  const identityStatus =
    typeof payload.identityStatus === "string" ? payload.identityStatus : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const reasons =
    formatReasons(payload.reasons) ?? formatReasons(payload.failureReasons);

  if (identityStatus === "VERIFIED" || identityStatus === "VETTED_VERIFIED") {
    return { next: "approved" };
  }
  if (status === "FAILED" || status === "REGISTRATION_FAILED") {
    return {
      next: "rejected",
      reason: reasons ?? "Brand registration failed carrier review.",
    };
  }
  if (identityStatus === "UNVERIFIED") {
    return {
      next: "rejected",
      reason:
        reasons ??
        "Identity verification failed — check that the legal business name and EIN/BN match your registration documents.",
    };
  }
  return { next: "pending" };
}

/**
 * Campaign mapping for `10dlc.campaign.update` events (§4.4 webhook table):
 * `type` TELNYX_REVIEW / MNO_REVIEW → pending; `status=ACCEPTED` after MNO
 * review → approved; `status=REJECTED` → rejected. Event types outside the
 * review pipeline (NUMBER_POOL_*, TCR_EVENT, …) map to no transition.
 */
function mapCampaignEvent(
  payload: Record<string, unknown>,
): MappedTransition | null {
  const type = typeof payload.type === "string" ? payload.type : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const reasons =
    formatReasons(payload.reasons) ?? formatReasons(payload.description);

  if (status === "REJECTED") {
    return {
      next: "rejected",
      reason: reasons ?? "Campaign was rejected by carrier review.",
    };
  }
  if (type === "MNO_REVIEW" && status === "ACCEPTED") {
    return { next: "approved" };
  }
  if (type === "REGISTRATION" || type === "TELNYX_REVIEW" || type === "MNO_REVIEW") {
    return { next: "pending" };
  }
  return null;
}

/**
 * Campaign mapping for the daily poll of `GET /v2/10dlc/campaign/{campaignId}`
 * (documented fields: `campaignStatus` TCR_* / TELNYX_* / MNO_*, lifecycle
 * `status` ACTIVE/EXPIRED, `failureReasons`).
 */
function mapCampaignRemote(payload: Record<string, unknown>): MappedTransition {
  const campaignStatus =
    typeof payload.campaignStatus === "string" ? payload.campaignStatus : "";
  const lifecycle = typeof payload.status === "string" ? payload.status : "";
  const reasons = formatReasons(payload.failureReasons);

  if (
    campaignStatus === "MNO_ACCEPTED" ||
    campaignStatus === "MNO_PROVISIONED" ||
    lifecycle === "ACTIVE"
  ) {
    return { next: "approved" };
  }
  if (
    campaignStatus === "TCR_FAILED" ||
    campaignStatus === "TELNYX_FAILED" ||
    campaignStatus === "MNO_REJECTED" ||
    campaignStatus === "MNO_PROVISIONING_FAILED" ||
    reasons !== null
  ) {
    return {
      next: "rejected",
      reason: reasons ?? "Campaign was rejected by carrier review.",
    };
  }
  return { next: "pending" };
}

// ---------------------------------------------------------------------------
// Transitions + side effects
// ---------------------------------------------------------------------------

/** §4.4 table: which webhook/poll transitions each status may take. */
const ALLOWED_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  draft: [],
  submitted: ["pending", "approved", "rejected"],
  pending: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

async function sendOperationalEmail(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  copy: { subject: string; text: string; html: string },
): Promise<void> {
  try {
    const to = await billingRecipients(env, companyId, db);
    if (to.length > 0) await sendEmail(env, { to, ...copy });
  } catch (cause) {
    // Emails are best-effort side effects of an already-applied transition;
    // a Resend outage must not wedge the state machine.
    Sentry.captureException(cause);
  }
}

/**
 * Apply one status transition + its §4.4 side effects. No-ops (returns the
 * row unchanged) when the transition is not allowed from the current status —
 * that is what makes duplicate webhook deliveries and the webhook/poller
 * overlap harmless, and what fires each transition's email exactly once.
 */
async function applyTransition(
  env: Env,
  db: SupabaseClient,
  company: RegistrationCompany,
  row: RegistrationRow,
  mapped: MappedTransition,
): Promise<RegistrationRow> {
  if (!ALLOWED_TRANSITIONS[row.status].includes(mapped.next)) return row;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: mapped.next };
  if (mapped.next === "approved") {
    patch.approved_at = now;
    patch.rejection_reason = null;
  }
  if (mapped.next === "rejected") {
    patch.rejected_at = now;
    patch.rejection_reason =
      mapped.reason ?? "Rejected by carrier review.";
  }
  const updated = await updateRow(db, row.id, patch);

  if (row.kind === "brand" && mapped.next === "approved") {
    // R2: brand acceptance → submit the campaign (recovered by the poller if
    // this attempt fails — see pollRegistrations).
    try {
      await submitCampaignIfReady(env, db, company, updated);
    } catch (cause) {
      Sentry.captureException(cause);
    }
  }
  if (row.kind === "campaign" && mapped.next === "approved") {
    // R3: assign the company's numbers, unlock US sends, email the good news.
    try {
      await assignNumbersToCampaign(env, db, updated);
    } catch (cause) {
      Sentry.captureException(cause);
    }
    await sendOperationalEmail(
      env,
      db,
      company.id,
      usTextingLiveCopy(company.name, env),
    );
  }
  if (mapped.next === "rejected") {
    // R4: rejection email with the fix-and-resubmit link.
    await sendOperationalEmail(
      env,
      db,
      company.id,
      registrationRejectedCopy(
        company.name,
        (patch.rejection_reason as string) ?? "",
        env,
      ),
    );
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Submission (R1/R2 + rejected-resubmit + post-grace reactivation)
// ---------------------------------------------------------------------------

/** Sole-prop OTP trigger/resend — `POST /v2/10dlc/brand/{brandId}/smsOtp`. */
export async function triggerBrandOtp(
  env: Env,
  brandTelnyxId: string,
): Promise<void> {
  await telnyxRequest(env, {
    method: "POST",
    path: `/v2/10dlc/brand/${brandTelnyxId}/smsOtp`,
  });
}

/**
 * Sole-prop OTP verification — `PUT /v2/10dlc/brand/{brandId}/smsOtp
 * { otpPin }` (§4.2). Throws {@link TelnyxApiError} on a wrong/expired PIN
 * (the route maps it to 422). On success the brand is VERIFIED on the Telnyx
 * side; the caller refreshes local state via {@link refreshBrandFromRemote}.
 */
export async function verifyBrandOtp(
  env: Env,
  brandTelnyxId: string,
  otpPin: string,
): Promise<void> {
  await telnyxRequest(env, {
    method: "PUT",
    path: `/v2/10dlc/brand/${brandTelnyxId}/smsOtp`,
    body: { otpPin },
  });
}

/** Poll one brand row against `GET /v2/10dlc/brand/{brandId}` and apply. */
export async function refreshBrandFromRemote(
  env: Env,
  row: RegistrationRow,
): Promise<RegistrationRow> {
  if (!row.telnyx_id) return row;
  const db = getDb(env);
  const company = await fetchCompany(db, row.company_id);
  const remote = unwrapTendlc(
    await telnyxRequest(env, {
      method: "GET",
      path: `/v2/10dlc/brand/${row.telnyx_id}`,
    }),
  );
  return applyTransition(env, db, company, row, mapBrandState(remote));
}

function parseBrandDraft(row: RegistrationRow): BrandDraft | null {
  const parsed = brandDraftSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

function parseCampaignDraft(row: RegistrationRow): CampaignDraft | null {
  // Stored campaign data also carries the internal numberAssignments ledger;
  // pick the wizard fields so the strict schema validates what matters.
  const { messageFlow, sample1, sample2 } = row.data;
  const parsed = campaignDraftSchema.safeParse({ messageFlow, sample1, sample2 });
  return parsed.success ? parsed.data : null;
}

async function submitBrand(
  env: Env,
  db: SupabaseClient,
  row: RegistrationRow,
  draft: BrandDraft,
): Promise<RegistrationRow> {
  const payload = buildBrandPayload(env, draft);
  let telnyxId = row.telnyx_id;
  if (telnyxId) {
    // Rejected-resubmit against the SAME brand: updating re-triggers TCR
    // validation without buying a duplicate brand registration.
    await telnyxRequest(env, {
      method: "PUT",
      path: `/v2/10dlc/brand/${telnyxId}`,
      body: payload,
    });
  } else {
    const response = unwrapTendlc(
      await telnyxRequest(env, {
        method: "POST",
        path: "/v2/10dlc/brand",
        body: payload,
      }),
    );
    telnyxId = typeof response.brandId === "string" ? response.brandId : null;
    if (!telnyxId) throw new Error("Telnyx brand create returned no brandId");
  }

  const soleProprietor = isSoleProprietorDraft(draft);
  const updated = await updateRow(db, row.id, {
    status: "submitted",
    telnyx_id: telnyxId,
    sole_proprietor: soleProprietor,
    submitted_at: new Date().toISOString(),
    submission_count: row.submission_count + 1,
    rejection_reason: null,
    rejected_at: null,
    approved_at: null,
    otp_nudged_at: null,
  });

  if (soleProprietor) {
    // §4.2: immediately text the 6-digit PIN to the wizard's mobile number.
    // A trigger failure is recoverable in-app ("Resend code"), so it must not
    // fail the submission itself.
    try {
      await triggerBrandOtp(env, telnyxId);
    } catch (cause) {
      Sentry.captureException(cause);
    }
  }
  return updated;
}

async function submitCampaign(
  env: Env,
  db: SupabaseClient,
  brand: RegistrationRow,
  campaign: RegistrationRow,
  draft: CampaignDraft,
): Promise<RegistrationRow> {
  if (!brand.telnyx_id) {
    throw new Error("cannot submit campaign: brand has no Telnyx id");
  }
  const brandDraft = parseBrandDraft(brand);
  const response = unwrapTendlc(
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/10dlc/campaignBuilder",
      body: buildCampaignPayload(env, {
        brandId: brand.telnyx_id,
        soleProprietor: brand.sole_proprietor,
        campaign: draft,
        businessName:
          brandDraft?.displayName ??
          (typeof brand.data.displayName === "string"
            ? brand.data.displayName
            : "Our business"),
        brandContactPhone:
          brandDraft?.phone ??
          (typeof brand.data.phone === "string" ? brand.data.phone : ""),
      }),
    }),
  );
  const campaignId =
    typeof response.campaignId === "string" ? response.campaignId : null;
  if (!campaignId) throw new Error("campaignBuilder returned no campaignId");

  return updateRow(db, campaign.id, {
    status: "submitted",
    telnyx_id: campaignId,
    sole_proprietor: brand.sole_proprietor,
    submitted_at: new Date().toISOString(),
    submission_count: campaign.submission_count + 1,
    rejection_reason: null,
    rejected_at: null,
    approved_at: null,
    // §4.4 reactivation: a fresh campaign clears the deactivation stamp and
    // starts a fresh assignment ledger.
    deactivated_at: null,
    data: { ...campaign.data, numberAssignments: {} },
  });
}

/** R2 trigger — submit the campaign when the brand just got approved. */
async function submitCampaignIfReady(
  env: Env,
  db: SupabaseClient,
  company: RegistrationCompany,
  brand: RegistrationRow,
): Promise<void> {
  const { campaign } = await fetchRegistrationRows(db, company.id);
  if (!campaign) return;
  if (campaign.status !== "draft" && campaign.deactivated_at === null) return;
  const draft = parseCampaignDraft(campaign);
  if (!draft) {
    Sentry.captureMessage(
      `campaign draft for company ${company.id} is incomplete at R2 time`,
      "error",
    );
    return;
  }
  await submitCampaign(env, db, brand, campaign, draft);
}

export type SubmitRegistrationResult =
  | {
      action: "brand_submitted" | "campaign_submitted" | "campaign_reactivated";
      brand: RegistrationRow;
      campaign: RegistrationRow;
    }
  | { action: "noop"; reason: string };

/**
 * Converge the company's registration one step forward (idempotent — safe to
 * call from every paid checkout, the enable-us `invoice.paid` branch, and
 * `POST /v1/registration/submit`):
 *
 *  - nothing owed (CA, US texting off) → noop
 *  - post-grace reactivation (§4.4): campaign deactivated + brand approved →
 *    resubmit the campaign against the existing brand, clear `deactivated_at`,
 *    increment `submission_count`
 *  - R1: brand draft (or rejected, after the wizard fix) → submit the brand;
 *    sole-prop additionally triggers the OTP
 *  - R2 recovery: brand approved + campaign draft/rejected → submit campaign
 *  - already in flight / already approved → noop
 */
export async function submitRegistration(
  env: Env,
  companyId: string,
): Promise<SubmitRegistrationResult> {
  const db = getDb(env);
  const company = await fetchCompany(db, companyId);
  if (!owesUsRegistration(company)) {
    return { action: "noop", reason: "US registration is not required." };
  }

  const { brand, campaign } = await fetchRegistrationRows(db, companyId);
  if (!brand || !campaign) {
    return {
      action: "noop",
      reason: "Registration wizard has not been completed.",
    };
  }

  // Post-grace reactivation (§4.4, §9): the grace-expiry cron deactivated the
  // approved campaign; resubmit against the existing (still approved) brand.
  if (campaign.deactivated_at !== null && brand.status === "approved") {
    const draft = parseCampaignDraft(campaign);
    if (!draft) {
      return { action: "noop", reason: "Campaign draft data is incomplete." };
    }
    const updated = await submitCampaign(env, db, brand, campaign, draft);
    return { action: "campaign_reactivated", brand, campaign: updated };
  }

  if (brand.status === "draft" || brand.status === "rejected") {
    const draft = parseBrandDraft(brand);
    if (!draft) {
      return { action: "noop", reason: "Brand draft data is incomplete." };
    }
    const updated = await submitBrand(env, db, brand, draft);
    return { action: "brand_submitted", brand: updated, campaign };
  }

  if (
    brand.status === "approved" &&
    (campaign.status === "draft" || campaign.status === "rejected")
  ) {
    const draft = parseCampaignDraft(campaign);
    if (!draft) {
      return { action: "noop", reason: "Campaign draft data is incomplete." };
    }
    const updated = await submitCampaign(env, db, brand, campaign, draft);
    return { action: "campaign_submitted", brand, campaign: updated };
  }

  return {
    action: "noop",
    reason:
      campaign.status === "approved"
        ? "Registration is already approved."
        : "Registration is already submitted and under review.",
  };
}

// ---------------------------------------------------------------------------
// R3: phone-number → campaign assignment
// ---------------------------------------------------------------------------

type AssignmentState = "pending" | "added" | "failed";

function assignmentLedger(row: RegistrationRow): Record<string, AssignmentState> {
  const raw = row.data.numberAssignments;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, AssignmentState>) };
  }
  return {};
}

/**
 * R3 — `POST /v2/10dlc/phoneNumberCampaign { phoneNumber, campaignId }` for
 * every active company number not yet assigned. Assignment outcomes land in
 * the campaign row's `data.numberAssignments` ledger: the
 * `10dlc.phone_number.update` webhook confirms ADDED / records FAILED, and
 * {@link retryCampaignAssignments} re-runs failures (§4.4).
 */
export async function assignNumbersToCampaign(
  env: Env,
  db: SupabaseClient,
  campaign: RegistrationRow,
): Promise<RegistrationRow> {
  if (!campaign.telnyx_id) return campaign;
  const { data, error } = await db
    .from("phone_numbers")
    .select("number_e164")
    .eq("company_id", campaign.company_id)
    .eq("status", "active")
    .not("number_e164", "is", null);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  const ledger = assignmentLedger(campaign);
  let changed = false;
  for (const item of data ?? []) {
    const e164 = (item as { number_e164: string }).number_e164;
    if (ledger[e164] === "added" || ledger[e164] === "pending") continue;
    try {
      await telnyxRequest(env, {
        method: "POST",
        path: "/v2/10dlc/phoneNumberCampaign",
        body: { phoneNumber: e164, campaignId: campaign.telnyx_id },
      });
      ledger[e164] = "pending";
    } catch (cause) {
      ledger[e164] = "failed";
      Sentry.captureException(cause);
    }
    changed = true;
  }
  if (!changed) return campaign;
  return updateRow(db, campaign.id, {
    data: { ...campaign.data, numberAssignments: ledger },
  });
}

/**
 * Re-run failed/missing number assignments for approved, non-deactivated
 * campaigns (§4.4: "provisioning-retry cron re-runs R3's assignment").
 * Called from {@link pollRegistrations}; also exported for the 15-minute
 * cron to wire alongside reconcileNumbers.
 */
export async function retryCampaignAssignments(env: Env): Promise<number> {
  const db = getDb(env);
  const { data, error } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("kind", "campaign")
    .eq("status", "approved")
    .is("deactivated_at", null)
    .not("telnyx_id", "is", null);
  if (error) {
    throw new Error(`messaging_registrations lookup failed: ${error.message}`);
  }

  let retried = 0;
  for (const campaign of (data ?? []) as unknown as RegistrationRow[]) {
    const ledger = assignmentLedger(campaign);
    const hasFailure = Object.values(ledger).includes("failed");
    // Reset failures to unassigned so assignNumbersToCampaign re-attempts;
    // it also picks up any active number missing from the ledger entirely.
    if (hasFailure) {
      for (const key of Object.keys(ledger)) {
        if (ledger[key] === "failed") delete ledger[key];
      }
      campaign.data = { ...campaign.data, numberAssignments: ledger };
    }
    const before = JSON.stringify(assignmentLedger(campaign));
    const updated = await assignNumbersToCampaign(env, db, campaign);
    if (JSON.stringify(assignmentLedger(updated)) !== before) retried += 1;
  }
  return retried;
}

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

interface TelnyxEventData {
  event_type?: unknown;
  payload?: unknown;
}

/** Accept both the full `{ data: {...} }` envelope and the bare `data`. */
function normalizeEvent(event: unknown): {
  eventType: string;
  payload: Record<string, unknown>;
} | null {
  if (event === null || typeof event !== "object") return null;
  let data = event as TelnyxEventData;
  if (
    typeof data.event_type !== "string" &&
    "data" in event &&
    (event as { data?: unknown }).data !== null &&
    typeof (event as { data?: unknown }).data === "object"
  ) {
    data = (event as { data: TelnyxEventData }).data;
  }
  if (typeof data.event_type !== "string") return null;
  const payload =
    data.payload !== null && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : {};
  return { eventType: data.event_type, payload };
}

/**
 * §4.4 webhook event mapping — the handler behind `/webhooks/telnyx` for
 * `10dlc.brand.update`, `10dlc.campaign.update`, and
 * `10dlc.phone_number.update` (the messaging track forwards them here).
 * Unknown events, unknown brand/campaign ids, and out-of-order deliveries are
 * all safe no-ops.
 */
export async function handle10dlcEvent(
  env: Env,
  event: unknown,
): Promise<void> {
  const normalized = normalizeEvent(event);
  if (!normalized) return;
  const { eventType, payload } = normalized;
  const db = getDb(env);

  if (eventType === "10dlc.brand.update") {
    const brandId = typeof payload.brandId === "string" ? payload.brandId : null;
    if (!brandId) return;
    const row = await findRowByTelnyxId(db, "brand", brandId);
    if (!row) return;
    const company = await fetchCompany(db, row.company_id);
    await applyTransition(env, db, company, row, mapBrandState(payload));
    return;
  }

  if (eventType === "10dlc.campaign.update") {
    const campaignId =
      typeof payload.campaignId === "string" ? payload.campaignId : null;
    if (!campaignId) return;
    const row = await findRowByTelnyxId(db, "campaign", campaignId);
    if (!row) return;
    const mapped = mapCampaignEvent(payload);
    if (!mapped) return;
    const company = await fetchCompany(db, row.company_id);
    await applyTransition(env, db, company, row, mapped);
    return;
  }

  if (eventType === "10dlc.phone_number.update") {
    const campaignId =
      typeof payload.campaignId === "string" ? payload.campaignId : null;
    const phoneNumber =
      typeof payload.phoneNumber === "string" ? payload.phoneNumber : null;
    const status = typeof payload.status === "string" ? payload.status : "";
    if (!campaignId || !phoneNumber) return;
    const row = await findRowByTelnyxId(db, "campaign", campaignId);
    if (!row) return;

    const ledger = assignmentLedger(row);
    if (status === "ADDED") {
      if (ledger[phoneNumber] === "added") return; // duplicate delivery
      ledger[phoneNumber] = "added";
    } else if (status === "FAILED") {
      ledger[phoneNumber] = "failed";
      Sentry.captureMessage(
        `10DLC number assignment FAILED for campaign ${campaignId} (company ${row.company_id}): ${formatReasons(payload.reasons) ?? "no reason given"}`,
        "error",
      );
    } else {
      return; // DELETED / other — nothing to track
    }
    await updateRow(db, row.id, {
      data: { ...row.data, numberAssignments: ledger },
    });
    return;
  }

  // Unknown 10dlc.* event — ack and ignore (SPEC §4.4).
}

// ---------------------------------------------------------------------------
// Daily poller (D2 authoritative fallback) + OTP nudge + deactivation + gates
// ---------------------------------------------------------------------------

export interface PollSummary {
  polled: number;
  transitioned: number;
  assignmentsRetried: number;
}

/**
 * §11 registration poller (daily): for every `submitted`/`pending` row with a
 * Telnyx id, fetch the remote truth (`GET /v2/10dlc/brand/{brandId}` /
 * `GET /v2/10dlc/campaign/{campaignId}`) and apply any missed transition —
 * side-effect emails ride the same transition path as webhooks, so they fire
 * exactly once. Also recovers a missed R2 (brand approved while its campaign
 * never left draft) and re-runs failed R3 assignments.
 */
export async function pollRegistrations(env: Env): Promise<PollSummary> {
  const db = getDb(env);
  const summary: PollSummary = { polled: 0, transitioned: 0, assignmentsRetried: 0 };

  const { data, error } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .in("status", ["submitted", "pending"])
    .not("telnyx_id", "is", null);
  if (error) {
    throw new Error(`messaging_registrations lookup failed: ${error.message}`);
  }

  const failures: unknown[] = [];
  for (const row of (data ?? []) as unknown as RegistrationRow[]) {
    try {
      summary.polled += 1;
      const company = await fetchCompany(db, row.company_id);
      const remote = unwrapTendlc(
        await telnyxRequest(env, {
          method: "GET",
          path:
            row.kind === "brand"
              ? `/v2/10dlc/brand/${row.telnyx_id}`
              : `/v2/10dlc/campaign/${row.telnyx_id}`,
        }),
      );
      const mapped =
        row.kind === "brand" ? mapBrandState(remote) : mapCampaignRemote(remote);
      const updated = await applyTransition(env, db, company, row, mapped);
      if (updated.status !== row.status) summary.transitioned += 1;
    } catch (cause) {
      failures.push(cause);
    }
  }

  // R2 recovery: approved brands whose campaign never got submitted (the
  // webhook-time attempt failed and the campaign row is still a draft).
  const { data: approvedBrands, error: brandError } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("kind", "brand")
    .eq("status", "approved");
  if (brandError) {
    throw new Error(`messaging_registrations lookup failed: ${brandError.message}`);
  }
  for (const brand of (approvedBrands ?? []) as unknown as RegistrationRow[]) {
    try {
      const company = await fetchCompany(db, brand.company_id);
      if (company.subscription_status === "canceled") continue;
      const { campaign } = await fetchRegistrationRows(db, brand.company_id);
      if (campaign && campaign.status === "draft" && campaign.deactivated_at === null) {
        await submitCampaignIfReady(env, db, company, brand);
      }
    } catch (cause) {
      failures.push(cause);
    }
  }

  try {
    summary.assignmentsRetried = await retryCampaignAssignments(env);
  } catch (cause) {
    failures.push(cause);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `registration poll finished with ${failures.length} failure(s)`,
    );
  }
  return summary;
}

/**
 * §11 hourly sole-prop OTP nudge: exactly one Resend nudge per brand
 * submission, +12h after submission while the brand is still unverified
 * (`otp_nudged_at` is the idempotency stamp; submitBrand clears it on every
 * (re)submission so each 24-hour OTP window gets its own nudge).
 */
export async function nudgeSoleProprietorOtp(
  env: Env,
  now: Date = new Date(),
): Promise<number> {
  const db = getDb(env);
  const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("kind", "brand")
    .eq("sole_proprietor", true)
    .in("status", ["submitted", "pending"])
    .is("otp_nudged_at", null)
    .lt("submitted_at", cutoff);
  if (error) {
    throw new Error(`messaging_registrations lookup failed: ${error.message}`);
  }

  let nudged = 0;
  for (const row of (data ?? []) as unknown as RegistrationRow[]) {
    // Stamp FIRST (§11 idempotency pattern): overlap can never double-send.
    const { data: stamped, error: stampError } = await db
      .from("messaging_registrations")
      .update({ otp_nudged_at: now.toISOString() })
      .eq("id", row.id)
      .is("otp_nudged_at", null)
      .select("id");
    if (stampError) {
      throw new Error(`otp_nudged_at stamp failed: ${stampError.message}`);
    }
    if (!stamped || stamped.length === 0) continue;

    const company = await fetchCompany(db, row.company_id);
    await sendOperationalEmail(
      env,
      db,
      company.id,
      otpNudgeCopy(company.name, env),
    );
    nudged += 1;
  }
  return nudged;
}

/**
 * Grace-expiry campaign deactivation (SPEC §4.4, §11):
 * `DELETE /v2/10dlc/campaign/{campaignId}`, `deactivated_at` stamped. Stops
 * the recurring campaign fee for churned tenants while keeping the row (and
 * the approved brand) for the §4.4 reactivation path. Returns the updated
 * campaign row, or null when there is nothing to deactivate.
 */
export async function deactivateCampaign(
  env: Env,
  companyId: string,
): Promise<RegistrationRow | null> {
  const db = getDb(env);
  const { campaign } = await fetchRegistrationRows(db, companyId);
  if (!campaign) return null;
  if (campaign.deactivated_at !== null) return campaign; // already deactivated
  if (!campaign.telnyx_id) return null; // never submitted — nothing at Telnyx
  try {
    await telnyxRequest(env, {
      method: "DELETE",
      path: `/v2/10dlc/campaign/${campaign.telnyx_id}`,
    });
  } catch (cause) {
    // Already gone on the Telnyx side → converge; real failures propagate so
    // the daily cron retries (the fee keeps billing until this succeeds).
    if (!(cause instanceof TelnyxApiError && cause.status === 404)) {
      throw cause;
    }
  }
  return updateRow(db, campaign.id, {
    deactivated_at: new Date().toISOString(),
  });
}

export interface SendGates {
  /** `companies.subscription_status === 'active'` (SPEC §1 rule 3). */
  subscriptionActive: boolean;
  /**
   * US-bound sends allowed (§4.4 gate): campaign `approved`, not deactivated
   * — and for CA companies, only with `us_texting_enabled` (§4.2).
   */
  usApproved: boolean;
  /**
   * CA-bound sends have no registration gate (§4.2: works immediately after
   * provisioning; CASL applies operationally, not via this gate). Constant
   * true — subscription gating is the separate flag above.
   */
  caAllowed: boolean;
}

/**
 * The per-destination send gates (cross-track contract; consumed by
 * `POST /v1/messages/send` / `POST /v1/conversations`).
 */
export async function getSendGates(
  env: Env,
  companyId: string,
): Promise<SendGates> {
  const db = getDb(env);
  const company = await fetchCompany(db, companyId);
  const { campaign } = await fetchRegistrationRows(db, companyId);

  const usApproved =
    (company.country === "US" || company.us_texting_enabled) &&
    campaign !== null &&
    campaign.status === "approved" &&
    campaign.deactivated_at === null;

  return {
    subscriptionActive: company.subscription_status === "active",
    usApproved,
    caAllowed: true,
  };
}
