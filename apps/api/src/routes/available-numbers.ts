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
  /**
   * #513: digits the number must contain, passed THROUGH to Telnyx.
   *
   * The picker used to filter the batch it already had, so asking for a fresh
   * batch quietly ignored what you had typed — you got another twenty numbers
   * chosen without reference to it. Telnyx supports
   * `filter[phone_number][contains]`, so the search itself can honour it.
   *
   * Two to seven digits: one digit matches nearly everything and is not a
   * search, and past seven there is nothing left of a ten-digit number to
   * choose from.
   */
  contains: z
    .string()
    .regex(/^\d{2,7}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
  const { country, area_code, best_effort, contains, limit } = parsed.data;

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

  // Cost/abuse guard: this JWT-only, company-exempt route fires a live Telnyx
  // inventory search per request, so any signed-in account (even one owning no
  // company) could hammer it. Rate-limit per caller — binding absent in
  // dev/tests → skipped, exactly like every other VERIFY_RATE_LIMITER site.
  // #513: its OWN limiter, not VERIFY's. That one is 3/minute because an OTP
  // send costs money and a resend loop is an attack. A number search is a read,
  // and three refreshes is a normal half-minute of shopping — the fourth used
  // to tell a customer to come back later, mid-purchase.
  const limiter = env.NUMBER_SEARCH_RATE_LIMITER ?? env.VERIFY_RATE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({
      key: `available-numbers:${c.get("userId")}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many number searches. Wait a minute and try again.",
      );
    }
  }

  /*
   * #251: and the FLEET, which the limiter above cannot see.
   *
   * That one bounds a caller. Telnyx's number-management bucket is 5 requests
   * per second for the whole account (measured 2026-08-19, re-readable with
   * scripts/ops/telnyx-rate-limits.mjs) and is the tightest bucket we touch
   * anywhere — five people shopping at once is a plausible Tuesday, and none of
   * them is being unreasonable.
   *
   * Shedding HERE rather than letting Telnyx refuse us matters for two reasons.
   * The same bucket carries number ordering, so an unbounded search flood can
   * block somebody mid-purchase — the one request in this subsystem that must
   * not fail. And a 429 from the vendor arrives as a generic failure the caller
   * cannot act on, whereas this is a sentence that tells them to try again.
   *
   * Same message either way. Whether we shed the request or Telnyx does, what
   * happened is that the phone network was busy, and a customer should not have
   * to tell the difference.
   */
  const fleet = env.NUMBER_SEARCH_FLEET_LIMITER;
  if (fleet) {
    const { success } = await fleet.limit({ key: "available-numbers" });
    if (!success) {
      return errorResponse(
        c,
        "service_unavailable",
        "The phone network is busy right now. Try that again in a moment.",
      );
    }
  }

  const result = await searchInventory(env, {
    country,
    areaCode: area_code,
    bestEffort: best_effort === "true",
    contains,
    limit,
  });
  return c.json(result);
});
