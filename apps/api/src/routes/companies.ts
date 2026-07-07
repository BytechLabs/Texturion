/**
 * Company routes (SPEC §4.1 step 2, §7, §10):
 *
 *   POST  /v1/companies  any authed user (company-exempt) — create company:
 *         zod body { name, country, requested_area_code, us_texting_enabled?,
 *         timezone?, aup_accepted: true }; area code must be a geographic
 *         US/CA NANP code in the company's country; AUP acceptance is
 *         mandatory (422); timezone must be a valid IANA zone when present
 *         (D15 — onboarding sends the browser's zone; DB default otherwise).
 *         Creates company + owner membership + pre-seeded pipeline tags +
 *         notification_prefs atomically (api_create_company SQL function).
 *         Capped per user (#31): the RPC refuses a 6th owned workspace with
 *         an { outcome: 'owner_cap' } sentinel, surfaced here as 409.
 *   GET   /v1/company    M   — company + plan/subscription/period/cap +
 *         numbers summary + registration summary.
 *   PATCH /v1/company    O/A — { name?, timezone? } (timezone IANA-validated,
 *         D15); { overage_cap_multiplier? } is owner-only (number or null —
 *         SPEC §2 cap, §10 matrix).
 */
import {
  isUsCaDestination,
  isValidBusinessHours,
  lookupAreaCode,
  NANP_AREA_CODES,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { isModuleEnabled } from "../billing/company-modules";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { enableVoiceForCompany } from "../telnyx/voice";
import { COMPANY_COLUMNS, loadCompanyView } from "./core/company-view";
import { parseJsonBody, unwrap } from "./core/http";
import { isValidIanaTimezone } from "./core/timezone";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.enum(["US", "CA"]),
  requested_area_code: z.string().regex(/^\d{3}$/),
  us_texting_enabled: z.boolean().optional(),
  // D15: onboarding sends the browser's IANA zone; validated below against
  // the runtime's timezone database (a zod enum cannot express it).
  timezone: z.string().trim().min(1).max(100).optional(),
  // AUP acceptance is implicit now (the create RPC stamps aup_accepted_at
  // unconditionally); the field is accepted for back-compat but no longer gates
  // creation — the visible checkbox was removed as needless signup friction.
  aup_accepted: z.literal(true).optional(),
});

/** A weekday open/close window; both HH:MM. Full shape checked below. */
const dayHoursSchema = z.object({
  open: z.string(),
  close: z.string(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    // #12 Phase 0.3: the overage cap is an un-defeatable ceiling — bounded to
    // the (0, 10] safety range. `null` ("no cap") is still accepted for
    // backward-compat but resolves to the 10x hard maximum below.
    overage_cap_multiplier: z
      .number()
      .positive()
      .max(10)
      .nullable()
      .optional(),
    // FEATURE-GAPS Step 1 — after-hours away reply (O/A). business_hours is a
    // weekday→window map (company-local per timezone); structural validity is
    // checked with isValidBusinessHours below.
    business_hours: z
      .record(z.string(), dayHoursSchema.nullable())
      .optional(),
    away_enabled: z.boolean().optional(),
    // Owner-authored away text; null clears it. Max 1000 for a comfortable
    // multi-line emergency-aware message.
    away_message: z.string().trim().max(1000).nullable().optional(),
    // FEATURE-GAPS voice wave — missed-call text-back (O/A). mctb_message is
    // owner-authored (null clears it); forward_to_cell is an optional E.164 cell
    // (null clears it), validated against the NANP table below.
    mctb_enabled: z.boolean().optional(),
    mctb_message: z.string().trim().max(1000).nullable().optional(),
    forward_to_cell: z.string().trim().max(20).nullable().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.timezone !== undefined ||
      "overage_cap_multiplier" in body ||
      body.business_hours !== undefined ||
      body.away_enabled !== undefined ||
      "away_message" in body ||
      body.mctb_enabled !== undefined ||
      "mctb_message" in body ||
      "forward_to_cell" in body,
    { message: "Provide at least one field to update." },
  );

/** D15: reject anything the runtime's IANA database does not know. */
function assertValidTimezone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) {
    throw new ApiError(
      "validation_failed",
      `timezone: ${timezone} is not a valid IANA timezone.`,
    );
  }
}

export const companiesRoutes = new Hono<AppEnv>();

companiesRoutes.post("/companies", async (c) => {
  const body = await parseJsonBody(c, createSchema);

  const entry = NANP_AREA_CODES[body.requested_area_code];
  if (!entry || !entry.geographic || entry.country !== body.country) {
    throw new ApiError(
      "validation_failed",
      `requested_area_code: ${body.requested_area_code} is not an assigned geographic ${body.country} area code.`,
    );
  }
  if (body.country === "US" && body.us_texting_enabled === false) {
    throw new ApiError(
      "validation_failed",
      "us_texting_enabled: US companies always have US texting enabled.",
    );
  }
  if (body.timezone !== undefined) assertValidTimezone(body.timezone);

  const db = getDb(getEnv(c.env));
  const company = unwrap<Record<string, unknown>>(
    await db.rpc("api_create_company", {
      p_owner_user_id: c.get("userId"),
      p_name: body.name,
      p_country: body.country,
      p_requested_area_code: body.requested_area_code,
      // us_texting_enabled applies to CA (SPEC §4.2); US is always true.
      p_us_texting_enabled:
        body.country === "US" ? true : (body.us_texting_enabled ?? true),
      // Omitted → the SQL default ('America/Toronto', D15) applies.
      ...(body.timezone !== undefined ? { p_timezone: body.timezone } : {}),
    }),
    "company create",
  );
  // #31 abuse cap: api_create_company enforces a per-user owned-company
  // ceiling under an advisory lock (migration 20260707160000) and reports the
  // refusal as an { outcome: 'owner_cap', limit } sentinel instead of the
  // company row — surface it as the SPEC §7 409 `conflict`.
  if (company.outcome === "owner_cap") {
    return errorResponse(
      c,
      "conflict",
      `You already own ${String(company.limit)} workspaces — the most an account can create. Delete one you no longer use first.`,
    );
  }
  return c.json(company, 201);
});

companiesRoutes.get("/company", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const company = await loadCompanyView(db, c.get("companyId"));
  if (!company) {
    return errorResponse(c, "not_found", "No such company.");
  }
  return c.json(company);
});

companiesRoutes.patch("/company", requireRole("admin"), async (c) => {
  const body = await parseJsonBody(c, patchSchema);

  // Overage cap raise/remove is owner-only (SPEC §2, §10 matrix).
  if ("overage_cap_multiplier" in body && c.get("role") !== "owner") {
    return errorResponse(
      c,
      "forbidden",
      "Only the owner can change the overage cap.",
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.timezone !== undefined) {
    assertValidTimezone(body.timezone);
    patch.timezone = body.timezone;
  }
  if ("overage_cap_multiplier" in body) {
    // #12 Phase 0.3: `null` ("no cap") now resolves to the 10x hard ceiling —
    // the cap can no longer be disabled (companies_overage_cap_range CHECK).
    patch.overage_cap_multiplier =
      body.overage_cap_multiplier === null
        ? 10
        : Math.round(body.overage_cap_multiplier! * 100) / 100;
  }
  // FEATURE-GAPS Step 1: after-hours away settings.
  if (body.business_hours !== undefined) {
    if (!isValidBusinessHours(body.business_hours)) {
      throw new ApiError(
        "validation_failed",
        "business_hours must map weekdays (mon..sun) to { open, close } HH:MM windows.",
      );
    }
    patch.business_hours = body.business_hours;
  }
  if (body.away_enabled !== undefined) patch.away_enabled = body.away_enabled;
  if ("away_message" in body) {
    // Empty string clears to null (an unauthored message never fires).
    patch.away_message =
      body.away_message && body.away_message.length > 0
        ? body.away_message
        : null;
  }
  // FEATURE-GAPS voice wave: missed-call text-back settings.
  if (body.mctb_enabled !== undefined) patch.mctb_enabled = body.mctb_enabled;
  if ("mctb_message" in body) {
    // Empty string clears to null (an unauthored message never fires).
    patch.mctb_message =
      body.mctb_message && body.mctb_message.length > 0
        ? body.mctb_message
        : null;
  }
  if ("forward_to_cell" in body) {
    if (body.forward_to_cell && body.forward_to_cell.length > 0) {
      // Must be a real US/CA E.164 cell (the DB CHECK is the storage backstop;
      // this is the friendly validation the owner sees).
      if (!isUsCaDestination(body.forward_to_cell) ||
          !lookupAreaCode(body.forward_to_cell)?.geographic) {
        throw new ApiError(
          "validation_failed",
          "forward_to_cell must be a valid US or Canada mobile number (+1…).",
        );
      }
      patch.forward_to_cell = body.forward_to_cell;
    } else {
      patch.forward_to_cell = null;
    }
  }

  const env = getEnv(c.env);
  const db = getDb(env);

  // #12 plan builder: call forwarding + missed-call text-back are the opt-in
  // "Call forwarding" add-on. Block a settings change that TURNS them on when
  // the module is off — a clear upsell before any voice cost is possible.
  // Grandfathered companies (a forward number or MCTB already on) have the
  // module, so this never bites an existing voice user.
  const enablingVoice =
    body.mctb_enabled === true ||
    (typeof patch.forward_to_cell === "string" &&
      patch.forward_to_cell.length > 0);
  if (enablingVoice && !(await isModuleEnabled(db, c.get("companyId"), "voice"))) {
    throw new ApiError(
      "conflict",
      "Call forwarding needs the Call forwarding add-on — turn it on in Settings › Billing.",
    );
  }

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("companies")
      .update(patch)
      .eq("id", c.get("companyId"))
      .is("deleted_at", null)
      .select(COMPANY_COLUMNS),
    "company update",
  );
  const company = rows[0];
  if (!company) {
    return errorResponse(c, "not_found", "No such company.");
  }

  // When the missed-call text-back is turned ON, or a forward cell is set, the
  // company's number(s) must be able to RECEIVE CALLS. Enable voice idempotently
  // (a no-op when already enabled or when no active number exists yet). Only the
  // voice facet is touched — SMS is never affected. Best-effort in the
  // background so the settings write returns immediately; a failure here is
  // logged and the number stays SMS-only until the next enable (settings re-save
  // or a cron), never blocking the settings save.
  const turnedOnVoice =
    body.mctb_enabled === true ||
    (typeof patch.forward_to_cell === "string" &&
      patch.forward_to_cell.length > 0);
  if (turnedOnVoice) {
    const enable = enableVoiceForCompany(env, db, c.get("companyId")).catch(
      (cause: unknown) => {
        console.error(
          `voice enable for company ${c.get("companyId")} failed:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      },
    );
    const ctx = executionCtxOf(c);
    if (ctx) ctx.waitUntil(enable);
    else await enable;
  }

  return c.json(company);
});

/** Hono's `c.executionCtx` throws when there is no runtime context; probe it. */
function executionCtxOf(c: {
  executionCtx: { waitUntil(p: Promise<unknown>): void };
}): { waitUntil(p: Promise<unknown>): void } | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}
