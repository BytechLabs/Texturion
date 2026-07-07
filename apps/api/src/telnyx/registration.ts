import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest, TelnyxApiError } from "./client";
import {
  otpNudgeCopy,
  portAssignmentBlockedCopy,
  registrationRejectedCopy,
  usTextingLiveCopy,
} from "./emails";
import {
  brandDraftSchema,
  buildBrandPayload,
  buildCampaignContentUpdate,
  buildCampaignPayload,
  campaignDraftSchema,
  isSoleProprietorDraft,
  type BrandDraft,
  type CampaignDraft,
} from "./wizard";
import { capture } from "../analytics/posthog";
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
  reactivation_count: number;
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
  "submission_count,reactivation_count,submitted_at,approved_at,rejected_at," +
  "deactivated_at,otp_nudged_at";

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
    // §12 step 18 north-star: carrier approval — US texting just unlocked.
    // ALLOWED_TRANSITIONS gates this transition (and so this capture) to at
    // most once per approval, across webhook/poller overlap and redelivery.
    await capture(env, "registration_approved", company.id);
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

/**
 * #40 lifetime cap on review-cycle campaign submissions (R2 first submit +
 * rejected-resubmits). Every `POST /v2/10dlc/campaignBuilder` buys a fresh
 * ~$15 vetting + upfront campaign fee; SPEC prices exactly ONE resubmission
 * into the $29 registration fee (D5). 3 = the initial submission + the priced
 * resubmission + one goodwill retry; after that it is a support conversation,
 * never silent spend.
 */
export const MAX_CAMPAIGN_SUBMISSIONS = 3;

/**
 * #40: the §4.4 post-grace reactivation path gets its OWN small budget — a
 * reactivation is driven by a paying resubscribe (not by carrier rejections),
 * so it must not drain, nor be drained by, the review budget. Each one still
 * re-buys the campaign fee chain, so it is capped too: 4 churn-and-return
 * cycles is generous for a legitimate tenant and bounds a churn-loop abuser.
 */
export const MAX_CAMPAIGN_REACTIVATIONS = 4;

/** Which lifetime budget a campaign submission consumes (#40). */
type CampaignSubmitCause = "review" | "reactivation";

/**
 * Thrown by {@link submitCampaign} when the lifetime budget for `cause` is
 * exhausted — BEFORE any Telnyx call. The message is customer-facing:
 * `runSubmitRegistration` folds it into a noop reason, which
 * `POST /v1/registration/submit` surfaces as the 409 body.
 */
export class CampaignSubmissionCapError extends Error {
  constructor(cause: CampaignSubmitCause) {
    super(
      cause === "reactivation"
        ? "This registration has been reactivated the maximum number of times — contact support and we'll restore US texting with you."
        : "This registration has used all of its included carrier-review submissions — contact support and we'll finish it together.",
    );
    this.name = "CampaignSubmissionCapError";
  }
}

/** Minimal local copy builder (same shape/tone as telnyx/emails.ts). */
function capEmailCopy(
  subject: string,
  text: string,
): { subject: string; text: string; html: string } {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return {
    subject,
    text,
    html: `<p>${escaped.replaceAll("\n\n", "</p><p>").replaceAll("\n", "<br>")}</p>`,
  };
}

/** #40 alert-BEFORE-the-cap: sent when exactly one budget unit remains. */
function campaignCapApproachingCopy(
  companyName: string,
  cause: CampaignSubmitCause,
  env: Env,
): { subject: string; text: string; html: string } {
  if (cause === "reactivation") {
    return capEmailCopy(
      "Heads up: one texting reactivation left",
      `Hi,\n\nWe've resubmitted ${companyName}'s texting registration to US ` +
        `carriers as part of reactivating your account. Heads up: your plan ` +
        `includes one more automatic reactivation after this one — if you ` +
        `need more, contact support and we'll sort it out together.\n\n` +
        `Track it: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
    );
  }
  return capEmailCopy(
    "Heads up: one carrier-review submission left",
    `Hi,\n\n${companyName}'s texting registration is with US carrier review ` +
      `again. Heads up: your registration fee includes one more automatic ` +
      `resubmission after this one — if carriers reject it again after that, ` +
      `we'll pause and finish it with you through support (no extra charges ` +
      `without your say-so).\n\n` +
      `Track it: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/** #40 terminal state: submissions paused, contact support — no silent spend. */
function campaignCapReachedCopy(
  companyName: string,
  cause: CampaignSubmitCause,
  env: Env,
): { subject: string; text: string; html: string } {
  const what =
    cause === "reactivation"
      ? "reactivations of your texting registration"
      : "carrier-review submissions for your texting registration";
  return capEmailCopy(
    "Your US texting registration needs our help",
    `Hi,\n\n${companyName} has used all of its included ${what}, so we've ` +
      `paused automatic resubmissions — nothing further will be charged. ` +
      `Please contact support and we'll get US texting finished together.\n\n` +
      `Details: ${env.APP_ORIGIN}/settings/numbers\n\n— Loonext`,
  );
}

/**
 * One-shot "budget exhausted" owner notification (#40): stamp FIRST (the §11
 * idempotency pattern — the route, the checkout webhook, and the sweeper can
 * all hit the exhausted budget repeatedly), then email + Sentry.
 */
async function notifyCampaignCapReached(
  env: Env,
  db: SupabaseClient,
  company: RegistrationCompany,
  campaign: RegistrationRow,
  cause: CampaignSubmitCause,
): Promise<void> {
  const stampKey =
    cause === "reactivation"
      ? "reactivationCapNotifiedAt"
      : "submissionCapNotifiedAt";
  if (typeof campaign.data[stampKey] === "string") return;
  Sentry.captureMessage(
    `10DLC campaign ${cause} budget exhausted for company ${company.id} — submissions paused ('contact support' surfaced)`,
    "error",
  );
  await updateRow(db, campaign.id, {
    data: { ...campaign.data, [stampKey]: new Date().toISOString() },
  });
  await sendOperationalEmail(
    env,
    db,
    company.id,
    campaignCapReachedCopy(company.name, cause, env),
  );
}

/**
 * Atomically consume one unit of the campaign's lifetime submission budget
 * (#40) — BEFORE the Telnyx call, so the cost path fails closed and two
 * concurrent submitters (checkout webhook + route + sweeper replay) can never
 * race past the cap (`bump_registration_counter` is a single guarded
 * `UPDATE ... WHERE counter < cap RETURNING`, mirroring
 * `bump_text_enablement_counter` — the audit's model to copy).
 *
 * Fires the alert-BEFORE-the-cap owner email when exactly one unit remains,
 * and the one-shot terminal notification + {@link CampaignSubmissionCapError}
 * once the budget is spent.
 */
async function consumeCampaignSubmissionBudget(
  env: Env,
  db: SupabaseClient,
  company: RegistrationCompany,
  campaign: RegistrationRow,
  cause: CampaignSubmitCause,
): Promise<void> {
  const counter =
    cause === "reactivation" ? "reactivation_count" : "submission_count";
  const cap =
    cause === "reactivation"
      ? MAX_CAMPAIGN_REACTIVATIONS
      : MAX_CAMPAIGN_SUBMISSIONS;
  const { data, error } = await db.rpc("bump_registration_counter", {
    p_row_id: campaign.id,
    p_company_id: campaign.company_id,
    p_counter: counter,
    p_cap: cap,
  });
  if (error) {
    // Cost path fails closed: no budget confirmation, no Telnyx spend.
    throw new Error(`bump_registration_counter failed: ${error.message}`);
  }
  const result = (data ?? {}) as { allowed?: boolean; count?: number };
  if (result.allowed !== true) {
    await notifyCampaignCapReached(env, db, company, campaign, cause);
    throw new CampaignSubmissionCapError(cause);
  }
  if (result.count === cap - 1) {
    // Alert BEFORE the cap (cost-protection mandate): one unit left after the
    // submission this consumed. Counters are monotonic, so this fires once.
    Sentry.captureMessage(
      `10DLC campaign ${cause} budget nearly exhausted for company ${company.id} (${result.count}/${cap})`,
      "warning",
    );
    await sendOperationalEmail(
      env,
      db,
      company.id,
      campaignCapApproachingCopy(company.name, cause, env),
    );
  }
}

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
  // Stored brand data may also carry the #51 write-ahead marker; strip the
  // internal bookkeeping so the strict wizard schema validates what matters
  // (mirroring how parseCampaignDraft handles numberAssignments).
  const { brandSubmitAttemptedAt: _marker, ...wizard } = row.data;
  const parsed = brandDraftSchema.safeParse(wizard);
  return parsed.success ? parsed.data : null;
}

function parseCampaignDraft(row: RegistrationRow): CampaignDraft | null {
  // Stored campaign data also carries the internal numberAssignments ledger;
  // pick the wizard fields so the strict schema validates what matters.
  const { messageFlow, sample1, sample2 } = row.data;
  const parsed = campaignDraftSchema.safeParse({ messageFlow, sample1, sample2 });
  return parsed.success ? parsed.data : null;
}

/**
 * #51 crash-after-create recovery: when a previous brand-create attempt left
 * its write-ahead marker but no local `telnyx_id`, the brand may exist at TCR
 * already (each POST carries a real one-time carrier fee). List the account's
 * brands filtered by displayName and adopt the one matching this draft's
 * displayName + EIN that no local row has claimed — mirroring provisioning's
 * `adoptOrphanNumber` (`customer_reference` orphan adoption). Returns null
 * when there is nothing to adopt (the prior attempt never reached Telnyx);
 * a listing failure propagates so the caller retries later instead of
 * blind-POSTing a possible duplicate (cost paths fail closed).
 */
async function adoptOrphanBrand(
  env: Env,
  db: SupabaseClient,
  draft: BrandDraft,
): Promise<string | null> {
  const response = (await telnyxRequest<Record<string, unknown>>(env, {
    method: "GET",
    path: "/v2/10dlc/brand",
    query: { displayName: draft.displayName, recordsPerPage: "50" },
  })) as Record<string, unknown> | undefined;
  // The 10DLC list endpoints answer `{ records: [...] }`; tolerate `data` too
  // (same defensiveness as unwrapTendlc).
  const raw = response?.records ?? response?.data;
  const records = Array.isArray(raw) ? raw : [];
  for (const item of records) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const brandId =
      typeof record.brandId === "string" && record.brandId.length > 0
        ? record.brandId
        : null;
    if (!brandId) continue;
    if (record.displayName !== draft.displayName) continue;
    if (record.ein !== draft.ein) continue;
    // Never steal a brand some other local row already tracks.
    if (await findRowByTelnyxId(db, "brand", brandId)) continue;
    return brandId;
  }
  return null;
}

async function submitBrand(
  env: Env,
  db: SupabaseClient,
  row: RegistrationRow,
  draft: BrandDraft,
): Promise<RegistrationRow> {
  const payload = buildBrandPayload(env, draft);
  let telnyxId = row.telnyx_id;
  let current = row;
  if (telnyxId) {
    // Rejected-resubmit against the SAME brand: updating re-triggers TCR
    // validation without buying a duplicate brand registration.
    await telnyxRequest(env, {
      method: "PUT",
      path: `/v2/10dlc/brand/${telnyxId}`,
      body: payload,
    });
  } else {
    // #51: no local telnyx_id does NOT prove no brand exists at TCR — a
    // previous attempt may have crashed between the paid POST and the row
    // update (the write-ahead marker below records that window, but a wizard
    // re-save replaces `data` and can drop it). So ALWAYS check for an
    // adoptable orphan before buying: one cheap GET in front of a paid create.
    telnyxId = await adoptOrphanBrand(env, db, draft);
    if (telnyxId) {
      Sentry.captureMessage(
        `10DLC brand recovery: adopted orphan brand ${telnyxId} for company ${row.company_id} (a prior create attempt never persisted its id; write-ahead marker ${typeof current.data.brandSubmitAttemptedAt === "string" ? "present" : "absent"})`,
        "warning",
      );
    }
    if (!telnyxId) {
      // Write-ahead intent (#51, mirroring provisioning's persist-order-id-
      // first): stamp BEFORE the paid POST so a crash in the window is
      // recoverable via the adoption path above, never a double purchase.
      current = await updateRow(db, current.id, {
        data: {
          ...current.data,
          brandSubmitAttemptedAt: new Date().toISOString(),
        },
      });
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
  }

  const soleProprietor = isSoleProprietorDraft(draft);
  const updated = await updateRow(db, current.id, {
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
  company: RegistrationCompany,
  brand: RegistrationRow,
  campaign: RegistrationRow,
  draft: CampaignDraft,
  cause: CampaignSubmitCause,
): Promise<RegistrationRow> {
  if (!brand.telnyx_id) {
    throw new Error("cannot submit campaign: brand has no Telnyx id");
  }
  // #40: consume the lifetime budget BEFORE the paid campaignBuilder POST
  // (fail-closed; throws CampaignSubmissionCapError once spent). The guarded
  // RPC is also what increments submission_count / reactivation_count — the
  // updateRow below must not touch either counter.
  await consumeCampaignSubmissionBudget(env, db, company, campaign, cause);
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
    // submission_count / reactivation_count were already consumed atomically
    // by bump_registration_counter above (#40) — never re-set them here.
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
  await submitCampaign(env, db, company, brand, campaign, draft, "review");
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
 *
 * Every non-noop outcome fires the §12 step 18 `registration_submitted`
 * north-star event (the `action` property distinguishes the R1 first
 * submission from resubmits/recovery/reactivation).
 */
export async function submitRegistration(
  env: Env,
  companyId: string,
): Promise<SubmitRegistrationResult> {
  const result = await runSubmitRegistration(env, companyId);
  if (result.action !== "noop") {
    await capture(env, "registration_submitted", companyId, {
      action: result.action,
    });
  }
  return result;
}

async function runSubmitRegistration(
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
    try {
      const updated = await submitCampaign(
        env,
        db,
        company,
        brand,
        campaign,
        draft,
        "reactivation",
      );
      return { action: "campaign_reactivated", brand, campaign: updated };
    } catch (cause) {
      // #40 terminal state: budget spent → 409 'contact support' via the
      // route's noop mapping; the one-shot owner email already went out.
      if (cause instanceof CampaignSubmissionCapError) {
        return { action: "noop", reason: cause.message };
      }
      throw cause;
    }
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
    try {
      const updated = await submitCampaign(
        env,
        db,
        company,
        brand,
        campaign,
        draft,
        "review",
      );
      return { action: "campaign_submitted", brand, campaign: updated };
    } catch (cause) {
      if (cause instanceof CampaignSubmissionCapError) {
        return { action: "noop", reason: cause.message };
      }
      throw cause;
    }
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
 * One-shot guard for the §9 "10DLC assignment failed post-port" email:
 * `data.assignmentFailureNotified[e164]` stamps when we told the customer the
 * number is stuck. The §4.4 retry cron cycles the LEDGER failed → pending →
 * failed on every re-attempt, so the ledger alone cannot gate the email — this
 * stamp persists across retries (mirroring how the first-failure provision
 * email guards on attempts===0) and is cleared only when the assignment
 * finally lands (ADDED), so a genuinely new incident can notify again.
 */
function assignmentFailureNotified(row: RegistrationRow): Record<string, string> {
  const raw = row.data.assignmentFailureNotified;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, string>) };
  }
  return {};
}

/**
 * PORTING.md §9 scope: the "ask your previous texting provider to remove
 * {number} from their campaign" guidance applies to PORTED numbers (the
 * losing provider's carrier campaign is what blocks the assignment). A live
 * (non-cancelled) port_requests row for the E.164 is the discriminator.
 */
async function isPortedNumber(
  db: SupabaseClient,
  companyId: string,
  e164: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("port_requests")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone_e164", e164)
    .neq("status", "cancelled")
    .limit(1);
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
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

/**
 * Step 0c content migration for ALREADY-registered campaigns (FEATURE-GAPS):
 * campaigns created before the review-link feature shipped never declared the
 * review-ask content, so the review sends they now emit are undeclared.
 * Declare it after the fact via `PUT /v2/10dlc/campaign/{campaignId}` with
 * the update-safe sample block ({@link buildCampaignContentUpdate}).
 *
 * `description` and `embeddedLink` are CREATE-ONLY: Telnyx's campaign UPDATE
 * schema (`UpdateCampaignRequest`) accepts neither, and Telnyx documents that
 * only the sample messages are editable after registration — they can never
 * be migrated onto an existing campaign. A legacy campaign's only enforceable
 * declaration of the review ask is the sample3 review sample this PUT lands.
 *
 * Idempotent — GETs the campaign first and skips when a `sample3` is already
 * registered: sample3 is the field this migration introduces, so its presence
 * is the cheap "already migrated?" marker. Returns true when an update was
 * actually sent. A Telnyx 422 on the PUT is reported to Sentry and swallowed
 * (returns false): the payload is built to the update schema's 255-char caps,
 * but a campaign Telnyx still refuses must not fail the caller — otherwise
 * one bad tenant poisons every {@link pollRegistrations} run with a daily
 * AggregateError.
 */
export async function updateCampaignContent(
  env: Env,
  db: SupabaseClient,
  campaign: RegistrationRow,
): Promise<boolean> {
  if (!campaign.telnyx_id) return false;
  const remote = unwrapTendlc(
    await telnyxRequest(env, {
      method: "GET",
      path: `/v2/10dlc/campaign/${campaign.telnyx_id}`,
    }),
  );
  if (typeof remote.sample3 === "string" && remote.sample3.trim().length > 0) {
    return false; // already declares a review sample — nothing to migrate
  }

  const draft = parseCampaignDraft(campaign);
  if (!draft) return false; // no trustworthy local draft to (re)declare from

  const { brand } = await fetchRegistrationRows(db, campaign.company_id);
  const brandDraft = brand ? parseBrandDraft(brand) : null;
  const businessName =
    brandDraft?.displayName ??
    (brand && typeof brand.data.displayName === "string"
      ? brand.data.displayName
      : "Our business");

  try {
    await telnyxRequest(env, {
      method: "PUT",
      path: `/v2/10dlc/campaign/${campaign.telnyx_id}`,
      body: buildCampaignContentUpdate({ campaign: draft, businessName }),
    });
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status === 422) {
      // Defense in depth: content this specific campaign cannot accept is a
      // per-tenant data problem, not a poll-stopping outage. Report and skip;
      // any other failure (5xx, transport) propagates so the poll retries.
      Sentry.captureMessage(
        `10DLC campaign content migration rejected (422) for campaign ${campaign.telnyx_id} (company ${campaign.company_id}): ${cause.message}`,
        "error",
      );
      return false;
    }
    throw cause;
  }
  return true;
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
    const notified = assignmentFailureNotified(row);
    let sendBlockedEmail = false;
    if (status === "ADDED") {
      if (ledger[phoneNumber] === "added") return; // duplicate delivery
      ledger[phoneNumber] = "added";
      // Resolved — clear the one-shot stamp so a future re-failure (a new
      // incident, e.g. the old provider re-claims the number) notifies again.
      delete notified[phoneNumber];
    } else if (status === "FAILED") {
      ledger[phoneNumber] = "failed";
      Sentry.captureMessage(
        `10DLC number assignment FAILED for campaign ${campaignId} (company ${row.company_id}): ${formatReasons(payload.reasons) ?? "no reason given"}`,
        "error",
      );
      // §9 "10DLC assignment failed post-port": customer-actionable, so it
      // must reach them — once per stuck number, not per retry-cron cycle.
      sendBlockedEmail =
        !notified[phoneNumber] &&
        (await isPortedNumber(db, row.company_id, phoneNumber));
      if (sendBlockedEmail) notified[phoneNumber] = new Date().toISOString();
    } else {
      return; // DELETED / other — nothing to track
    }
    await updateRow(db, row.id, {
      data: {
        ...row.data,
        numberAssignments: ledger,
        assignmentFailureNotified: notified,
      },
    });
    if (sendBlockedEmail) {
      // After the stamp is persisted (like every transition email here): a
      // failed row update must not leave an emailed-but-unstamped state that
      // re-emails on redelivery.
      await sendOperationalEmail(
        env,
        db,
        row.company_id,
        portAssignmentBlockedCopy(phoneNumber, env),
      );
    }
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
  /** Step 0c: registered campaigns whose remote content was migrated. */
  contentUpdated: number;
}

/**
 * §11 registration poller (daily): for every `submitted`/`pending` row with a
 * Telnyx id, fetch the remote truth (`GET /v2/10dlc/brand/{brandId}` /
 * `GET /v2/10dlc/campaign/{campaignId}`) and apply any missed transition —
 * side-effect emails ride the same transition path as webhooks, so they fire
 * exactly once. Also recovers a missed R2 (brand approved while its campaign
 * never left draft), re-runs failed R3 assignments, and migrates
 * already-registered campaign content to the Step 0c shape (once per
 * campaign — see {@link updateCampaignContent}).
 */
export async function pollRegistrations(env: Env): Promise<PollSummary> {
  const db = getDb(env);
  const summary: PollSummary = {
    polled: 0,
    transitioned: 0,
    assignmentsRetried: 0,
    contentUpdated: 0,
  };

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

  // Step 0c content migration: registered (approved, live) campaigns created
  // before the review-link content shipped get one PUT declaring it; the
  // sample3 guard inside updateCampaignContent makes every later run a no-op,
  // so this converges to one cheap GET per live campaign per day.
  const { data: liveCampaigns, error: liveError } = await db
    .from("messaging_registrations")
    .select(ROW_COLUMNS)
    .eq("kind", "campaign")
    .eq("status", "approved")
    .is("deactivated_at", null)
    .not("telnyx_id", "is", null);
  if (liveError) {
    throw new Error(`messaging_registrations lookup failed: ${liveError.message}`);
  }
  for (const campaign of (liveCampaigns ?? []) as unknown as RegistrationRow[]) {
    try {
      if (await updateCampaignContent(env, db, campaign)) {
        summary.contentUpdated += 1;
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
