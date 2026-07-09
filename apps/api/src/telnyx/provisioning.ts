import { NANP_AREA_CODES } from "@loonext/shared";
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest, TelnyxApiError } from "./client";
import { provisioningDelayedCopy } from "./emails";
// Type-only (erased at runtime): a VALUE import here would close a module
// cycle with text-enablement.ts (which reuses ensureMessagingProfile /
// fetchProvisioningCompany from this file) and break module init under
// vite-node — so the hosted release below re-issues the two Telnyx DELETEs
// itself instead of calling cancelTextEnablement.
import type { TextEnablementOrderRow } from "./text-enablement";
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

/**
 * A coarse, customer-SAFE classification of why a number provision failed, so
 * the UI can tell the truth ("no numbers in 416, pick another") and offer the
 * right action without ever leaking the raw vendor error. `no_inventory` is the
 * common, user-actionable case (an exhausted area code); `carrier` is any other
 * Telnyx-side rejection; `unknown` is everything else.
 */
export type ProvisionFailureReason = "no_inventory" | "carrier" | "unknown";

export interface PhoneNumberRow {
  id: string;
  company_id: string;
  status: "provisioning" | "active" | "suspended" | "released" | "provision_failed";
  /**
   * How the row gets its number: 'provisioned' = this saga buys inventory;
   * 'ported' = the port saga (PORTING.md §4) fulfils it; 'hosted' = the
   * text-enablement saga (keep-your-number) adds SMS to an owner-kept number.
   * ONLY 'provisioned' rows may ever be searched/ordered against — running the
   * buy saga on a ported/hosted row would purchase a random new number and
   * overwrite the owner's own number on the row.
   */
  source: "provisioned" | "ported" | "hosted";
  provisioning_key: string;
  requested_area_code: string | null;
  country: string;
  number_e164: string | null;
  telnyx_phone_number_id: string | null;
  telnyx_order_id: string | null;
  provision_attempts: number;
  last_provision_error: string | null;
  /** Coarse, customer-safe failure classification; null until a failure, cleared on activation. */
  provision_failure_reason: ProvisionFailureReason | null;
  /** A user-picked specific number to order exactly; null = auto-search. Cleared on activation / taken-fallback. */
  chosen_number_e164: string | null;
  updated_at?: string;
}

/** The NANP area code (NDC) of a +1 E.164, or null if not a NANP number. */
export function areaCodeOf(e164: string): string | null {
  return /^\+1(\d{3})\d{7}$/.exec(e164)?.[1] ?? null;
}

export interface ProvisioningCompany {
  id: string;
  name: string;
  country: string;
  requested_area_code: string;
  telnyx_messaging_profile_id: string | null;
  subscription_status: string;
  /** A number the user picked in onboarding, staged pre-checkout; drained onto the row here. */
  chosen_number_e164: string | null;
}

const COMPANY_COLUMNS =
  "id,name,country,requested_area_code,telnyx_messaging_profile_id," +
  "subscription_status,chosen_number_e164";

const NUMBER_COLUMNS =
  "id,company_id,status,source,provisioning_key,requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,provision_failure_reason,chosen_number_e164,updated_at";

/** SPEC §4.3: Sentry escalates (page the operator) after 5 failed attempts. */
export const MAX_PROVISION_ATTEMPTS = 5;

/**
 * Fetch the provisioning-shaped company row. Exported for the port saga
 * (PORTING.md §4 P1), which builds the same `ProvisioningCompany` to hand to
 * {@link ensureMessagingProfile} — reusing the profile machinery, not forking
 * it.
 */
export async function fetchProvisioningCompany(
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

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<ProvisioningCompany> {
  return fetchProvisioningCompany(db, companyId);
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

/**
 * S1 — one Telnyx messaging profile per company (D2), created once.
 *
 * Exported for the port saga (PORTING.md §4 P1 / Verification correction 1):
 * a port creates the same per-company profile up front and reuses this exact
 * helper — never a parallel one. The port saga passes its own fetched company
 * row (same `ProvisioningCompany` shape).
 */
export async function ensureMessagingProfile(
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

  // Telnyx answers a filter combination with NO matching inventory with a 400
  // (code 10031), NOT an empty 200 — common for exhausted area codes (e.g. 416
  // Toronto). Treat that as "nothing here" and fall through instead of aborting
  // the whole saga; any other Telnyx error still propagates (the §11 cron
  // retries it).
  // Only fully-revealed numbers are individually orderable. Telnyx MASKS some
  // inventory (e.g. Canadian numbers read "+18253------") that this account
  // level cannot order directly (number_reservations returns 10038); ordering a
  // masked number fails with 10027 — so a masked entry is NEVER a hit.
  let sawMasked = false;
  const isOrderable = (n: string): boolean => /^\+1\d{10}$/.test(n);
  const searchOnce = async (
    extra: Record<string, string>,
  ): Promise<string | null> => {
    try {
      const res = await telnyxRequest<AvailableNumbersResponse>(env, {
        method: "GET",
        path: "/v2/available_phone_numbers",
        query: { ...baseQuery, ...extra },
      });
      const numbers = res.data ?? [];
      const hit = numbers.find(
        (entry) => entry.phone_number && isOrderable(entry.phone_number),
      )?.phone_number;
      if (!hit && numbers.some((entry) => entry.phone_number)) {
        sawMasked = true; // inventory exists but is masked/un-orderable
      }
      return hit ?? null;
    } catch (error) {
      if (error instanceof TelnyxApiError && error.hasCode("10031")) return null;
      throw error;
    }
  };

  // 1. The exact requested area code (NDC).
  const byNdc = await searchOnce({
    "filter[national_destination_code]": areaCode,
  });
  if (byNdc) return byNdc;

  // 2. The area code's state/province from the shared NANP table — a nearby
  //    local number keeps the business's regional presence (416 → ON → 647/437).
  const entry = NANP_AREA_CODES[areaCode];
  const region = entry?.geographic ? entry.region : null;
  if (region) {
    const byRegion = await searchOnce({ "filter[administrative_area]": region });
    if (byRegion) return byRegion;
  }

  // 3. Last resort: any SMS-capable local number in the country, so a PAID
  //    company is never stranded when the requested area code AND its region
  //    are dry. Only geography is dropped — features stay strict (sms + local)
  //    so a fallback number is never unusable.
  const byCountry = await searchOnce({});
  if (byCountry) {
    console.warn(
      `[provisioning] ${country} area code ${areaCode}` +
        (region ? ` and region ${region}` : "") +
        " had no inventory; assigned a country-wide fallback number",
    );
    return byCountry;
  }

  if (sawMasked) {
    // The country's inventory is masked / un-orderable at this Telnyx account
    // level (number_reservations → 10038). This is an OPERATOR problem, not the
    // customer's — alert loudly with the actionable cause so it gets fixed, and
    // fail honestly rather than ordering a masked number (10027) on a loop that
    // shows a false "still setting up".
    Sentry.captureMessage(
      `Provisioning blocked: ${country} numbers are masked and un-orderable at this Telnyx account ` +
        `level (number_reservations returns 10038). Upgrade/verify the Telnyx account to order ${country} numbers.`,
      "error",
    );
    throw new Error(
      `no orderable ${country} inventory: numbers are masked (Telnyx account upgrade required for ${country})`,
    );
  }

  throw new Error(
    `no ${country} inventory for area code ${areaCode}` +
      (region ? `, region ${region},` : "") +
      " or country-wide",
  );
}

/**
 * Resolve the Telnyx phone-number resource id for an owned number — the id
 * used by `DELETE /v2/phone_numbers/{id}` on release. Listed (not taken from
 * the order response) because the list is the documented authority for owned
 * numbers.
 *
 * Exported for the port saga (PORTING.md §4 P6a / Verification correction 1):
 * once voice ports, the ported number becomes Telnyx-owned and the saga
 * resolves its `telnyx_phone_number_id` through this same listing.
 */
export async function lookupOwnedNumber(
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
    provision_failure_reason: null,
    // The pick is fulfilled (or was replaced by a fallback) — clear it so a
    // later re-provision never re-applies a stale choice.
    chosen_number_e164: null,
    suspended_at: null,
  });
}

/**
 * A persisted order id that Telnyx AUTHORITATIVELY reports as dead
 * (`failed`/unknown) — distinct from a transport/5xx failure while the order
 * may still be in flight. Only THIS signal is safe to clear `telnyx_order_id`
 * on; clearing on a transient GET error would discard the recovery pointer for
 * an order that could still succeed, and the next retry would buy a SECOND
 * number (a real double-purchase / cost leak). See {@link resumeProvisioning}.
 */
class OrderDeadError extends Error {
  constructor(orderId: string, status: string) {
    super(`number order ${orderId} finished as '${status}'`);
    this.name = "OrderDeadError";
  }
}

/**
 * Crash-after-buy recovery half 1: a persisted order id is completed from the
 * order resource. Returns the updated row when the order finished, the row
 * unchanged while the order is still pending, or null when there is no order
 * to recover (caller continues the saga).
 *
 * Throws {@link OrderDeadError} ONLY when Telnyx authoritatively reports the
 * order failed/unknown (the caller then clears the id and reorders fresh). A
 * transport/5xx failure propagates as its original error — the order may still
 * be pending, so the caller MUST keep the id and re-GET it next pass rather than
 * ordering a duplicate.
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
  // Authoritatively dead (failed/unknown): safe to clear + reorder fresh.
  throw new OrderDeadError(row.telnyx_order_id, status ?? "unknown");
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

function placeNumberOrder(
  env: Env,
  phoneNumber: string,
  profileId: string,
  companyId: string,
): Promise<NumberOrderResponse> {
  return telnyxRequest<NumberOrderResponse>(env, {
    method: "POST",
    path: "/v2/number_orders",
    body: {
      phone_numbers: [{ phone_number: phoneNumber }],
      messaging_profile_id: profileId,
      customer_reference: companyId,
    },
  });
}

/** S2 + S3 for one row — pick, order, persist-order-id-first, activate. */
async function orderNumberForRow(
  env: Env,
  db: SupabaseClient,
  company: ProvisioningCompany,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow> {
  const profileId = await ensureMessagingProfile(env, db, company);

  // A user-CHOSEN specific number (onboarding pick / remediation) is ordered
  // EXACTLY. Otherwise, auto-search the requested area code (unchanged path).
  const chosen = row.chosen_number_e164;
  let phoneNumber = chosen ?? null;
  if (!phoneNumber) {
    const areaCode = row.requested_area_code ?? company.requested_area_code;
    phoneNumber = await searchAvailableNumber(env, row.country, areaCode);
  }

  let order: NumberOrderResponse;
  try {
    order = await placeNumberOrder(env, phoneNumber, profileId, company.id);
  } catch (error) {
    // A raced chosen number — taken/expired in the seconds since the pick —
    // is a Telnyx 4xx. Drop the pick and fall back to a search in the SAME
    // area code the user picked from, so they still get a nearby local number
    // rather than being stranded. A non-4xx (transport/5xx) propagates: the
    // order may be in flight, so we must NOT reorder (double-buy).
    if (
      chosen &&
      error instanceof TelnyxApiError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      await updateNumberRow(db, row.id, { chosen_number_e164: null });
      row = { ...row, chosen_number_e164: null };
      const areaCode =
        areaCodeOf(chosen) ??
        row.requested_area_code ??
        company.requested_area_code;
      phoneNumber = await searchAvailableNumber(env, row.country, areaCode);
      order = await placeNumberOrder(env, phoneNumber, profileId, company.id);
    } else {
      throw error;
    }
  }

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
/**
 * Coarse, customer-safe classification of a provisioning failure — the ONLY
 * failure detail exposed to the client (the raw message stays server-side).
 * A no-inventory 400 (code 10031) or the "no <country> inventory for area
 * code…" exhaustion Error is the common, user-actionable case (pick another);
 * any other Telnyx rejection is `carrier`; everything else is `unknown`.
 */
function classifyProvisionFailure(cause: unknown): ProvisionFailureReason {
  if (cause instanceof TelnyxApiError) {
    return cause.hasCode("10031") ? "no_inventory" : "carrier";
  }
  if (cause instanceof Error && /no .*inventory/i.test(cause.message)) {
    return "no_inventory";
  }
  return "unknown";
}

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
    provision_failure_reason: classifyProvisionFailure(cause),
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
  // Belt-and-braces: this saga BUYS inventory, so it must never run on a
  // keep-your-number row. A ported row is fulfilled by the port saga and a
  // hosted row by the text-enablement saga — ordering here would purchase a
  // random new number and overwrite the owner's own number_e164.
  if (row.source !== "provisioned") {
    Sentry.captureMessage(
      `resumeProvisioning called on a source='${row.source}' row ${row.id} — skipped`,
      "warning",
    );
    return row;
  }
  const db = getDb(env);
  const company = await fetchCompany(db, row.company_id);
  try {
    const fromOrder = await recoverFromOrder(env, db, row);
    if (fromOrder) return fromOrder;
  } catch (cause) {
    if (cause instanceof OrderDeadError) {
      // Telnyx AUTHORITATIVELY reported the order dead: clear the id so the next
      // retry orders fresh (no live order exists to double-buy against).
      const cleared = await updateNumberRow(db, row.id, {
        telnyx_order_id: null,
      });
      return recordProvisionFailure(env, db, company, cleared, cause);
    }
    // Transport/5xx while the order may still be PENDING: keep telnyx_order_id
    // so the next retry re-GETs the SAME order. Clearing it here would strand a
    // possibly-succeeding order and let orderNumberForRow buy a second number.
    return recordProvisionFailure(env, db, company, row, cause);
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
 *
 * `bridge: true` (PORTING.md D16: the opt-in tide-me-over number bought
 * alongside a port, keyed `${sessionId}:bridge:${portId}`) narrows the
 * foreign-row guard to `source='provisioned'` rows only — the port's own
 * `source='ported'` row ALWAYS exists by webhook time and would otherwise
 * silently veto the very bridge the wizard promised. The `provisioning_key`
 * idempotency is unchanged, so duplicate deliveries still converge on ONE
 * bridge row, and a foreign provisioned number (the company can already
 * text) still skips the purchase.
 */
export async function provisionCompanyNumber(
  env: Env,
  input: { companyId: string; checkoutSessionId: string; bridge?: boolean },
): Promise<PhoneNumberRow | null> {
  const db = getDb(env);
  const company = await fetchCompany(db, input.companyId);

  // §9: resubscribe-within-grace — a non-released number (from a previous
  // checkout / provision request) means nothing to provision here. A bridge
  // call ignores ported/hosted rows in this decision (they are fulfilled by
  // their own sagas and say nothing about whether the company can text
  // today); a normal call must NOT — the ported row is exactly what stops
  // the paid webhook double-provisioning a port-only signup.
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
    (row) =>
      row.provisioning_key !== input.checkoutSessionId &&
      (input.bridge !== true || row.source === "provisioned"),
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
        // Carry the onboarding pick onto the row so orderNumberForRow buys the
        // EXACT number (falling back in-region if it was taken). Null = auto.
        chosen_number_e164: company.chosen_number_e164,
      },
      { onConflict: "provisioning_key", ignoreDuplicates: true },
    )
    .select(NUMBER_COLUMNS);
  if (insertError) {
    throw new Error(`phone_numbers insert failed: ${insertError.message}`);
  }

  // Drain the pre-checkout staging on the company so a later re-provision never
  // re-applies a stale pick (the durable copy now lives on the row above). Only
  // on the first delivery — a duplicate webhook finds it already null.
  if (company.chosen_number_e164) {
    const { error: drainError } = await db
      .from("companies")
      .update({ chosen_number_e164: null })
      .eq("id", company.id);
    if (drainError) {
      throw new Error(`company chosen-number drain failed: ${drainError.message}`);
    }
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
 * Release one row: undo the Telnyx side (tolerating "already gone"), then mark
 * the row `released` (rows are retained forever — SPEC §6). Used by the
 * grace-expiry job via {@link releaseCompanyNumbers} and by
 * `DELETE /v1/numbers/:id` (§12 step 18).
 *
 * Purchased/ported rows own a Telnyx phone-number resource → DELETE
 * /v2/phone_numbers/{id}. A source='hosted' row owns NO Telnyx number (voice
 * stays on the owner's carrier) — its Telnyx side is the hosted-messaging
 * ORDER: cancelled while non-terminal, or the live hosted NUMBER deleted
 * (DELETE /v2/messaging_hosted_numbers/{id}) once 'completed'; the order row
 * is then marked cancelled. In every branch, only a Telnyx 404 (already gone)
 * lets the row converge to released — any other Telnyx failure keeps it
 * un-released for the daily cron to retry.
 */
export async function releaseNumberRow(
  env: Env,
  row: PhoneNumberRow,
): Promise<PhoneNumberRow> {
  if (row.status === "released") return row;
  if (row.source === "hosted") {
    const db = getDb(env);
    const { data, error } = await db
      .from("text_enablement_orders")
      .select("id,status,telnyx_hosted_order_id,telnyx_hosted_number_id")
      .eq("phone_number_id", row.id)
      .limit(1);
    if (error) {
      throw new Error(`text_enablement_orders lookup failed: ${error.message}`);
    }
    const order = (data?.[0] ?? null) as Pick<
      TextEnablementOrderRow,
      "id" | "status" | "telnyx_hosted_order_id" | "telnyx_hosted_number_id"
    > | null;
    if (!order) {
      // A hosted row without its order is a data bug worth flagging — but
      // never a reason to keep the slot occupied.
      Sentry.captureMessage(
        `release: hosted row ${row.id} has no text_enablement_orders row`,
        "warning",
      );
    } else if (order.status !== "cancelled") {
      // Telnyx side first (same DELETE calls cancelTextEnablement uses):
      // 'completed' → the live hosted NUMBER; non-terminal → the ORDER
      // ("delete a messaging hosted number order and all associated phone
      // numbers" — the documented cancel; there is no /actions/cancel).
      const path =
        order.status === "completed"
          ? order.telnyx_hosted_number_id
            ? `/v2/messaging_hosted_numbers/${order.telnyx_hosted_number_id}`
            : null
          : order.telnyx_hosted_order_id
            ? `/v2/messaging_hosted_number_orders/${order.telnyx_hosted_order_id}`
            : null;
      if (path) {
        try {
          await telnyxRequest(env, { method: "DELETE", path });
        } catch (cause) {
          if (!(cause instanceof TelnyxApiError && cause.status === 404)) {
            throw cause;
          }
        }
      } else if (order.status === "completed") {
        // Completed but the hosted-number id never landed: nothing
        // addressable to delete — flag it, don't hold the slot.
        Sentry.captureMessage(
          `release: completed enablement ${order.id} has no telnyx_hosted_number_id`,
          "warning",
        );
      }
      const { error: orderError } = await db
        .from("text_enablement_orders")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", order.id);
      if (orderError) {
        throw new Error(
          `text_enablement_orders update failed: ${orderError.message}`,
        );
      }
    }
    return updateNumberRow(db, row.id, {
      status: "released",
      released_at: new Date().toISOString(),
    });
  }
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

  // Work-set: ONLY source='provisioned' rows. Ported rows sit at
  // status='provisioning' for the whole multi-week transfer (the port saga's
  // daily cron owns them) and hosted rows for the multi-day carrier review
  // (reconcileTextEnablement owns them) — resuming the buy saga on either
  // would order a brand-new number over the owner's own one.
  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("source", "provisioned")
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

  // PORTING.md §5.2 orphan-scan exclusion (required edit): an open port row is
  // `status='provisioning'` with number_e164/telnyx_phone_number_id both NULL
  // until P6a adopts the number, so it contributes nothing to knownE164/knownIds
  // — yet the instant voice ports the number becomes Telnyx-owned and appears in
  // the listing, which would falsely page the operator on every port for the
  // whole voice-ported-but-messaging-pending window. Skip any owned number whose
  // E.164 matches a non-cancelled port_requests row (the per-number check).
  const { data: portRows, error: portError } = await db
    .from("port_requests")
    .select("phone_e164")
    .neq("status", "cancelled");
  if (portError) {
    throw new Error(`port_requests lookup failed: ${portError.message}`);
  }
  const portingE164 = new Set(
    (portRows ?? [])
      .map((item) => (item as { phone_e164: string | null }).phone_e164)
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
      // An in-flight port owns this number even before P6a adopts the row.
      if (owned.phone_number && portingE164.has(owned.phone_number)) continue;
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
