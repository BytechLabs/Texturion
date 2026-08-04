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
import {
  SATISFACTION_MIN_SAMPLE,
  SATISFACTION_POOR_AT_OR_BELOW,
  pipelineInsight,
  pipelineWinRate,
  type PipelineReport,
} from "@loonext/shared";
import { isAfterHours, type BusinessHours, type HoursException } from "@loonext/shared";
import { Hono } from "hono";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { unwrap } from "./core/http";

export const reportsRoutes = new Hono<AppEnv>();

/** Windows the clients offer. Bounded so one request cannot scan all history. */
import {
  buildLeadSourceReport,
  coverageNote,
  type LeadSourceRollupRow,
} from "../reports/lead-sources";

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

/**
 * #482: attach the number a person would recognise, and suppress the breakdown
 * when it would say nothing.
 *
 * Returns `[]` for a workspace whose leads all arrived on ONE number — which
 * is most of them. The row would be the headline again, and a panel that
 * repeats itself teaches people to stop reading it. More than one number is the
 * honest test of "does this tell you something the headline does not", and it
 * is stricter than "the workspace HAS more than one number": a shop with a
 * spare line nobody rings still only has one number worth comparing.
 *
 * A number whose row we cannot label is dropped, not shown with its id. A
 * report that names a number as a UUID is a report somebody has to decode
 * before they can act on it, and the id is meaningless to the reader either
 * way. That can only happen for a number deleted between the leads arriving and
 * this read, which is exactly when the label is least recoverable.
 */
async function labelledByNumber(
  db: ReturnType<typeof getDb>,
  companyId: string,
  rows: StatsPayload["by_number"],
): Promise<LabelledNumberRow[]> {
  if (rows.length < 2) return [];

  const { data, error } = await db
    .from("phone_numbers")
    .select("id,number_e164")
    .eq("company_id", companyId);
  if (error) throw new Error(`by_number labels failed: ${error.message}`);

  const labels = new Map(
    (data ?? [])
      .filter((row): row is { id: string; number_e164: string } =>
        typeof row.number_e164 === "string" && row.number_e164.length > 0,
      )
      .map((row) => [row.id, row.number_e164]),
  );

  const labelled = rows.flatMap((row) => {
    const number = labels.get(row.phone_number_id);
    return number ? [{ ...row, number_e164: number }] : [];
  });
  // Re-checked AFTER dropping the unlabelled: if only one survives, we are back
  // to a row that repeats the headline.
  if (labelled.length < 2) return [];

  // Slowest first. The reader's question is "which line is letting people
  // down", and a list ordered by anything else makes them scan for it. A number
  // with no median at all (nobody answered) sorts to the top, because that is
  // the worst answer there is.
  return labelled.sort(
    (a, b) => (b.median_seconds ?? Infinity) - (a.median_seconds ?? Infinity),
  );
}

interface LabelledNumberRow {
  phone_number_id: string;
  /** The number a person would recognise, e.g. "+14165551234". */
  number_e164: string;
  leads: number;
  answered: number;
  median_seconds: number | null;
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

reportsRoutes.get("/reports/response-time", requireCapability("conversations.read"), async (c) => {
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
    // #482: labelled here rather than in three clients.
    //
    // The RPC returns `phone_number_id`, which is not a thing a person
    // recognises, and resolving it client-side would be the same join written
    // three times — three chances to disagree about which number is which on a
    // screen whose entire job is to be trusted.
    //
    // The single-number rule is decided here too, and that is the more
    // important half: a workspace with one number would see a row that repeats
    // the headline exactly, so the answer is an EMPTY list from the server
    // rather than a condition each client remembers to write. A client cannot
    // get a rule wrong that it was never given.
    by_number: await labelledByNumber(db, companyId, current.by_number),
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

/**
 * #354 — GET /v1/reports/pipeline: quoted, won, lost, still out.
 *
 * The conversion the seeded tags have always held and nothing ever read. It
 * needs no new writes: `conversation_tags.created_at` already records when each
 * stage was applied, which is why #354 calls this cheap and calls it the first
 * honest business metric this product could show an owner.
 *
 * Two windows, so the number has a direction. A win rate with nothing to
 * compare it to is a statistic; the same rate against the period before is a
 * thing to act on.
 */
reportsRoutes.get("/reports/pipeline", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  const requested = Number(c.req.query("days") ?? DEFAULT_DAYS);
  const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_DAYS;

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);

  async function window(from: Date, to: Date): Promise<PipelineReport> {
    const { data, error } = await db.rpc("api_pipeline_report", {
      p_company_id: companyId,
      p_since: from.toISOString(),
      p_until: to.toISOString(),
    });
    if (error) throw new Error(`api_pipeline_report failed: ${error.message}`);
    return data as PipelineReport;
  }

  const [current, previous] = await Promise.all([
    window(since, until),
    window(previousSince, since),
  ]);

  // Which tags the stages currently ARE, so a client can link a stage straight
  // to its list without matching on a name the crew may have changed.
  const tags = unwrap<{ id: string; name: string; pipeline_stage: string }[]>(
    await db
      .from("tags")
      .select("id,name,pipeline_stage")
      .eq("company_id", companyId)
      .not("pipeline_stage", "is", null),
    "pipeline stage tags",
  );

  return c.json({
    days,
    current,
    previous,
    win_rate: pipelineWinRate(current),
    previous_win_rate: pipelineWinRate(previous),
    insight: pipelineInsight(current),
    stages: tags.map((tag) => ({
      stage: tag.pipeline_stage,
      tag_id: tag.id,
      name: tag.name,
    })),
  });
});

/**
 * #313 — GET /v1/reports/satisfaction: how customers rate the work.
 *
 * "Report it against the rest: satisfaction alongside response time (#239) is
 * the beginnings of an honest picture of how the business is doing."
 *
 * COMPARED AGAINST THE PREVIOUS WINDOW, NOT THE FOUNDING FORTNIGHT. Response
 * time uses the founding baseline because the arc it tells is "down from 3
 * hours when you started". Ratings cannot: no workspace that existed before
 * this feature has an answer in its first fortnight, so that baseline would
 * report "no baseline" for every customer forever. #354's pipeline report
 * already established the alternative in this same file — the period before,
 * which works from the first month and is what "did the new hire help?" means.
 *
 * THE SAMPLE FLOOR IS APPLIED HERE, not in three clients. An average of three
 * answers is noise, and #313 is explicit that treating noise as data "damages
 * trust faster than it improves service". The server sends null and the reason;
 * a client cannot get a rule wrong that it was never given (#482).
 */
interface RatingRow {
  score: number | null;
  answered_at: string | null;
  rated_user_id: string | null;
}

interface SatisfactionSlice {
  asked: number;
  answered: number;
  average: number | null;
  poor: number;
  distribution: Record<string, number>;
  truncated: boolean;
}

/** Mean to one decimal, or null when the sample is too thin to mean anything. */
function averageOf(scores: number[]): number | null {
  if (scores.length < SATISFACTION_MIN_SAMPLE) return null;
  const sum = scores.reduce((total, score) => total + score, 0);
  return Math.round((sum / scores.length) * 10) / 10;
}

function sliceOf(rows: RatingRow[], truncated: boolean): SatisfactionSlice {
  const scores = rows
    .map((row) => row.score)
    .filter((score): score is number => score !== null);
  const distribution: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  for (const score of scores) {
    distribution[String(score)] = (distribution[String(score)] ?? 0) + 1;
  }
  return {
    asked: rows.length,
    answered: scores.length,
    average: averageOf(scores),
    poor: scores.filter((score) => score <= SATISFACTION_POOR_AT_OR_BELOW)
      .length,
    distribution,
    truncated,
  };
}

/**
 * #301 — GET /v1/reports/lead-sources: where these customers came from.
 *
 * "Where do my customers come from?" is the question every small-business
 * owner asks and almost none can answer, and it is the one with the most money
 * attached. We sit at the exact point where it becomes knowable.
 *
 * The COVERAGE number is the point of this endpoint, not a footnote on it. A
 * ranking built on a third of the conversations could be reordered completely
 * by the other two thirds, and an owner acting on it would be spending real
 * money on an artefact. `buildLeadSourceReport` computes it and `coverageNote`
 * writes the sentence, both in shared code, so a phone and a laptop cannot
 * disagree about how much of this to believe.
 */
reportsRoutes.get(
  "/reports/lead-sources",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");

    const requested = Number(c.req.query("days") ?? DEFAULT_DAYS);
    const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
      ? requested
      : DEFAULT_DAYS;

    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

    const { data, error } = await db.rpc("api_lead_source_report", {
      p_company_id: companyId,
      p_since: since.toISOString(),
      p_until: until.toISOString(),
    });
    if (error) {
      throw new Error(`api_lead_source_report failed: ${error.message}`);
    }

    const report = buildLeadSourceReport(
      (data ?? []) as LeadSourceRollupRow[],
      days,
    );
    return c.json({ ...report, note: coverageNote(report) });
  },
);

reportsRoutes.get(
  "/reports/satisfaction",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");

    const requested = Number(c.req.query("days") ?? DEFAULT_DAYS);
    const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
      ? requested
      : DEFAULT_DAYS;

    const companies = unwrap<{ response_stats_per_member: boolean }[]>(
      await db
        .from("companies")
        .select("response_stats_per_member")
        .eq("id", companyId)
        .limit(1),
      "satisfaction company lookup",
    );
    const company = companies[0];
    if (!company) {
      throw new Error(`satisfaction: company ${companyId} has no row`);
    }

    const until = new Date();
    const windowMs = days * 24 * 60 * 60 * 1000;
    const since = new Date(until.getTime() - windowMs);
    const priorSince = new Date(since.getTime() - windowMs);

    // One read covering both windows, sliced in memory. Two round trips for
    // two halves of the same small table is a second chance for the boundary
    // to be drawn differently.
    const rows = unwrap<RatingRow[]>(
      await db
        .from("job_ratings")
        .select("score,answered_at,rated_user_id,asked_at")
        .eq("company_id", companyId)
        .gte("asked_at", priorSince.toISOString())
        .order("asked_at", { ascending: false })
        .limit(MAX_ROWS + 1),
      "satisfaction ratings",
    );
    const truncated = rows.length > MAX_ROWS;
    const capped = (truncated ? rows.slice(0, MAX_ROWS) : rows) as (RatingRow & {
      asked_at: string;
    })[];

    const current = capped.filter(
      (row) => new Date(row.asked_at).getTime() >= since.getTime(),
    );
    const prior = capped.filter(
      (row) => new Date(row.asked_at).getTime() < since.getTime(),
    );

    const now = sliceOf(current, truncated);
    const before = sliceOf(prior, truncated);

    // Per member, and only when the owner has said so. Same flag as #239's
    // response stats rather than a second toggle: they are the same decision —
    // "am I looking at people or at the business?" — and splitting it into two
    // switches is how one of them ends up on by accident.
    const byMember = new Map<string, number[]>();
    for (const row of current) {
      if (row.score === null || !row.rated_user_id) continue;
      const list = byMember.get(row.rated_user_id) ?? [];
      list.push(row.score);
      byMember.set(row.rated_user_id, list);
    }

    // Names, resolved here rather than in three clients (#482). An anonymous
    // per-person list cannot answer the question the issue actually asks —
    // "which technician customers are consistently happy with" — so a
    // breakdown without names is a breakdown that is not worth showing.
    // `profiles` has no FK to company_members, so PostgREST cannot embed it.
    const memberIds = [...byMember.keys()];
    const names = new Map<string, string>();
    if (company.response_stats_per_member && memberIds.length > 0) {
      const profiles = unwrap<{ user_id: string; display_name: string }[]>(
        await db
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", memberIds),
        "satisfaction member names",
      );
      for (const profile of profiles) {
        if (profile.display_name) names.set(profile.user_id, profile.display_name);
      }
    }

    return c.json({
      window: {
        days,
        since: since.toISOString(),
        until: until.toISOString(),
      },
      asked: now.asked,
      answered: now.answered,
      average: now.average,
      // Said out loud rather than left for the client to infer from a null
      // average: "we have not asked enough people" and "the people we asked did
      // not reply" are different sentences on the card.
      sample_too_small:
        now.answered > 0 && now.answered < SATISFACTION_MIN_SAMPLE,
      minimum_sample: SATISFACTION_MIN_SAMPLE,
      distribution: now.distribution,
      // The actionable number. Every one of these already woke somebody the day
      // it happened; this is the count, so a month with three is visible as a
      // pattern rather than as three forgotten pushes.
      poor: now.poor,
      by_member: company.response_stats_per_member
        ? [...byMember.entries()]
            .map(([user_id, scores]) => ({
              user_id,
              // Null rather than "Unknown": a member whose profile row is
              // missing is our gap, and the client says so in its own words.
              name: names.get(user_id) ?? null,
              answered: scores.length,
              // The floor again, per person. A member with four answers shows a
              // count and no average, because the coaching conversation that
              // average would start is about them.
              average: averageOf(scores),
            }))
            .sort((a, b) => b.answered - a.answered)
        : null,
      per_member_enabled: company.response_stats_per_member,
      baseline:
        before.average !== null
          ? {
              since: priorSince.toISOString(),
              until: since.toISOString(),
              answered: before.answered,
              average: before.average,
            }
          : null,
      improved_by:
        before.average !== null && now.average !== null
          ? Math.round((now.average - before.average) * 10) / 10
          : null,
      truncated,
      row_limit: MAX_ROWS,
    });
  },
);
