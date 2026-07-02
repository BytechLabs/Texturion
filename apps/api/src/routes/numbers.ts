import { NANP_AREA_CODES } from "@jobtext/shared";
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
  "id,company_id,status,provisioning_key,requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,updated_at,created_at,suspended_at,released_at";

/** Vendor ids and provisioning internals stay server-side. */
function sanitizeNumber(row: PhoneNumberRow & Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    number_e164: row.number_e164,
    country: row.country,
    requested_area_code: row.requested_area_code,
    created_at: row.created_at ?? null,
    suspended_at: row.suspended_at ?? null,
    released_at: row.released_at ?? null,
  };
}

type NumberRowFull = PhoneNumberRow & Record<string, unknown>;

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

const provisionBodySchema = z.strictObject({
  requested_area_code: z
    .string()
    .trim()
    .regex(/^[2-9]\d{2}$/, "must be a 3-digit area code"),
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

  const entry = NANP_AREA_CODES[body.requested_area_code];
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
      p_requested_area_code: body.requested_area_code,
      p_country: company.country,
      p_max_numbers: PLAN_LIMITS[company.plan].numbers,
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
