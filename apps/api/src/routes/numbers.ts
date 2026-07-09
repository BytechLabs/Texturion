import { NANP_AREA_CODES } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { PLAN_LIMITS, type PlanId } from "../billing/plans";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { parseJsonBody, parseWith, pathUuid } from "./core/http";
import {
  areaCodeOf,
  MAX_PROVISION_ATTEMPTS,
  releaseNumberRow,
  resumeProvisioning,
  type PhoneNumberRow,
} from "../telnyx/provisioning";

/**
 * Numbers routes (SPEC §7 route table, §4.2/§4.3, §10, §12 step 18). Mounted
 * by the integration layer under `/v1/numbers`, behind the /v1 middleware
 * chain. Read = any member; provision = owner/admin; release = owner only.
 */
export const numbersRoutes = new Hono<AppEnv>();

const NUMBER_COLUMNS =
  "id,company_id,status,source,voice_enabled,provisioning_key," +
  "requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,provision_failure_reason,updated_at,created_at," +
  "suspended_at,released_at";

type NumberRowFull = PhoneNumberRow & {
  voice_enabled?: boolean;
} & Record<string, unknown>;

/**
 * Vendor ids and provisioning internals stay server-side. The COARSE
 * failure_reason + provision_attempts + a derived `retrying` flag ARE exposed
 * so the UI can render provision_failed honestly and actionably — but the raw
 * last_provision_error and every telnyx_* id are never sent.
 */
function sanitizeNumber(row: NumberRowFull) {
  return {
    id: row.id,
    status: row.status,
    // Hosted-vs-purchased + voice state (FEATURE-GAPS voice wave): the web
    // renders keep-your-number rows differently from bought inventory.
    source: row.source,
    voice_enabled: row.voice_enabled ?? false,
    number_e164: row.number_e164,
    country: row.country,
    requested_area_code: row.requested_area_code,
    failure_reason: row.provision_failure_reason,
    provision_attempts: row.provision_attempts,
    // Still auto-retrying under the cron budget vs. genuinely stuck (out of
    // attempts) — drives "we're retrying" vs "choose a number" copy.
    retrying:
      row.status === "provision_failed" &&
      row.provision_attempts < MAX_PROVISION_ATTEMPTS,
    created_at: row.created_at ?? null,
    suspended_at: row.suspended_at ?? null,
    released_at: row.released_at ?? null,
  };
}

async function listCompanyNumbers(
  db: SupabaseClient,
  companyId: string,
): Promise<NumberRowFull[]> {
  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  return (data ?? []) as unknown as NumberRowFull[];
}

/** GET /v1/numbers — any member: list numbers with status (SPEC §7). */
numbersRoutes.get("/", async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = await listCompanyNumbers(db, c.get("companyId"));
  // A company holds at most 2 numbers (SPEC §2) — the list envelope keeps the
  // §7 shape with no second page ever.
  return c.json({ data: rows.map(sanitizeNumber), next_cursor: null });
});

const provisionBodySchema = z
  .strictObject({
    // The user must give agency to their number BEFORE we order (issue #75): a
    // specific E.164 (US, and any revealed number) is ordered exactly; a bare
    // area code (masked/CA inventory) assigns a number in that code. One is
    // required — we never auto-pick a number the user hasn't chosen.
    requested_area_code: z
      .string()
      .trim()
      .regex(/^[2-9]\d{2}$/, "must be a 3-digit area code")
      .optional(),
    chosen_number_e164: z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/, "must be an E.164 NANP number")
      .optional(),
  })
  .refine((b) => Boolean(b.chosen_number_e164 || b.requested_area_code), {
    message: "a chosen number or an area code is required",
  });

const idempotencyKeySchema = z.uuid();

interface SlotResult {
  outcome: "created" | "exists" | "plan_limit" | "sole_prop_cap";
  number: NumberRowFull | null;
}

/**
 * POST /v1/numbers/provision — owner/admin (SPEC §7, §10): Pro's 2nd number.
 * Gate order: role → Idempotency-Key (client UUID, §7) → area-code validation
 * against the shared NANP table (country fixed to the company's) → active
 * subscription (402) → the atomic slot claim (`provision_number_slot` RPC:
 * company-row lock + count-vs-plan + §4.2 sole-prop cap + insert, one
 * transaction) → the §4.3 saga from S2.
 */
numbersRoutes.post("/provision", requireRole("admin"), async (c) => {
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
  const body = await parseJsonBody(c, provisionBodySchema);

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select("id,country,subscription_status,plan")
    .eq("id", companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`companies lookup failed: ${companyError.message}`);
  }
  const company = (companyRows?.[0] ?? null) as {
    id: string;
    country: "US" | "CA";
    subscription_status: string;
    plan: PlanId | null;
  } | null;
  if (!company) throw new ApiError("not_found", "Company not found.");

  // Resolve the request to a concrete area code (fixed to the company's country)
  // and, when the user picked a specific number, the exact E.164 to order. A
  // chosen number is validated against its OWN area code's country (issue #75:
  // pick-then-order, never auto-assign).
  let chosen: string | null = null;
  let areaCode: string;
  if (body.chosen_number_e164) {
    const ndc = areaCodeOf(body.chosen_number_e164);
    const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
    if (!ndc || !entry || !entry.geographic) {
      throw new ApiError(
        "validation_failed",
        "chosen_number_e164 is not an assigned US/CA geographic number.",
      );
    }
    if (entry.country !== company.country) {
      throw new ApiError(
        "validation_failed",
        `chosen_number_e164 must be a ${company.country} number (the company's country).`,
      );
    }
    chosen = body.chosen_number_e164;
    areaCode = ndc;
  } else {
    const code = body.requested_area_code as string;
    const entry = NANP_AREA_CODES[code];
    if (!entry || !entry.geographic) {
      throw new ApiError(
        "validation_failed",
        "requested_area_code is not an assigned US/CA geographic area code.",
      );
    }
    if (entry.country !== company.country) {
      throw new ApiError(
        "validation_failed",
        `requested_area_code must be a ${company.country} area code (the company's country).`,
      );
    }
    areaCode = code;
  }

  if (company.subscription_status !== "active" || company.plan === null) {
    return errorResponse(
      c,
      "subscription_inactive",
      "An active subscription is required to provision a number.",
    );
  }

  const { data: slotData, error: slotError } = await db.rpc(
    "provision_number_slot",
    {
      p_company_id: companyId,
      p_provisioning_key: parsedKey.data,
      p_requested_area_code: areaCode,
      p_country: company.country,
      p_max_numbers: PLAN_LIMITS[company.plan].numbers,
      p_chosen_number_e164: chosen,
    },
  );
  if (slotError) {
    throw new Error(`provision_number_slot failed: ${slotError.message}`);
  }
  const slot = parseWith(
    z.object({
      outcome: z.enum(["created", "exists", "plan_limit", "sole_prop_cap"]),
      number: z.record(z.string(), z.unknown()).nullable(),
    }),
    slotData,
  ) as SlotResult;

  if (slot.outcome === "plan_limit") {
    return errorResponse(
      c,
      "conflict",
      `Your plan includes ${PLAN_LIMITS[company.plan].numbers} phone number${PLAN_LIMITS[company.plan].numbers === 1 ? "" : "s"}. Upgrade or release a number first.`,
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
  if (!slot.number) throw new Error("provision_number_slot returned no row");

  if (slot.outcome === "exists") {
    // Idempotent replay (§7): the same Idempotency-Key returns the same row.
    return c.json(sanitizeNumber(slot.number as NumberRowFull), 200);
  }

  const provisioned = await resumeProvisioning(
    env,
    slot.number as unknown as PhoneNumberRow,
  );
  return c.json(sanitizeNumber(provisioned as NumberRowFull), 201);
});

/**
 * DELETE /v1/numbers/:id — owner only (SPEC §7, §12 step 18): release a
 * number (type-to-confirm in the UI, needed pre-downgrade, never automatic).
 */
numbersRoutes.delete("/:id", requireRole("owner"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");

  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("id", id)
    .eq("company_id", c.get("companyId"))
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as NumberRowFull | null;
  if (!row) return errorResponse(c, "not_found", "No such number.");
  if (row.status === "released") {
    return errorResponse(c, "conflict", "This number is already released.");
  }

  const released = await releaseNumberRow(env, row);
  return c.json(sanitizeNumber(released as NumberRowFull));
});

const remediateBodySchema = z.strictObject({
  requested_area_code: z
    .string()
    .trim()
    .regex(/^[2-9]\d{2}$/, "must be a 3-digit area code")
    .optional(),
  chosen_number_e164: z
    .string()
    .trim()
    .regex(/^\+1\d{10}$/, "must be an E.164 NANP number")
    .optional(),
});

/**
 * POST /v1/numbers/:id/remediate — owner/admin: finish a provision_failed number
 * WITHOUT a new charge. Re-arms the EXISTING paid row (resets the attempt budget,
 * status → provisioning) and re-runs the saga via resumeProvisioning — it NEVER
 * calls provision_number_slot (the paid slot claim) and NEVER touches Stripe.
 * The user can change the area code and/or pick a specific number; a chosen
 * number is validated against its OWN area code's country (never the old
 * requested code — that would reject the exhausted-416 → pick-a-647 remedy).
 */
numbersRoutes.post("/:id/remediate", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, remediateBodySchema);

  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("id", id)
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as NumberRowFull | null;
  if (!row) return errorResponse(c, "not_found", "No such number.");
  // Only a failed BUY-saga row is remediable: a ported/hosted number has no
  // inventory to search, and an active/released one is nothing to fix.
  if (row.source !== "provisioned") {
    return errorResponse(c, "conflict", "This number can't be set up this way.");
  }
  if (row.status !== "provision_failed") {
    return errorResponse(c, "conflict", "This number isn't waiting to be set up.");
  }

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select("country")
    .eq("id", companyId)
    .limit(1);
  if (companyError) throw new Error(`company lookup failed: ${companyError.message}`);
  const country = (companyRows?.[0] as { country?: string } | undefined)?.country;
  if (country !== "US" && country !== "CA") {
    return errorResponse(c, "not_found", "No such company.");
  }

  let chosen: string | null = null;
  let areaCode: string | null = null;
  if (body.chosen_number_e164) {
    const ndc = areaCodeOf(body.chosen_number_e164);
    const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
    if (!ndc || !entry || !entry.geographic || entry.country !== country) {
      return errorResponse(
        c,
        "validation_failed",
        `That number isn't a ${country} local number.`,
      );
    }
    // A live order for the auto-searched number would pre-empt the pick (and
    // clearing it blindly risks a double-buy). Require a clean order slate; the
    // common no-inventory remedy always has a null order id anyway.
    if (row.telnyx_order_id) {
      return errorResponse(
        c,
        "conflict",
        "We're finishing an earlier order. Try choosing again in a minute.",
      );
    }
    chosen = body.chosen_number_e164;
    areaCode = ndc;
  } else if (body.requested_area_code) {
    const entry = NANP_AREA_CODES[body.requested_area_code];
    if (!entry || !entry.geographic || entry.country !== country) {
      return errorResponse(
        c,
        "validation_failed",
        `Area code ${body.requested_area_code} isn't a ${country} area code.`,
      );
    }
    areaCode = body.requested_area_code;
  }

  // Atomic re-arm on the existing PAID row. The `status = 'provision_failed'`
  // guard is also the concurrency lock: a double-clicked retry updates 0 rows.
  const { data: armedRows, error: armError } = await db
    .from("phone_numbers")
    .update({
      status: "provisioning",
      provision_attempts: 0,
      last_provision_error: null,
      provision_failure_reason: null,
      chosen_number_e164: chosen,
      ...(areaCode ? { requested_area_code: areaCode } : {}),
    })
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("status", "provision_failed")
    .select(NUMBER_COLUMNS);
  if (armError) throw new Error(`remediate update failed: ${armError.message}`);
  const armed = (armedRows?.[0] ?? null) as unknown as PhoneNumberRow | null;
  if (!armed) {
    return errorResponse(c, "conflict", "A retry is already in progress.");
  }

  const result = await resumeProvisioning(env, armed);
  return c.json(sanitizeNumber(result as NumberRowFull));
});
