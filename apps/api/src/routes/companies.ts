/**
 * Company routes (SPEC §4.1 step 2, §7, §10):
 *
 *   POST  /v1/companies  any authed user (company-exempt) — create company:
 *         zod body { name, country, requested_area_code, us_texting_enabled?,
 *         aup_accepted: true }; area code must be a geographic US/CA NANP code
 *         in the company's country; AUP acceptance is mandatory (422).
 *         Creates company + owner membership + pre-seeded pipeline tags +
 *         notification_prefs atomically (api_create_company SQL function).
 *   GET   /v1/company    M   — company + plan/subscription/period/cap +
 *         numbers summary + registration summary.
 *   PATCH /v1/company    O/A — { name? }; { overage_cap_multiplier? } is
 *         owner-only (number or null — SPEC §2 cap, §10 matrix).
 */
import { NANP_AREA_CODES } from "@jobtext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { COMPANY_COLUMNS, loadCompanyView } from "./core/company-view";
import { parseJsonBody, unwrap } from "./core/http";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.enum(["US", "CA"]),
  requested_area_code: z.string().regex(/^\d{3}$/),
  us_texting_enabled: z.boolean().optional(),
  // The AUP gate (SPEC §4.1 step 1): anything but literal true is 422.
  aup_accepted: z.literal(true),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    overage_cap_multiplier: z
      .number()
      .positive()
      .max(9999.99)
      .nullable()
      .optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || "overage_cap_multiplier" in body,
    { message: "Provide at least one field to update." },
  );

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
  if ("overage_cap_multiplier" in body) {
    patch.overage_cap_multiplier =
      body.overage_cap_multiplier === null
        ? null
        : Math.round(body.overage_cap_multiplier! * 100) / 100;
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
