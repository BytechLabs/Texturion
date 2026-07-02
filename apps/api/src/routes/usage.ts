/**
 * GET /v1/usage (SPEC §7, §9; DESIGN G8) — current-period outbound segment
 * usage from usage_events (the app-side source of truth; never Stripe):
 *   { period_start, period_end, included_segments, used_segments,
 *     overage_segments, cap_segments, projected_overage_cents,
 *     history: [{ month: 'YYYY-MM', segments }] }
 * cap_segments = included × overage_cap_multiplier (null multiplier = no cap,
 * SPEC §2). `history` is the last 6 calendar months (oldest first, zero-
 * filled) for the G8 "6-month history bars". A company that has never checked
 * out (plan null / no period) reads as zero usage with an empty history.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { unwrap } from "./core/http";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  type PlanId,
} from "./core/plans";

interface CompanyUsageRow {
  plan: PlanId | null;
  current_period_start: string | null;
  current_period_end: string | null;
  overage_cap_multiplier: number | string | null;
}

/** DESIGN G8: the usage screen renders a 6-month history. */
const HISTORY_MONTHS = 6;

export const usageRoutes = new Hono<AppEnv>();

usageRoutes.get("/usage", requireRole("member"), async (c) => {
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const companies = unwrap<CompanyUsageRow[]>(
    await db
      .from("companies")
      .select(
        "plan,current_period_start,current_period_end,overage_cap_multiplier",
      )
      .eq("id", companyId)
      .is("deleted_at", null)
      .limit(1),
    "company lookup",
  );
  const company = companies[0];
  if (!company) {
    return errorResponse(c, "not_found", "No such company.");
  }

  if (company.plan === null || company.current_period_start === null) {
    return c.json({
      period_start: null,
      period_end: null,
      included_segments: 0,
      used_segments: 0,
      overage_segments: 0,
      cap_segments: null,
      projected_overage_cents: 0,
      history: [],
    });
  }

  const used = Number(
    unwrap<number | string>(
      await db.rpc("api_period_segments", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      "usage sum",
    ),
  );

  const history = unwrap<{ month: string; segments: number }[]>(
    await db.rpc("api_usage_history", {
      p_company_id: companyId,
      p_months: HISTORY_MONTHS,
    }),
    "usage history",
  );

  const included = PLAN_INCLUDED_SEGMENTS[company.plan];
  const overage = Math.max(0, used - included);
  const multiplier =
    company.overage_cap_multiplier === null
      ? null
      : Number(company.overage_cap_multiplier);

  return c.json({
    period_start: company.current_period_start,
    period_end: company.current_period_end,
    included_segments: included,
    used_segments: used,
    overage_segments: overage,
    cap_segments: multiplier === null ? null : Math.round(included * multiplier),
    projected_overage_cents: Math.round(
      overage * PLAN_OVERAGE_CENTS_PER_SEGMENT[company.plan],
    ),
    history,
  });
});
