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
 *   GET   /v1/company    M   — company + plan/subscription/period/cap +
 *         numbers summary + registration summary.
 *   PATCH /v1/company    O/A — { name?, timezone? } (timezone IANA-validated,
 *         D15); { overage_cap_multiplier? } is owner-only (number or null —
 *         SPEC §2 cap, §10 matrix).
 */
import { isValidBusinessHours, NANP_AREA_CODES } from "@jobtext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
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
  // The AUP gate (SPEC §4.1 step 1): anything but literal true is 422.
  aup_accepted: z.literal(true),
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
    overage_cap_multiplier: z
      .number()
      .positive()
      .max(9999.99)
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
    // FEATURE-GAPS Step 2 — Google review deep-link; null clears it.
    google_review_link: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.timezone !== undefined ||
      "overage_cap_multiplier" in body ||
      body.business_hours !== undefined ||
      body.away_enabled !== undefined ||
      "away_message" in body ||
      "google_review_link" in body,
    { message: "Provide at least one field to update." },
  );

/** A stored review link must be an absolute http(s) URL (Gate-2 hygiene). */
function assertValidReviewLink(link: string): void {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ApiError(
      "validation_failed",
      "google_review_link must be a valid URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(
      "validation_failed",
      "google_review_link must be an http(s) URL.",
    );
  }
}

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
    patch.overage_cap_multiplier =
      body.overage_cap_multiplier === null
        ? null
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
  // FEATURE-GAPS Step 2: Google review link.
  if ("google_review_link" in body) {
    if (body.google_review_link && body.google_review_link.length > 0) {
      assertValidReviewLink(body.google_review_link);
      patch.google_review_link = body.google_review_link;
    } else {
      patch.google_review_link = null;
    }
  }

  const db = getDb(getEnv(c.env));
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
  return c.json(company);
});
