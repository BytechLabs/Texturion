import { NANP_AREA_CODES } from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { searchInventory } from "../telnyx/inventory";

/**
 * GET /v1/available-numbers — the number PICKER feed (choose-your-number).
 * Company-EXEMPT + JWT-only: the US onboarding number step runs BEFORE the
 * company row exists (created at the business step), so it can't carry an
 * X-Company-Id. It exposes only public Telnyx inventory (no cost/vendor ids —
 * sanitized by searchInventory); the WRITE paths that spend money stay
 * company-scoped + owner/admin. Mounted at /v1/available-numbers.
 */
export const availableNumbersRoutes = new Hono<AppEnv>();

const querySchema = z.object({
  country: z.enum(["US", "CA"]),
  area_code: z
    .string()
    .regex(/^[2-9]\d{2}$/)
    .optional(),
  best_effort: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

availableNumbersRoutes.get("/", async (c) => {
  const env = getEnv(c.env);
  const parsed = querySchema.safeParse({
    country: c.req.query("country"),
    area_code: c.req.query("area_code"),
    best_effort: c.req.query("best_effort"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return errorResponse(
      c,
      "validation_failed",
      "country is required (US or CA); area_code must be a 3-digit NANP code.",
    );
  }
  const { country, area_code, best_effort, limit } = parsed.data;

  // An area code, when supplied, must be a geographic NANP code in that country
  // — reject a mismatch rather than returning a foreign country's numbers.
  if (area_code) {
    const entry = NANP_AREA_CODES[area_code];
    if (!entry || !entry.geographic || entry.country !== country) {
      return errorResponse(
        c,
        "validation_failed",
        `Area code ${area_code} isn't a ${country} area code.`,
      );
    }
  }

  const result = await searchInventory(env, {
    country,
    areaCode: area_code,
    bestEffort: best_effort === "true",
    limit,
  });
  return c.json(result);
});
