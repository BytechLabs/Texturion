import { lookupAreaCode } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { PLAN_LIMITS, type PlanId } from "../billing/plans";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  assertBodyWithinLimit,
  parseJsonBody,
  parseWith,
  pathUuid,
} from "./core/http";
import {
  cancelPortRequest,
  checkPortability,
  hasRequiredDocuments,
  PortDocumentsMissingError,
  startPortSaga,
  submitPortRequest,
  uploadPortDocument,
  type PortabilityResult,
  type PortRequestRow,
} from "../telnyx/porting";
import { fetchRegistrationRows } from "../telnyx/registration";

/**
 * Port-in routes (PORTING.md §6/§7; SPEC §7 conventions: /v1, JWT +
 * X-Company-Id, stable §7 error codes — NO new codes). Mounted by the
 * integration layer under `/v1/port-requests`, behind the /v1 middleware chain.
 * Roles per the §10 matrix: read = any member; check/create/edit/resubmit =
 * owner or admin; cancel = owner only.
 *
 * The pin/account serializer omission (§2.2, §7): responses NEVER return
 * `pin_passcode` or `account_number` — only `has_pin` / `has_account_number`
 * booleans.
 */
export const portingRoutes = new Hono<AppEnv>();

interface PortCompanyRow {
  id: string;
  country: "US" | "CA";
  subscription_status: string;
  plan: PlanId | null;
}

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<PortCompanyRow> {
  const { data, error } = await db
    .from("companies")
    .select("id,country,subscription_status,plan")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as PortCompanyRow | null;
  if (!row) throw new ApiError("not_found", "Company not found.");
  return row;
}

const PORT_COLUMNS =
  "id,company_id,phone_number_id,phone_e164,country,telnyx_porting_order_id," +
  "telnyx_loa_document_id,telnyx_invoice_document_id,entity_name," +
  "auth_person_name,billing_phone_number,account_number,pin_passcode," +
  "is_wireless,ssn_sin_last4,service_street,service_extended,service_locality," +
  "service_admin_area,service_postal_code,foc_datetime_requested,foc_date," +
  "status,messaging_port_status,rejection_reason,submission_count," +
  "wants_bridge_number,bridge_number_id,submitted_at,ported_at,cancelled_at," +
  "created_at,updated_at";

/**
 * PORTING.md §8.2/§9: which of the company's numbers have a FAILED post-port
 * 10DLC campaign assignment (typically the LOSING provider still holds the
 * number in THEIR carrier campaign — only the customer can ask them to release
 * it). The state lives on the campaign row's `data.numberAssignments` ledger
 * (telnyx/registration.ts); the port card renders the §9 "ask your previous
 * texting provider…" guidance from the per-port flag. Assignment first runs at
 * P6b (after voice cutover), so callers only consult this once a port has
 * reached `ported`.
 */
async function assignmentBlockedNumbers(
  db: SupabaseClient,
  companyId: string,
): Promise<ReadonlySet<string>> {
  const { campaign } = await fetchRegistrationRows(db, companyId);
  const blocked = new Set<string>();
  const raw = campaign?.data.numberAssignments;
  if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [e164, state] of Object.entries(raw as Record<string, unknown>)) {
      if (state === "failed") blocked.add(e164);
    }
  }
  return blocked;
}

const NO_BLOCKED_NUMBERS: ReadonlySet<string> = new Set();

/**
 * PORTING.md D16: resolve each port's LIVE bridge number for the serializer.
 * The opt-in tide-me-over number is a normal `phone_numbers` row linked via
 * `bridge_number_id` (written by the paid-checkout webhook); the card shows
 * it only while it is genuinely usable (`status='active'`), so a
 * provisioning/failed/released bridge never renders a number the composer
 * can't send from. Keyed by phone-number row id.
 */
async function bridgeNumbers(
  db: SupabaseClient,
  rows: readonly PortRequestRow[],
): Promise<ReadonlyMap<string, string>> {
  const ids = rows
    .map((row) => row.bridge_number_id)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return NO_BRIDGE_NUMBERS;
  const { data, error } = await db
    .from("phone_numbers")
    .select("id,number_e164,status")
    .in("id", ids)
    .eq("status", "active");
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const live = new Map<string, string>();
  for (const phone of (data ?? []) as {
    id: string;
    number_e164: string | null;
  }[]) {
    if (phone.number_e164) live.set(phone.id, phone.number_e164);
  }
  return live;
}

const NO_BRIDGE_NUMBERS: ReadonlyMap<string, string> = new Map();

/**
 * §2.2 PII policy: pin_passcode + account_number NEVER leave the server —
 * serialize them as on-file booleans only.
 */
function sanitizePort(
  row: PortRequestRow & { created_at?: string | null },
  assignmentBlocked: ReadonlySet<string> = NO_BLOCKED_NUMBERS,
  bridge: ReadonlyMap<string, string> = NO_BRIDGE_NUMBERS,
) {
  return {
    id: row.id,
    phone_e164: row.phone_e164,
    country: row.country,
    status: row.status,
    messaging_port_status: row.messaging_port_status,
    foc_date: row.foc_date,
    foc_datetime_requested: row.foc_datetime_requested,
    rejection_reason: row.rejection_reason,
    submission_count: row.submission_count,
    entity_name: row.entity_name,
    auth_person_name: row.auth_person_name,
    billing_phone_number: row.billing_phone_number,
    service_street: row.service_street,
    service_extended: row.service_extended,
    service_locality: row.service_locality,
    service_admin_area: row.service_admin_area,
    service_postal_code: row.service_postal_code,
    is_wireless: row.is_wireless,
    wants_bridge_number: row.wants_bridge_number,
    bridge_number_id: row.bridge_number_id,
    // D16: the live tide-me-over number, resolved by the GET routes via
    // bridgeNumbers (null while it is still provisioning, or released).
    // Mutation routes serialize with the default; the card re-reads the list.
    bridge_number_e164: row.bridge_number_id
      ? (bridge.get(row.bridge_number_id) ?? null)
      : null,
    has_pin: row.pin_passcode !== null && row.pin_passcode !== undefined,
    has_account_number:
      row.account_number !== null && row.account_number !== undefined,
    // §10: the SSN/SIN last-4 is PII — return only an on-file boolean, never
    // the value.
    has_ssn_sin_last4:
      row.ssn_sin_last4 !== null && row.ssn_sin_last4 !== undefined,
    has_loa: row.telnyx_loa_document_id !== null,
    has_invoice: row.telnyx_invoice_document_id !== null,
    // §8.2/§9: post-port 10DLC assignment FAILED — the card's "ask your
    // previous texting provider…" guidance keys off this. Definitionally
    // false pre-cutover, so mutation routes serialize with the default.
    assignment_blocked: assignmentBlocked.has(row.phone_e164),
    submitted_at: row.submitted_at,
    ported_at: row.ported_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at ?? null,
  };
}

async function loadPort(
  db: SupabaseClient,
  companyId: string,
  portId: string,
): Promise<PortRequestRow | null> {
  const { data, error } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .eq("id", portId)
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  return (data?.[0] ?? null) as unknown as PortRequestRow | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const e164Schema = z
  .string()
  .trim()
  .regex(/^\+1[2-9]\d{9}$/, "must be a +1 US/CA E.164 number");

/**
 * Portability classification shared by the check route and the create gate:
 * a number is portable in-scope only when it strictly parses as a US/CA local
 * (geographic) number. Toll-free / non-US-CA is rejected with validation_failed
 * (D16 scope).
 */
function classifyNumber(e164: string): {
  ok: boolean;
  country: "US" | "CA" | null;
  reason: string | null;
} {
  const entry = lookupAreaCode(e164);
  if (!entry) {
    return {
      ok: false,
      country: null,
      reason: "This number isn't a US or Canadian number we can transfer.",
    };
  }
  if (!entry.geographic) {
    return {
      ok: false,
      country: entry.country,
      reason:
        "Toll-free numbers can't be transferred in this flow. Start with a new local number instead.",
    };
  }
  return { ok: true, country: entry.country, reason: null };
}

const checkBodySchema = z.strictObject({ phone_e164: e164Schema });

/**
 * Interpret a Telnyx portability-check result (§3.1) into the two facts the
 * check route and the create gate both need: whether the number is portable
 * in-scope, and whether it is a wireless/mobile number (which drives the
 * PIN + SSN/SIN-last-4 requirement, §2.2). Telnyx may flag a local number as
 * non-portable (already porting, pending disconnect, …) or as toll-free by
 * record type even when the area code looked geographic — surface that honestly.
 * Shared so both routes classify identically.
 */
function interpretPortability(result: PortabilityResult): {
  portable: boolean;
  isWireless: boolean;
} {
  const type = (result.phoneNumberType ?? "").toLowerCase();
  const portable =
    result.portable && type !== "toll_free" && type !== "tollfree";
  // Telnyx reports wireless/mobile numbers as phone_number_type 'mobile'
  // (a.k.a. 'wireless' in some responses); either flags the PIN + last-4 rule.
  const isWireless = type === "mobile" || type === "wireless";
  return { portable, isWireless };
}

/**
 * POST /v1/port-requests/check — owner/admin (§7). Portability check
 * (pre-payment allowed). No commitment, no DB write. Rejects toll-free /
 * non-US-CA with validation_failed.
 */
portingRoutes.post("/check", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const body = await parseJsonBody(c, checkBodySchema);

  const local = classifyNumber(body.phone_e164);
  if (!local.ok) {
    return errorResponse(c, "validation_failed", local.reason as string);
  }

  const result = await checkPortability(env, body.phone_e164);
  const { portable, isWireless } = interpretPortability(result);
  return c.json({
    portable,
    country: local.country,
    is_wireless: isWireless,
    fast_portable: result.fastPortable,
    messaging_capable: result.messagingCapable,
    reason: portable ? null : result.notPortableReason,
  });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createBodySchema = z.strictObject({
  phone_e164: e164Schema,
  entity_name: z.string().trim().min(1).max(255),
  auth_person_name: z.string().trim().min(1).max(255),
  billing_phone_number: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  account_number: z.string().trim().min(1).max(100),
  pin_passcode: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Wireless ports require the port-out PIN + the LAST 4 of the account holder's
  // SSN/SIN (§2.2 / SPEC §10). We store ONLY the last 4 (the DB CHECK enforces
  // exactly 4 digits); the full SSN/SIN is never collected. Requiredness is
  // decided at runtime from the Telnyx portability check (is_wireless), not the
  // schema — the schema only bounds the shape.
  ssn_sin_last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "must be the last 4 digits of the SSN/SIN")
    .optional(),
  service_street: z.string().trim().min(1).max(255),
  service_extended: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  service_locality: z.string().trim().min(1).max(100),
  service_admin_area: z.string().trim().min(1).max(20),
  service_postal_code: z.string().trim().min(1).max(12),
  foc_datetime_requested: z.iso.datetime({ offset: true }).optional(),
  wants_bridge_number: z.boolean().default(false),
});

const idempotencyKeySchema = z.uuid();

/**
 * POST /v1/port-requests — owner/admin (§7). Create a port request. Requires an
 * Idempotency-Key (client UUID) used as the phone_numbers provisioning_key
 * backstop (§2.3).
 *
 * Gate order (§6): membership (O/A) → US/CA local & portable → no existing
 * non-cancelled port for the number → sole-prop cap → insert port_requests +
 * phone_numbers rows (idempotent on provisioning_key). Onboarding path
 * (subscription incomplete): write the rows in `draft`/`provisioning` and DEFER
 * the Telnyx order to the paid webhook. Post-signup path (active subscription):
 * start startPortSaga immediately in waitUntil.
 */
portingRoutes.post("/", requireRole("admin"), async (c) => {
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
  const body = await parseJsonBody(c, createBodySchema);
  const company = await fetchCompany(db, companyId);

  const local = classifyNumber(body.phone_e164);
  if (!local.ok) {
    return errorResponse(c, "validation_failed", local.reason as string);
  }
  if (local.country !== company.country) {
    return errorResponse(
      c,
      "validation_failed",
      `This number is a ${local.country} number; your company is registered in ${company.country}.`,
    );
  }

  // Post-signup path requires an active subscription; the onboarding path is
  // allowed while incomplete (paid-first defers the Telnyx order to checkout).
  const onboarding = company.subscription_status === "incomplete";
  if (!onboarding && company.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "An active subscription is required to start a number transfer.",
    );
  }

  // Idempotent replay: same Idempotency-Key → return the existing rows.
  const { data: existingByKey, error: keyError } = await db
    .from("phone_numbers")
    .select("id")
    .eq("company_id", companyId)
    .eq("provisioning_key", parsedKey.data)
    .limit(1);
  if (keyError) throw new Error(`phone_numbers lookup failed: ${keyError.message}`);
  if (existingByKey && existingByKey.length > 0) {
    const phoneId = (existingByKey[0] as { id: string }).id;
    const { data: portRows, error: portErr } = await db
      .from("port_requests")
      .select(PORT_COLUMNS)
      .eq("phone_number_id", phoneId)
      .limit(1);
    if (portErr) throw new Error(`port_requests lookup failed: ${portErr.message}`);
    const existingPort = (portRows?.[0] ?? null) as unknown as PortRequestRow | null;
    if (existingPort) return c.json(sanitizePort(existingPort), 200);
  }

  // No non-cancelled port may already exist for this number (§7 conflict).
  const { data: activePorts, error: activeError } = await db
    .from("port_requests")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone_e164", body.phone_e164)
    .neq("status", "cancelled")
    .limit(1);
  if (activeError) {
    throw new Error(`port_requests lookup failed: ${activeError.message}`);
  }
  if (activePorts && activePorts.length > 0) {
    return errorResponse(
      c,
      "conflict",
      "A transfer for this number is already in progress.",
    );
  }

  // §3.1 portability check (part of create, §6 gate order "US/CA local &
  // portable"): run the Telnyx check to (a) reject a number Telnyx reports as
  // not portable with its not_portable_reason, and (b) learn whether the number
  // is WIRELESS — a wireless port additionally requires the port-out PIN and the
  // LAST 4 of the account holder's SSN/SIN (§2.2). We store only the last-4
  // (never the full SSN/SIN, SPEC §10). A landline port needs neither.
  const portability = await checkPortability(env, body.phone_e164);
  const { portable, isWireless } = interpretPortability(portability);
  if (!portable) {
    return errorResponse(
      c,
      "validation_failed",
      portability.notPortableReason
        ? `We can't transfer this number: ${portability.notPortableReason}`
        : "We can't transfer this number — the carrier reports it isn't portable.",
    );
  }
  if (isWireless) {
    if (!body.ssn_sin_last4) {
      return errorResponse(
        c,
        "validation_failed",
        "This is a wireless number — the last 4 digits of the account holder's SSN/SIN are required to transfer it.",
      );
    }
    if (!body.pin_passcode) {
      return errorResponse(
        c,
        "validation_failed",
        "This is a wireless number — the port-out PIN / passcode from your current carrier is required to transfer it.",
      );
    }
  }
  // Never store an SSN/SIN last-4 for a non-wireless port (it isn't collected).
  const ssnSinLast4 = isWireless ? (body.ssn_sin_last4 ?? null) : null;

  // Sole-prop cap / plan cap: a port counts as the one number (D16; §6 gate
  // order "sole-prop cap"). This is the SAME atomic slot claim the provisioned
  // path uses (provision_number_slot) — claim_port_slot locks the company row,
  // counts non-released numbers (a provisioned number and a pending port share
  // the one slot), applies the §4.2 sole-prop cap and the plan limit, and — on
  // 'created' — inserts the source='ported', status='provisioning',
  // porting_status='draft' phone_numbers row. It is idempotent on the
  // provisioning_key (Idempotency-Key replay → 'exists'), so a capped company
  // with an existing active source='provisioned' number can no longer slip a
  // 2nd number in via the port path.
  //
  // p_max_numbers is the plan allowance (billing/plans.ts owns the SPEC §2
  // limits — the RPC enforces, never defines). On the onboarding path the plan
  // is not chosen until checkout, so we pass the minimum allowance (1): a fresh
  // port-only signup (count 0) passes, but a still-incomplete company cannot
  // stack a second number before it has paid for a multi-number plan.
  const maxNumbers =
    company.plan !== null ? PLAN_LIMITS[company.plan].numbers : 1;
  const { data: slotData, error: slotError } = await db.rpc("claim_port_slot", {
    p_company_id: companyId,
    p_provisioning_key: parsedKey.data,
    p_country: local.country,
    p_max_numbers: maxNumbers,
  });
  if (slotError) throw new Error(`claim_port_slot failed: ${slotError.message}`);
  const slot = parseWith(
    z.object({
      outcome: z.enum(["created", "exists", "plan_limit", "sole_prop_cap"]),
      number: z.record(z.string(), z.unknown()).nullable(),
    }),
    slotData,
  );

  if (slot.outcome === "plan_limit") {
    return errorResponse(
      c,
      "conflict",
      `Your plan includes ${maxNumbers} phone number${maxNumbers === 1 ? "" : "s"}. Upgrade or release a number first.`,
    );
  }
  if (slot.outcome === "sole_prop_cap") {
    // §4.2: Sole Proprietor registration is capped at 1 number regardless of plan.
    return errorResponse(
      c,
      "conflict",
      "Sole Proprietor registration allows 1 phone number.",
    );
  }
  if (!slot.number) throw new Error("claim_port_slot returned no row");
  const phoneId = (slot.number as { id?: string }).id;
  if (!phoneId) throw new Error("claim_port_slot row has no id");

  const { data: insertedPort, error: portInsertError } = await db
    .from("port_requests")
    .insert({
      company_id: companyId,
      phone_number_id: phoneId,
      phone_e164: body.phone_e164,
      country: local.country,
      entity_name: body.entity_name,
      auth_person_name: body.auth_person_name,
      billing_phone_number: body.billing_phone_number ?? null,
      account_number: body.account_number,
      pin_passcode: body.pin_passcode ?? null,
      is_wireless: isWireless,
      ssn_sin_last4: ssnSinLast4,
      service_street: body.service_street,
      service_extended: body.service_extended ?? null,
      service_locality: body.service_locality,
      service_admin_area: body.service_admin_area,
      service_postal_code: body.service_postal_code,
      foc_datetime_requested: body.foc_datetime_requested ?? null,
      status: "draft",
      messaging_port_status: "not_applicable",
      wants_bridge_number: body.wants_bridge_number,
    })
    .select(PORT_COLUMNS);
  if (portInsertError) {
    throw new Error(`port_requests insert failed: ${portInsertError.message}`);
  }
  const port = (insertedPort?.[0] ?? null) as unknown as PortRequestRow | null;
  if (!port) throw new Error("port_requests insert returned no row");

  // Post-signup path (§6 gate order): start the saga now, in the background — it
  // creates the Telnyx porting order (draft) but does NOT confirm; the row stays
  // `draft` until the customer uploads the LOA + invoice (PUT /:id/documents)
  // and calls POST /:id/submit (documents-gated confirm). It never throws for
  // step failures (those land on the row for the reconcile cron), so the 201
  // returns immediately with the port in `draft`. Onboarding path defers the
  // Telnyx order to the paid checkout webhook (paid-first, D16).
  if (!onboarding) {
    const saga = startPortSaga(env, { companyId, portRequestId: port.id });
    const ctx = executionCtxOf(c);
    if (ctx) {
      ctx.waitUntil(saga);
    } else {
      await saga;
    }
  }

  return c.json(sanitizePort(port), 201);
});

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

// ---------------------------------------------------------------------------
// List + get
// ---------------------------------------------------------------------------

/** GET /v1/port-requests — any member: list the company's ports. */
portingRoutes.get("/", async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const { data, error } = await db
    .from("port_requests")
    .select(PORT_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as (PortRequestRow &
    Record<string, unknown>)[];
  // Assignment runs post-cutover (P6b), so skip the campaign read entirely
  // unless a port has actually reached `ported`.
  const blocked = rows.some((row) => row.status === "ported")
    ? await assignmentBlockedNumbers(db, companyId)
    : NO_BLOCKED_NUMBERS;
  const bridge = await bridgeNumbers(db, rows);
  return c.json({
    data: rows.map((row) => sanitizePort(row, blocked, bridge)),
    next_cursor: null,
  });
});

/** GET /v1/port-requests/:id — any member: one port's full state. */
portingRoutes.get("/:id", async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const port = await loadPort(db, companyId, id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  const blocked =
    port.status === "ported"
      ? await assignmentBlockedNumbers(db, companyId)
      : NO_BLOCKED_NUMBERS;
  const bridge = await bridgeNumbers(db, [port]);
  return c.json(sanitizePort(port, blocked, bridge));
});

// ---------------------------------------------------------------------------
// Edit (fix-and-resubmit form) + document upload
// ---------------------------------------------------------------------------

/** Editable only while draft or exception (§7). */
function assertEditable(port: PortRequestRow): void {
  if (port.status !== "draft" && port.status !== "exception") {
    throw new ApiError(
      "validation_failed",
      `This port is ${port.status} and can no longer be edited.`,
    );
  }
}

const editBodySchema = createBodySchema
  .omit({ phone_e164: true, wants_bridge_number: true })
  .partial();

/**
 * PUT /v1/port-requests/:id — owner/admin: edit port data while draft or
 * exception (the fix-and-resubmit form). validation_failed once the port is
 * past the editable window.
 */
portingRoutes.put("/:id", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const port = await loadPort(db, c.get("companyId"), id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  assertEditable(port);

  const body = await parseJsonBody(c, editBodySchema);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    return c.json(sanitizePort(port));
  }
  const { data, error } = await db
    .from("port_requests")
    .update(patch)
    .eq("id", id)
    .eq("company_id", c.get("companyId"))
    .select(PORT_COLUMNS);
  if (error) throw new Error(`port_requests update failed: ${error.message}`);
  const updated = (data?.[0] ?? null) as unknown as PortRequestRow | null;
  if (!updated) return errorResponse(c, "not_found", "No such port request.");
  return c.json(
    sanitizePort(updated),
  );
});

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
// Whole-request ceiling for the documents route: two 10 MB files + generous
// multipart overhead. Checked from Content-Length BEFORE formData() buffers
// the body (SPEC §10 DoS posture).
const MAX_DOCUMENTS_BODY_BYTES = 2 * MAX_DOCUMENT_BYTES + 1024 * 1024;
const DOC_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

/**
 * PUT /v1/port-requests/:id/documents — owner/admin: upload LOA + invoice
 * (multipart). Uploads to Telnyx `POST /v2/documents` and stores the returned
 * UUIDs on the row. Editable window only (draft/exception). At least one of
 * `loa` / `invoice` must be present.
 */
portingRoutes.put("/:id/documents", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const port = await loadPort(db, companyId, id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  assertEditable(port);

  // Paid-first (D16 / §3.2): uploading the LOA + invoice is a Telnyx-committing
  // action (POST /v2/documents) and D16 is explicit — "no LOA upload ... before
  // payment_status==paid". §3.2 classes documents as a post-payment step. During
  // onboarding the port is `draft` and the subscription is `incomplete`, so the
  // upload must be blocked until the subscription is active (the paid checkout
  // webhook is what activates it). Mirrors the create route's post-signup gate.
  const company = await fetchCompany(db, companyId);
  if (company.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "Documents can be uploaded once your subscription is active — you'll finish payment first, then upload the LOA and bill.",
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
      "Expected multipart/form-data with loa and/or invoice file parts.",
    );
  }

  const patch: Record<string, unknown> = {};
  for (const field of ["loa", "invoice"] as const) {
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
        `${field} must be a non-empty file under 10 MB.`,
      );
    }
    const contentType = file.type || "application/pdf";
    if (!DOC_CONTENT_TYPES.has(contentType)) {
      return errorResponse(
        c,
        "validation_failed",
        `${field} must be a PDF, PNG, or JPEG.`,
      );
    }
    const bytes = await file.arrayBuffer();
    const documentId = await uploadPortDocument(
      env,
      {
        file: bytes,
        filename: file.name || `${field}.pdf`,
        contentType,
      },
      field,
    );
    patch[
      field === "loa" ? "telnyx_loa_document_id" : "telnyx_invoice_document_id"
    ] = documentId;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(
      c,
      "validation_failed",
      "Provide a loa and/or invoice file part.",
    );
  }

  const { data, error } = await db
    .from("port_requests")
    .update(patch)
    .eq("id", id)
    .eq("company_id", c.get("companyId"))
    .select(PORT_COLUMNS);
  if (error) throw new Error(`port_requests update failed: ${error.message}`);
  const updated = (data?.[0] ?? null) as unknown as PortRequestRow | null;
  if (!updated) return errorResponse(c, "not_found", "No such port request.");
  return c.json(
    sanitizePort(updated),
  );
});

// ---------------------------------------------------------------------------
// Resubmit + cancel
// ---------------------------------------------------------------------------

/**
 * POST /v1/port-requests/:id/submit — owner/admin: the post-payment completion
 * step (§3.5 / §6). Confirms a `draft` port whose Telnyx order is already
 * created (by the saga) once the customer has uploaded the LOA + invoice. HARD-
 * GATED on both documents: 409 `conflict` if either is missing — we never
 * confirm a Telnyx porting order with no documents (the carrier rejects it).
 * 409 `conflict` if the port is not in `draft`.
 */
portingRoutes.post("/:id/submit", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const port = await loadPort(db, c.get("companyId"), id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  if (port.status !== "draft") {
    return errorResponse(
      c,
      "conflict",
      port.status === "in-process" || port.status === "submitted"
        ? "This transfer has already been submitted."
        : `This port is ${port.status} and can no longer be submitted.`,
    );
  }
  // Confirm gate (§6): reject before any Telnyx confirm when a document is
  // missing — the customer must upload the LOA + invoice first.
  if (!hasRequiredDocuments(port)) {
    return errorResponse(
      c,
      "conflict",
      "Upload the signed LOA and a recent bill before submitting the transfer.",
    );
  }

  const updated = await submitPortRequest(env, {
    companyId: c.get("companyId"),
    portRequestId: id,
  });
  if (!updated) return errorResponse(c, "not_found", "No such port request.");
  return c.json(sanitizePort(updated));
});

/**
 * POST /v1/port-requests/:id/resubmit — owner/admin: fix-and-resubmit after an
 * exception. Re-runs the §3.4 PATCH (with messaging.enable_messaging + profile
 * re-sent every time — submitPortRequest does this) then re-confirms. HARD-
 * GATED on both documents like the initial submit: 409 `conflict` if the LOA or
 * invoice is missing (a rejection can require re-uploading a document; we never
 * re-confirm without both). Port-in is free — no charge. 409 `conflict` if
 * status is not `exception`.
 */
portingRoutes.post("/:id/resubmit", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const port = await loadPort(db, c.get("companyId"), id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  if (port.status !== "exception") {
    return errorResponse(
      c,
      "conflict",
      "Only a port that needs a fix can be resubmitted.",
    );
  }
  if (!hasRequiredDocuments(port)) {
    return errorResponse(
      c,
      "conflict",
      "Upload the signed LOA and a recent bill before resubmitting the transfer.",
    );
  }

  // submitPortRequest re-issues the declarative PATCH (re-sending messaging
  // enablement — exception is in-window) and re-confirms; it moves the row
  // exception → in-process and increments submission_count. It re-checks the
  // documents gate and throws PortDocumentsMissingError (→ conflict) if either
  // is missing, so a TOCTOU document removal is still caught.
  let updated: PortRequestRow | null;
  try {
    updated = await submitPortRequest(env, {
      companyId: c.get("companyId"),
      portRequestId: id,
    });
  } catch (cause) {
    if (cause instanceof PortDocumentsMissingError) {
      return errorResponse(c, "conflict", cause.message);
    }
    throw cause;
  }
  if (!updated) return errorResponse(c, "not_found", "No such port request.");
  return c.json(
    sanitizePort(updated),
  );
});

/**
 * POST /v1/port-requests/:id/cancel — owner only: abandon a pre-completion
 * port (§3.8). → cancel-pending; the linked phone_numbers row is released on
 * completion. 409 conflict if already ported/cancelled.
 */
portingRoutes.post("/:id/cancel", requireRole("owner"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const port = await loadPort(db, c.get("companyId"), id);
  if (!port) return errorResponse(c, "not_found", "No such port request.");
  if (port.status === "ported" || port.status === "cancelled") {
    return errorResponse(
      c,
      "conflict",
      `This port is ${port.status} and can no longer be cancelled.`,
    );
  }

  // cancelPortRequest (§3.8) handles BOTH shapes: with a Telnyx order → ask
  // Telnyx to cancel (tolerating a 404) and park in cancel-pending for the
  // webhook/cron to complete; WITHOUT an order (the onboarding pre-payment path,
  // telnyx_porting_order_id=NULL) → complete the cancel immediately (→ cancelled
  // + release the still-provisioning number) since nothing else would ever drive
  // it out of cancel-pending, wedging the company's number slot forever.
  const updated = await cancelPortRequest(env, port);
  return c.json(sanitizePort(updated));
});
