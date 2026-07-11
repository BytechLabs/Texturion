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
  // Choose-your-number: a specific onboarding pick to order exactly (validated
  // against its own area code's country below). Omitted = auto-search.
  chosen_number_e164: z
    .string()
    .trim()
    .regex(/^\+1\d{10}$/)
    .optional(),
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
    // Onboarding "edit until checkout": the pending number's area code, country,
    // and US-texting choice. Mutable only while the company is pre-checkout
    // (validated + gated in the handler; a country change needs a new area code).
    requested_area_code: z.string().regex(/^\d{3}$/).optional(),
    country: z.enum(["US", "CA"]).optional(),
    us_texting_enabled: z.boolean().optional(),
    // Choose-your-number: the onboarding pick (null clears it). Mutable only
    // pre-checkout; validated against its own NDC's country; auto-nulled on a
    // country / area-code change (a stale pick would be for the wrong region).
    chosen_number_e164: z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/)
      .nullable()
      .optional(),
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
      body.requested_area_code !== undefined ||
      body.country !== undefined ||
      body.us_texting_enabled !== undefined ||
      "chosen_number_e164" in body ||
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

/**
 * Choose-your-number: a picked E.164 must be a geographic NANP number in the
 * company's country — validated against its OWN area code's NDC, NOT the
 * requested area code (a "show nearby" pick legitimately lands on a different
 * area code — e.g. an exhausted 416 → a 647).
 */
function assertChosenNumberCountry(e164: string, country: string): void {
  const ndc = /^\+1(\d{3})\d{7}$/.exec(e164)?.[1];
  const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
  if (!ndc || !entry || !entry.geographic || entry.country !== country) {
    throw new ApiError(
      "validation_failed",
      `chosen_number_e164: ${e164} is not a ${country} local number.`,
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
  if (body.chosen_number_e164) {
    assertChosenNumberCountry(body.chosen_number_e164, body.country);
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
  // Stage the onboarding pick on the fresh company (the create RPC signature is
  // fixed, so it rides a follow-up update). provisionCompanyNumber drains it
  // onto the ordered number at checkout.
  if (body.chosen_number_e164) {
    const { error: chosenError } = await db
      .from("companies")
      .update({ chosen_number_e164: body.chosen_number_e164 })
      .eq("id", company.id as string);
    if (chosenError) {
      throw new Error(`chosen number persist failed: ${chosenError.message}`);
    }
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
  // "Calling" add-on. Block a settings change that TURNS them on when
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
      "Forwarding calls and texting back missed calls need the Calling add-on — turn it on in Settings › Billing.",
    );
  }

  // Onboarding "edit until checkout": country, US-texting, and the requested
  // area code are mutable ONLY while the company is still pre-checkout. Once
  // checkout completes the number is provisioned from them and they lock. A
  // country change requires a matching new area code (geographic-NANP rule).
  if (
    body.country !== undefined ||
    body.requested_area_code !== undefined ||
    body.us_texting_enabled !== undefined ||
    "chosen_number_e164" in body
  ) {
    const current = unwrap<{ country: string; subscription_status: string }[]>(
      await db
        .from("companies")
        .select("country, subscription_status")
        .eq("id", c.get("companyId"))
        .is("deleted_at", null),
      "company location precheck",
    );
    const row = current[0];
    if (!row) return errorResponse(c, "not_found", "No such company.");
    if (
      row.subscription_status !== "incomplete" &&
      row.subscription_status !== "incomplete_expired"
    ) {
      throw new ApiError(
        "conflict",
        "Your number has already been ordered, so its country and area code are locked.",
      );
    }
    const nextCountry = body.country ?? row.country;
    if (
      body.country !== undefined &&
      body.country !== row.country &&
      body.requested_area_code === undefined
    ) {
      throw new ApiError(
        "validation_failed",
        "requested_area_code: pick an area code for the new country.",
      );
    }
    if (body.requested_area_code !== undefined) {
      const entry = NANP_AREA_CODES[body.requested_area_code];
      if (!entry || !entry.geographic || entry.country !== nextCountry) {
        throw new ApiError(
          "validation_failed",
          `requested_area_code: ${body.requested_area_code} is not an assigned geographic ${nextCountry} area code.`,
        );
      }
      patch.requested_area_code = body.requested_area_code;
    }
    if (body.country !== undefined) patch.country = body.country;
    // US always texts US; CA honors the toggle.
    if (nextCountry === "US" && body.us_texting_enabled === false) {
      throw new ApiError(
        "validation_failed",
        "us_texting_enabled: US companies always have US texting enabled.",
      );
    }
    if (body.country === "US") {
      patch.us_texting_enabled = true;
    } else if (body.us_texting_enabled !== undefined) {
      patch.us_texting_enabled = body.us_texting_enabled;
    }

    // The staged onboarding pick. An explicit value is validated against the
    // effective country (null clears it); otherwise a country/area-code change
    // invalidates any prior pick (it was for the old region) and clears it.
    const regionChanged =
      (body.country !== undefined && body.country !== row.country) ||
      body.requested_area_code !== undefined;
    if ("chosen_number_e164" in body) {
      if (body.chosen_number_e164) {
        assertChosenNumberCountry(body.chosen_number_e164, nextCountry);
        patch.chosen_number_e164 = body.chosen_number_e164;
      } else {
        patch.chosen_number_e164 = null;
      }
    } else if (regionChanged) {
      patch.chosen_number_e164 = null;
    }
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
