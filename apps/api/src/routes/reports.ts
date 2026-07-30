/**
 * GET /v1/reports/response-time (#239) — how fast this workspace answers a new
 * customer, and how that changed since they started.
 *
 * WHY THIS EXISTS. The whole market position is that the business which answers
 * first gets the job, and we shipped a product around that claim without ever
 * instrumenting it. A contractor who can watch their median first-response time
 * fall after signing up will not churn and will repeat the number to other
 * contractors. One who cannot is paying a monthly bill for a feeling.
 *
 * THE DEFINITION LIVES IN THE SQL, and `docs/RESPONSE-TIME.md` states it in the
 * words this API and the three clients use. In short: one measurement per
 * conversation — the first inbound message, and the first HUMAN reply after it
 * (`automated = false`, because an auto-reply is the state this product exists
 * to get out of, not a response to it). Threads we opened are not leads, notes
 * are not replies, spam is excluded, and a lead nobody answered is COUNTED —
 * dropping it would let a workspace improve its median by ignoring more leads.
 *
 * WHAT THIS LAYER ADDS, and why it is here rather than in SQL:
 *
 *   1. THE BUSINESS-HOURS SPLIT. `isAfterHours` in packages/shared is the one
 *      implementation of the weekday loop, the timezone placement and the #402
 *      date exceptions, and the 20260730002500 migration says why it stays
 *      there: "the shape is enforced there, not here, so the four surfaces share
 *      one rule". A plpgsql copy would be a fifth, and the copy that drifts is
 *      always the one nobody reads.
 *
 *   2. THE ARC. The before/after is the product story, so the first fourteen
 *      days after signup are the baseline. It is returned as null, with a
 *      reason, whenever the workspace is too young for the two windows to be
 *      distinct — an invented arc is exactly the vanity metric #239 warns about.
 *
 *   3. THE PER-MEMBER GATE. `companies.response_stats_per_member` defaults to
 *      FALSE. Per-member numbers are motivating in some crews and toxic in
 *      others, so naming individuals is the owner's choice. Once the owner has
 *      made it, the whole crew sees it — a leaderboard nobody may look at is not
 *      a leaderboard, and the opt-in IS the control.
 */
import { isAfterHours, type BusinessHours, type HoursException } from "@loonext/shared";
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { unwrap } from "./core/http";

export const reportsRoutes = new Hono<AppEnv>();

/** Windows the clients offer. Bounded so one request cannot scan all history. */
const ALLOWED_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

/**
 * The baseline window: the workspace's first fortnight.
 *
 * Two weeks rather than one because a three-person crew can take very few leads
 * in seven days, and an arc drawn from two of them is noise presented as
 * progress.
 */
const BASELINE_DAYS = 14;

/** Rows the RPC returns for the hours split. Reported when it truncates. */
const MAX_ROWS = 5000;

interface LeadRow {
  conversation_id: string;
  phone_number_id: string | null;
  opened_at: string;
  responded_at: string | null;
  responder_user_id: string | null;
  response_seconds: number | null;
}

interface StatsPayload {
  leads: number;
  answered: number;
  unanswered: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  by_member: { user_id: string; answered: number; median_seconds: number }[];
  by_number: {
    phone_number_id: string;
    leads: number;
    answered: number;
    median_seconds: number | null;
  }[];
  rows: LeadRow[];
  row_limit: number;
  truncated: boolean;
}

interface CompanyRow {
  created_at: string;
  timezone: string;
  business_hours: BusinessHours | null;
  business_hours_exceptions: HoursException[] | null;
  response_stats_per_member: boolean;
}

/** The median of a sample, or null when there is nothing to take one of. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Even-length samples average the middle pair, matching percentile_cont's
  // linear interpolation at 0.5 — the aggregate the SQL reports. Two different
  // medians for the same data, one in each layer, is precisely the kind of
  // disagreement that makes a customer stop trusting the number.
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** One side of the business-hours split. */
function sideOf(rows: LeadRow[]): {
  leads: number;
  answered: number;
  median_seconds: number | null;
} {
  const answered = rows
    .map((row) => row.response_seconds)
    .filter((seconds): seconds is number => seconds !== null);
  return {
    leads: rows.length,
    answered: answered.length,
    median_seconds: median(answered),
  };
}

reportsRoutes.get("/reports/response-time", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");

  const requested = Number(c.req.query("days") ?? DEFAULT_DAYS);
  const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_DAYS;

  const companies = unwrap<CompanyRow[]>(
    await db
      .from("companies")
      .select(
        "created_at,timezone,business_hours,business_hours_exceptions," +
          "response_stats_per_member",
      )
      .eq("id", companyId)
      .limit(1),
    "response-time company lookup",
  );
  const company = companies[0];
  if (!company) {
    // Not a client error: authorization already proved this member belongs to
    // this workspace, so a missing row is our bug. A 404 here would tell the
    // customer their workspace does not exist and hide the real cause.
    throw new Error(`response-time: company ${companyId} has no row`);
  }

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  async function stats(from: Date, to: Date): Promise<StatsPayload> {
    const { data, error } = await db.rpc("api_response_time_stats", {
      p_company_id: companyId,
      p_since: from.toISOString(),
      p_until: to.toISOString(),
      p_max_rows: MAX_ROWS,
    });
    if (error) {
      throw new Error(`api_response_time_stats failed: ${error.message}`);
    }
    return data as StatsPayload;
  }

  const current = await stats(since, until);

  // The split. Each lead is classified by WHEN THE CUSTOMER WROTE, not when we
  // answered: the question is how fast we answer a message that arrived out of
  // hours, and grouping by our own reply time would put a 9am answer to a
  // midnight text in the business-hours bucket and flatter it.
  const hours = company.business_hours ?? {};
  const exceptions = company.business_hours_exceptions ?? [];
  const afterHours: LeadRow[] = [];
  const inHours: LeadRow[] = [];
  for (const row of current.rows) {
    const at = new Date(row.opened_at);
    const side = isAfterHours(company.timezone, hours, at, exceptions)
      ? afterHours
      : inHours;
    side.push(row);
  }

  // The arc. The baseline is the workspace's first fortnight; it is only
  // meaningful once the current window no longer overlaps it, so a young
  // workspace gets an explicit reason instead of a comparison against itself.
  const createdAt = new Date(company.created_at);
  const baselineUntil = new Date(
    createdAt.getTime() + BASELINE_DAYS * 24 * 60 * 60 * 1000,
  );
  let baseline: (StatsPayload & { since: string; until: string }) | null = null;
  let baselineUnavailable: string | null = null;
  if (baselineUntil > since) {
    baselineUnavailable = "too_new";
  } else {
    const first = await stats(createdAt, baselineUntil);
    if (first.answered === 0) {
      // A first fortnight with no answered lead is not a baseline of zero; it is
      // no baseline. Reporting it as an improvement from nothing would be the
      // arc as fiction.
      baselineUnavailable = "no_answered_leads";
    } else {
      baseline = {
        ...first,
        since: createdAt.toISOString(),
        until: baselineUntil.toISOString(),
      };
    }
  }

  const improvedBy =
    baseline?.median_seconds != null && current.median_seconds != null
      ? baseline.median_seconds - current.median_seconds
      : null;

  return c.json({
    window: {
      days,
      since: since.toISOString(),
      until: until.toISOString(),
    },
    leads: current.leads,
    answered: current.answered,
    // Named plainly. This is the leak the issue asks to have named, and it is
    // the number a workspace could otherwise improve by ignoring more leads.
    unanswered: current.unanswered,
    median_seconds: current.median_seconds,
    p90_seconds: current.p90_seconds,
    business_hours: sideOf(inHours),
    after_hours: sideOf(afterHours),
    by_number: current.by_number,
    // Null, not an empty list: "the owner has not opted in" and "nobody has
    // answered anything" are different facts and the clients say different
    // things about them.
    by_member: company.response_stats_per_member ? current.by_member : null,
    per_member_enabled: company.response_stats_per_member,
    baseline: baseline
      ? {
          since: baseline.since,
          until: baseline.until,
          leads: baseline.leads,
          answered: baseline.answered,
          median_seconds: baseline.median_seconds,
        }
      : null,
    baseline_unavailable: baselineUnavailable,
    improved_by_seconds: improvedBy,
    // The hours split is computed over the returned rows, so if the RPC capped
    // them the split covers a subset. Said out loud rather than implied — a cap
    // that reports nothing reads as "we looked at everything".
    split_truncated: current.truncated,
    split_row_limit: current.row_limit,
  });
});
