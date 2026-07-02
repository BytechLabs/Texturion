import { NANP_AREA_CODES } from "@jobtext/shared";
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest, TelnyxApiError } from "./client";
import { provisioningDelayedCopy } from "./emails";
import { telnyxWebhookUrl } from "./wizard";
import { billingRecipients } from "../billing/recipients";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * The §4.3 number-provisioning saga. Every step is independently retryable and
 * keyed to a `phone_numbers` row inserted FIRST with `status='provisioning'`
 * and a unique `provisioning_key` (checkout session id for the initial number,
 * the request Idempotency-Key for Pro's 2nd) — the idempotency backstop that
 * makes duplicate `checkout.session.completed` deliveries and double-clicked
 * provision requests order at most one number.
 *
 * Saga steps (SPEC §4.3):
 *   S1  ensure the per-company messaging profile (US/CA geo-permissions,
 *       webhook URL + failover = API_ORIGIN + /webhooks/telnyx)
 *   S2  search inventory by requested area code, falling back to the area
 *       code's state/province (shared NANP table) when the NDC has none
 *   S3  order; persist telnyx_order_id IMMEDIATELY (crash-after-buy
 *       protection), then number + phone-number id; status='active'
 *
 * Crash windows are healed by {@link reconcileNumbers} (§11 15-minute cron):
 * a persisted order id is completed from `GET /v2/number_orders/{id}`, and a
 * Telnyx-side number that no row knows about is adopted via
 * `customer_reference = company_id`.
 */

export interface PhoneNumberRow {
  id: string;
  company_id: string;
  status: "provisioning" | "active" | "suspended" | "released" | "provision_failed";
  provisioning_key: string;
  requested_area_code: string | null;
  country: string;
  number_e164: string | null;
  telnyx_phone_number_id: string | null;
  telnyx_order_id: string | null;
  provision_attempts: number;
  last_provision_error: string | null;
  updated_at?: string;
}

interface ProvisioningCompany {
  id: string;
  name: string;
  country: string;
  requested_area_code: string;
  telnyx_messaging_profile_id: string | null;
  subscription_status: string;
}

const COMPANY_COLUMNS =
  "id,name,country,requested_area_code,telnyx_messaging_profile_id,subscription_status";

const NUMBER_COLUMNS =
  "id,company_id,status,provisioning_key,requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,updated_at";

/** SPEC §4.3: Sentry escalates (page the operator) after 5 failed attempts. */
export const MAX_PROVISION_ATTEMPTS = 5;

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<ProvisioningCompany> {
  const { data, error } = await db
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const company = (data?.[0] ?? null) as unknown as ProvisioningCompany | null;
  if (!company) throw new Error(`provisioning: company ${companyId} not found`);
  return company;
}

async function updateNumberRow(
  db: SupabaseClient,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<PhoneNumberRow> {
  const { data, error } = await db
    .from("phone_numbers")
    .update(patch)
    .eq("id", rowId)
    .select(NUMBER_COLUMNS);
  if (error) throw new Error(`phone_numbers update failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as PhoneNumberRow | null;
  if (!row) throw new Error(`phone_numbers row ${rowId} vanished mid-update`);
  return row;
}

// ---------------------------------------------------------------------------
// Telnyx response shapes (only the fields this saga reads).
// ---------------------------------------------------------------------------

interface MessagingProfileResponse {
  data?: { id?: string };
}

interface AvailableNumbersResponse {
  data?: { phone_number?: string }[];
}

interface NumberOrderResponse {
  data?: {
    id?: string;
    status?: string;
    phone_numbers?: { phone_number?: string }[];
  };
}

interface PhoneNumbersListResponse {
  data?: {
    id?: string;
    phone_number?: string;
    customer_reference?: string | null;
  }[];
  meta?: { total_pages?: number };
}

// ---------------------------------------------------------------------------
// Saga steps
// ---------------------------------------------------------------------------

/** S1 — one Telnyx messaging profile per company (D2), created once. */
async function ensureMessagingProfile(
  env: Env,
  db: SupabaseClient,
  company: ProvisioningCompany,
): Promise<string> {
  if (company.telnyx_messaging_profile_id) {
    return company.telnyx_messaging_profile_id;
  }
  const webhook = telnyxWebhookUrl(env);
  const response = await telnyxRequest<MessagingProfileResponse>(env, {
    method: "POST",
    path: "/v2/messaging_profiles",
    body: {
      name: company.id,
      webhook_url: webhook,
      // Same route: enables Telnyx's 3+3 delivery attempts (SPEC §4.3, §7).
      webhook_failover_url: webhook,
      // SMS-pumping defense layer 1 (SPEC §10): US + Canada only.
      whitelisted_destinations: ["US", "CA"],
    },
  });
  const profileId = response.data?.id;
  if (!profileId) {
    throw new Error("Telnyx messaging profile create returned no id");
  }
  const { error } = await db
    .from("companies")
    .update({ telnyx_messaging_profile_id: profileId })
    .eq("id", company.id)
    .is("telnyx_messaging_profile_id", null);
  if (error) {
    throw new Error(`messaging profile persist failed: ${error.message}`);
  }
  company.telnyx_messaging_profile_id = profileId;
  return profileId;
}

/**
 * S2 — inventory search by NDC, falling back to the area code's region from
 * the shared NANP table (SPEC §4.3: numbers must appear in a recent search to
 * be orderable).
 */
async function searchAvailableNumber(
  env: Env,
  country: string,
  areaCode: string,
): Promise<string> {
  const baseQuery = {
    "filter[country_code]": country,
    "filter[features]": "sms",
    "filter[phone_number_type]": "local",
  };
  const byNdc = await telnyxRequest<AvailableNumbersResponse>(env, {
    method: "GET",
    path: "/v2/available_phone_numbers",
    query: { ...baseQuery, "filter[national_destination_code]": areaCode },
  });
  const ndcHit = byNdc.data?.find((entry) => entry.phone_number);
  if (ndcHit?.phone_number) return ndcHit.phone_number;

  const entry = NANP_AREA_CODES[areaCode];
  const region = entry?.geographic ? entry.region : null;
  if (region) {
    const byRegion = await telnyxRequest<AvailableNumbersResponse>(env, {
      method: "GET",
      path: "/v2/available_phone_numbers",
      query: { ...baseQuery, "filter[administrative_area]": region },
    });
    const regionHit = byRegion.data?.find((item) => item.phone_number);
    if (regionHit?.phone_number) return regionHit.phone_number;
  }

  throw new Error(
    `no ${country} inventory for area code ${areaCode}` +
      (region ? ` or region ${region}` : ""),
  );
}

/**
 * Resolve the Telnyx phone-number resource id for an owned number — the id
 * used by `DELETE /v2/phone_numbers/{id}` on release. Listed (not taken from
 * the order response) because the list is the documented authority for owned
 * numbers.
 */
async function lookupOwnedNumber(
  env: Env,
  e164: string,
): Promise<{ id: string; phone_number: string } | null> {
  const response = await telnyxRequest<PhoneNumbersListResponse>(env, {
    method: "GET",
    path: "/v2/phone_numbers",
    query: { "filter[phone_number]": e164 },
  });
  const match = response.data?.find(
    (item) => item.phone_number === e164 && item.id,
  );
  return match ? { id: match.id as string, phone_number: e164 } : null;
}

/** Mark a row active with its purchased number identifiers. */
async function activateRow(
  db: SupabaseClient,
  row: PhoneNumberRow,
  numberE164: string,
  telnyxPhoneNumberId: string | null,
): Promise<PhoneNumberRow> {
  return updateNumberRow(db, row.id, {
    status: "active",
    number_e164: numberE164,
    telnyx_phone_number_id: telnyxPhoneNumberId,
    last_provision_error: null,
    suspended_at: null,
  });
}

/**
 * Crash-after-buy recovery half 1: a persisted order id is completed from the
 * order resource. Returns the updated row when the order finished, the row
 * unchanged while the order is still pending, or null when there is no order
 * to recover (caller continues the saga).
 */
async function recoverFromOrder(
  env: Env,
  db: SupabaseClient,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow | null> {
  if (!row.telnyx_order_id) return null;
  const order = await telnyxRequest<NumberOrderResponse>(env, {
    method: "GET",
    path: `/v2/number_orders/${row.telnyx_order_id}`,
  });
  const status = order.data?.status;
  const orderedNumber = order.data?.phone_numbers?.[0]?.phone_number ?? null;
  if (status === "success" && orderedNumber) {
    const owned = await lookupOwnedNumber(env, orderedNumber);
    return activateRow(db, row, orderedNumber, owned?.id ?? null);
  }
  if (status === "pending") return row; // order in flight — wait, don't reorder
  // Failed/unknown order: clear it so the retry path orders fresh.
  throw new Error(
    `number order ${row.telnyx_order_id} finished as '${status ?? "unknown"}'`,
  );
}

/**
 * Crash-after-buy recovery half 2 (§4.3 failure handling, §11): list the
 * Telnyx numbers tagged `customer_reference = company_id` and adopt one no
 * row knows about instead of ordering again.
 */
async function adoptOrphanNumber(
  env: Env,
  db: SupabaseClient,
  company: ProvisioningCompany,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow | null> {
  const owned = await telnyxRequest<PhoneNumbersListResponse>(env, {
    method: "GET",
    path: "/v2/phone_numbers",
    query: { "filter[customer_reference]": company.id },
  });
  const candidates = owned.data ?? [];
  if (candidates.length === 0) return null;

  const { data, error } = await db
    .from("phone_numbers")
    .select("number_e164,telnyx_phone_number_id")
    .eq("company_id", company.id)
    .neq("status", "released");
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const knownE164 = new Set(
    (data ?? [])
      .map((item) => (item as { number_e164: string | null }).number_e164)
      .filter(Boolean),
  );
  const knownIds = new Set(
    (data ?? [])
      .map(
        (item) =>
          (item as { telnyx_phone_number_id: string | null })
            .telnyx_phone_number_id,
      )
      .filter(Boolean),
  );

  const orphan = candidates.find(
    (item) =>
      item.id &&
      item.phone_number &&
      !knownIds.has(item.id) &&
      !knownE164.has(item.phone_number),
  );
  if (!orphan) return null;
  return activateRow(db, row, orphan.phone_number as string, orphan.id as string);
}

/** S2 + S3 for one row — search, order, persist-order-id-first, activate. */
async function orderNumberForRow(
  env: Env,
  db: SupabaseClient,
  company: ProvisioningCompany,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow> {
  const profileId = await ensureMessagingProfile(env, db, company);
  const areaCode = row.requested_area_code ?? company.requested_area_code;
  const phoneNumber = await searchAvailableNumber(env, row.country, areaCode);

  const order = await telnyxRequest<NumberOrderResponse>(env, {
    method: "POST",
    path: "/v2/number_orders",
    body: {
      phone_numbers: [{ phone_number: phoneNumber }],
      messaging_profile_id: profileId,
      customer_reference: company.id,
    },
  });
  const orderId = order.data?.id;
  if (!orderId) throw new Error("Telnyx number order returned no id");

  // Persist the order id IMMEDIATELY (SPEC §4.3 S3) — from here on a crash is
  // recoverable from the order resource, never a double purchase.
  await updateNumberRow(db, row.id, { telnyx_order_id: orderId });
  row = { ...row, telnyx_order_id: orderId };

  if (order.data?.status === "success") {
    const owned = await lookupOwnedNumber(env, phoneNumber);
    return activateRow(db, row, phoneNumber, owned?.id ?? null);
  }
  // Order accepted but still processing — the 15-minute cron completes it
  // from the persisted order id. The row stays 'provisioning'.
  return row;
}

/**
 * §4.3 failure handling: `status='provision_failed'`, error stored, attempts
 * incremented, Sentry event; owner+admin email on the FIRST failure (the
 * customer-facing "taking longer than usual" note — SPEC copy, no action
 * required); Sentry escalation when the attempt budget is exhausted.
 */
async function recordProvisionFailure(
  env: Env,
  db: SupabaseClient,
  company: ProvisioningCompany,
  row: PhoneNumberRow,
  cause: unknown,
): Promise<PhoneNumberRow> {
  const attempts = row.provision_attempts + 1;
  const message = cause instanceof Error ? cause.message : String(cause);
  Sentry.captureException(cause);
  if (attempts >= MAX_PROVISION_ATTEMPTS) {
    Sentry.captureMessage(
      `number provisioning exhausted ${attempts} attempts for company ${company.id}`,
      "fatal",
    );
  }

  const updated = await updateNumberRow(db, row.id, {
    status: "provision_failed",
    last_provision_error: message.slice(0, 2000),
    provision_attempts: attempts,
  });

  if (row.provision_attempts === 0) {
    try {
      const to = await billingRecipients(env, company.id, db);
      if (to.length > 0) {
        await sendEmail(env, { to, ...provisioningDelayedCopy(company.name) });
      }
    } catch (emailError) {
      // The email is best-effort; the failure record is the durable state.
      Sentry.captureException(emailError);
    }
  }
  return updated;
}

/**
 * Run (or resume) the saga for one existing row: recover a persisted order,
 * adopt a Telnyx-side orphan, else search + order. Errors are recorded via
 * {@link recordProvisionFailure} — this never throws; the returned row's
 * status says what happened (the §11 cron retries `provision_failed`).
 */
export async function resumeProvisioning(
  env: Env,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow> {
  const db = getDb(env);
  const company = await fetchCompany(db, row.company_id);
  try {
    const fromOrder = await recoverFromOrder(env, db, row);
    if (fromOrder) return fromOrder;
  } catch (cause) {
    // A dead order id must not wedge the row forever: clear it, record the
    // failure, and let the next retry order fresh.
    const cleared = await updateNumberRow(db, row.id, { telnyx_order_id: null });
    return recordProvisionFailure(env, db, company, cleared, cause);
  }
  try {
    const adopted = await adoptOrphanNumber(env, db, company, row);
    if (adopted) return adopted;
    return await orderNumberForRow(env, db, company, row);
  } catch (cause) {
    return recordProvisionFailure(env, db, company, row, cause);
  }
}

/**
 * Entry point for the ONLY initial-provisioning trigger — the paid
 * `checkout.session.completed` webhook (SPEC §4.1 step 5, §9, §10).
 *
 * Returns the company's provisioning row, or null when the saga skipped
 * because a non-released number already exists under a different key (§9
 * resubscribe-within-grace: the checkout handler un-suspends instead).
 * Never throws for saga-step failures — those land on the row as
 * `provision_failed` for the §11 cron; only infrastructure failures
 * (database unreachable) propagate, so the webhook ledger retries them.
 */
export async function provisionCompanyNumber(
  env: Env,
  input: { companyId: string; checkoutSessionId: string },
): Promise<PhoneNumberRow | null> {
  const db = getDb(env);
  const company = await fetchCompany(db, input.companyId);

  // §9: resubscribe-within-grace — a non-released number (from a previous
  // checkout / provision request) means nothing to provision here.
  const { data: existing, error: existingError } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("company_id", company.id)
    .neq("status", "released");
  if (existingError) {
    throw new Error(`phone_numbers lookup failed: ${existingError.message}`);
  }
  const rows = (existing ?? []) as unknown as PhoneNumberRow[];
  const foreign = rows.find(
    (row) => row.provisioning_key !== input.checkoutSessionId,
  );
  if (foreign) return null;

  // Insert-first idempotency: the unique provisioning_key makes duplicate
  // webhook deliveries converge on one row (SPEC §4.3).
  const { data: inserted, error: insertError } = await db
    .from("phone_numbers")
    .upsert(
      {
        company_id: company.id,
        status: "provisioning",
        provisioning_key: input.checkoutSessionId,
        requested_area_code: company.requested_area_code,
        country: company.country,
      },
      { onConflict: "provisioning_key", ignoreDuplicates: true },
    )
    .select(NUMBER_COLUMNS);
  if (insertError) {
    throw new Error(`phone_numbers insert failed: ${insertError.message}`);
  }

  let row = (inserted?.[0] ?? null) as unknown as PhoneNumberRow | null;
  if (!row) {
    // Conflict → the row already exists for this checkout session.
    const { data, error } = await db
      .from("phone_numbers")
      .select(NUMBER_COLUMNS)
      .eq("provisioning_key", input.checkoutSessionId)
      .limit(1);
    if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
    row = (data?.[0] ?? null) as unknown as PhoneNumberRow | null;
    if (!row) throw new Error("provisioning row conflict but no row found");
    // Duplicate delivery for a finished (or suspended/released) row: no-op.
    if (row.status !== "provisioning" && row.status !== "provision_failed") {
      return row;
    }
  }

  return resumeProvisioning(env, row);
}

/**
 * Cancellation → suspension (SPEC §1 rule 2, §9): app-side only — inbound
 * keeps flowing and being stored; outbound is blocked by the subscription
 * gate. Returns the suspended rows.
 */
export async function suspendCompanyNumbers(
  env: Env,
  companyId: string,
): Promise<PhoneNumberRow[]> {
  const db = getDb(env);
  const { data, error } = await db
    .from("phone_numbers")
    .update({ status: "suspended", suspended_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("status", "active")
    .select(NUMBER_COLUMNS);
  if (error) throw new Error(`number suspension failed: ${error.message}`);
  return (data ?? []) as unknown as PhoneNumberRow[];
}

/**
 * Release one row: hand the number back to Telnyx (tolerating "already gone"),
 * then mark the row `released` (rows are retained forever — SPEC §6). Used by
 * the grace-expiry job via {@link releaseCompanyNumbers} and by
 * `DELETE /v1/numbers/:id` (§12 step 18).
 */
export async function releaseNumberRow(
  env: Env,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow> {
  if (row.status === "released") return row;
  if (row.telnyx_phone_number_id) {
    try {
      await telnyxRequest(env, {
        method: "DELETE",
        path: `/v2/phone_numbers/${row.telnyx_phone_number_id}`,
      });
    } catch (cause) {
      // Already released on the Telnyx side → converge; anything else must
      // keep the row un-released so the daily cron retries.
      if (!(cause instanceof TelnyxApiError && cause.status === 404)) {
        throw cause;
      }
    }
  }
  return updateNumberRow(getDb(env), row.id, {
    status: "released",
    released_at: new Date().toISOString(),
  });
}

/**
 * Grace-expiry release (SPEC §9, §11): release every non-released number the
 * company has. One number's failure doesn't stop the others; failures are
 * re-thrown in aggregate so the caller's retry machinery sees them.
 */
export async function releaseCompanyNumbers(
  env: Env,
  companyId: string,
): Promise<PhoneNumberRow[]> {
  const db = getDb(env);
  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("company_id", companyId)
    .neq("status", "released");
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  const released: PhoneNumberRow[] = [];
  const failures: unknown[] = [];
  for (const row of (data ?? []) as unknown as PhoneNumberRow[]) {
    try {
      released.push(await releaseNumberRow(env, row));
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `number release failed for ${failures.length} of ${(data ?? []).length} numbers`,
    );
  }
  return released;
}

/** Exponential backoff gate for the §11 retry cron (minutes: 1,2,4,8,16). */
function retryDue(row: PhoneNumberRow, now: Date): boolean {
  if (!row.updated_at) return true;
  const waitMs = 2 ** row.provision_attempts * 60_000;
  return now.getTime() - new Date(row.updated_at).getTime() >= waitMs;
}

export interface ReconcileSummary {
  retried: number;
  activated: number;
  orphansFlagged: number;
}

/**
 * §11 "provisioning retry & reconcile" cron body (every 15 minutes):
 *
 *  1. Resume every `provisioning`/`provision_failed` row under the attempt
 *     budget (with per-attempt exponential backoff), for companies that are
 *     not canceled — resumption itself recovers persisted orders and adopts
 *     `customer_reference`-tagged orphans before ever ordering again.
 *  2. Compare ALL Telnyx-owned numbers against `phone_numbers` and flag any
 *     the database does not know — a number costing money that no tenant is
 *     using is an operator page, not a silent leak (§4.3 failure handling).
 */
export async function reconcileNumbers(
  env: Env,
  now: Date = new Date(),
): Promise<ReconcileSummary> {
  const db = getDb(env);
  const summary: ReconcileSummary = { retried: 0, activated: 0, orphansFlagged: 0 };

  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .in("status", ["provisioning", "provision_failed"]);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  for (const row of (data ?? []) as unknown as PhoneNumberRow[]) {
    if (row.provision_attempts >= MAX_PROVISION_ATTEMPTS) continue;
    if (!retryDue(row, now)) continue;
    const { data: companyRows, error: companyError } = await db
      .from("companies")
      .select("id,subscription_status")
      .eq("id", row.company_id)
      .limit(1);
    if (companyError) {
      throw new Error(`companies lookup failed: ${companyError.message}`);
    }
    const status = (companyRows?.[0] as { subscription_status?: string })
      ?.subscription_status;
    if (status === "canceled") continue; // grace/release path owns these

    summary.retried += 1;
    const result = await resumeProvisioning(env, row);
    if (result.status === "active") summary.activated += 1;
  }

  // Orphan scan: every Telnyx-owned number must be known to phone_numbers.
  const { data: knownRows, error: knownError } = await db
    .from("phone_numbers")
    .select("number_e164,telnyx_phone_number_id")
    .neq("status", "released");
  if (knownError) {
    throw new Error(`phone_numbers lookup failed: ${knownError.message}`);
  }
  const knownE164 = new Set(
    (knownRows ?? [])
      .map((item) => (item as { number_e164: string | null }).number_e164)
      .filter(Boolean),
  );
  const knownIds = new Set(
    (knownRows ?? [])
      .map(
        (item) =>
          (item as { telnyx_phone_number_id: string | null })
            .telnyx_phone_number_id,
      )
      .filter(Boolean),
  );

  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const listing = await telnyxRequest<PhoneNumbersListResponse>(env, {
      method: "GET",
      path: "/v2/phone_numbers",
      query: { "page[size]": "250", "page[number]": String(page) },
    });
    totalPages = listing.meta?.total_pages ?? 1;
    for (const owned of listing.data ?? []) {
      if (!owned.id) continue;
      if (knownIds.has(owned.id)) continue;
      if (owned.phone_number && knownE164.has(owned.phone_number)) continue;
      summary.orphansFlagged += 1;
      // IDs only — never the number itself (SPEC §10 telemetry policy).
      Sentry.captureMessage(
        `reconcile: Telnyx number ${owned.id} (customer_reference=${owned.customer_reference ?? "none"}) is unknown to phone_numbers`,
        "warning",
      );
    }
    page += 1;
  }

  return summary;
}
