/**
 * GET /v1/usage (SPEC §7, §9; DESIGN G8; D30) — current-period outbound
 * segment usage from usage_events (the app-side source of truth; never
 * Stripe), plus the D30 storage accounting:
 *   { status, period_start, period_end, included_segments, used_segments,
 *     overage_segments, cap_segments, projected_overage_cents,
 *     history: [{ month: 'YYYY-MM', segments }],
 *     storage: { attachments_bytes, mms_bytes },
 *     voice: { used_minutes, included_minutes, cap_minutes, overage_minutes,
 *              projected_overage_cents } }
 *
 * #178 — `status` is the fair-use presentation contract, derived HERE so every
 * client renders the same philosophy (marketing promises fair use, not walls):
 *   'quiet'  — projected to stay inside plan economics (the overwhelming
 *              default): clients show NO meters, NO "X of Y", just the quiet
 *              fair-use line.
 *   'pacing' — the #85 projection says this period runs hot: clients surface
 *              the early warning with overage_projection's projected charges.
 *   'capped' — the owner-set spending cap is approaching (≥90%) or reached on
 *              either meter: clients show the cap state and the owner control.
 * Raw numbers stay in the payload for the owner-facing "details" affordance.
 * (#97/#103: no `mms` meter — pictures count 3 segments each in the message
 * meter, with no separate cap.)
 * cap_segments = included × overage_cap_multiplier (null multiplier = no cap,
 * SPEC §2). `history` is the last 6 calendar months (oldest first, zero-
 * filled) for the G8 "6-month history bars". `storage` (D30) is the
 * company's stored bytes — attachments_bytes = LIVE generic (note-borne)
 * attachments, the arm the plan budget gates on upload; mms_bytes =
 * message_attachments media, display-only (inbound MMS is never blocked on a
 * budget). Both from the exact-sum api_storage_usage RPC. A company that has
 * never checked out (plan null / no period) reads as zero usage with an
 * empty history and zero storage — it cannot own files or media yet.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import { decideOverage } from "../billing/overage-projection";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { unwrap } from "./core/http";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
  type PlanId,
} from "./core/plans";

interface CompanyUsageRow {
  plan: PlanId | null;
  current_period_start: string | null;
  current_period_end: string | null;
  overage_cap_multiplier: number | string | null;
  us_texting_enabled: boolean;
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
        "plan,current_period_start,current_period_end,overage_cap_multiplier,us_texting_enabled",
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
    // Pre-checkout: no numbers → no conversations → no notes/media, so the
    // storage arm is truthfully zero without querying (same posture as the
    // segment fields).
    return c.json({
      status: "quiet",
      period_start: null,
      period_end: null,
      included_segments: 0,
      used_segments: 0,
      inbound_segments: 0,
      overage_segments: 0,
      cap_segments: null,
      projected_overage_cents: 0,
      overage_projection: { trending_over: false, projected_overage_cents: 0 },
      history: [],
      storage: {
        attachments_bytes: 0,
        mms_bytes: 0,
        attachment_budget_bytes: 0,
        mms_budget_bytes: 0,
      },
      voice: {
        used_minutes: 0,
        included_minutes: 0,
        cap_minutes: null,
        overage_minutes: 0,
        projected_overage_cents: 0,
        overage_billed: true,
      },
      // #103 one-release shim: pre-#103 web bundles still loaded in a browser
      // tab read data.mms.* — zeros keep them from crashing (included 0 hides
      // their meter). Remove once those bundles have aged out.
      mms: { used_messages: 0, included_messages: 0 },
    });
  }

  const included = PLAN_INCLUDED_SEGMENTS[company.plan];
  const multiplier =
    company.overage_cap_multiplier === null
      ? null
      : Number(company.overage_cap_multiplier);

  // These reads are mutually independent (all keyed on company + period), so
  // issue them in ONE parallel batch instead of six serial awaits. The end-of-
  // period projection (decideOverage) depends only on `company` + `multiplier`,
  // never on the sums below, so it joins the same batch.
  const [usedRes, inboundRes, historyRes, storageRes, voiceRes, projection] =
    await Promise.all([
      db.rpc("api_period_segments", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      // #12: inbound volume this period (visibility only — not billed).
      db.rpc("api_period_inbound_segments", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      db.rpc("api_usage_history", {
        p_company_id: companyId,
        p_months: HISTORY_MONTHS,
      }),
      // D30: per-company stored bytes via the exact-sum RPC (a PostgREST read
      // would truncate at the row cap — same reason as segments).
      db.rpc("api_storage_usage", { p_company_id: companyId }),
      // #12/D36: forwarded (dialed-leg) seconds — the fair-use measure the
      // allowance, the 1¢/min meter, and the spending-cap gate share.
      db.rpc("api_period_forward_seconds", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      // #85/#93: dynamic END-OF-PERIOD projection (extrapolated), distinct from
      // the overage-SO-FAR figure. Exposes only customer-facing bits, never our
      // internal cost/margin; gates the conditional overage surface in settings.
      decideOverage(
        db,
        {
          id: companyId,
          plan: company.plan,
          current_period_start: company.current_period_start,
          current_period_end: company.current_period_end,
          us_texting_enabled: company.us_texting_enabled,
          overage_cap_multiplier: multiplier,
        },
        new Date(),
      ),
    ]);
  const used = Number(unwrap<number | string>(usedRes, "usage sum"));
  const inboundUsed = Number(
    unwrap<number | string>(inboundRes, "inbound usage sum"),
  );
  const history = unwrap<{ month: string; segments: number }[]>(
    historyRes,
    "usage history",
  );
  const storage = unwrap<{
    attachments_bytes: number | string;
    mms_bytes: number | string;
  }>(storageRes, "storage usage");
  const voiceSeconds = Number(
    unwrap<number | string>(voiceRes, "voice usage sum"),
  );
  const overage = Math.max(0, used - included);
  // D36: voice mirrors the segment shape — used vs the fair-use allowance,
  // overage-so-far at 1¢/min rated to the second (the meter bills the same
  // raw seconds this RPC sums, so these figures can never diverge from the
  // invoice), and a cap where calling pauses.
  // #134/D42: calling is included on every plan (the grandfathered legacy
  // line retired with the module) — plan allowances for everyone.
  const voiceUsedMinutes = Math.floor(voiceSeconds / 60);
  const includedVoiceMinutes = PLAN_VOICE_MINUTES[company.plan];
  const voiceOverageSeconds = Math.max(
    0,
    voiceSeconds - includedVoiceMinutes * 60,
  );
  const voiceOverageMinutes = Math.floor(voiceOverageSeconds / 60);

  // #178 status (see the header contract). Cap nearness checks BOTH meters —
  // texting pauses at cap_segments and calling at the same multiplier over its
  // own allowance — at 90%, mirroring the cost-mandate's alert-BEFORE-the-cap.
  const capSegments =
    multiplier === null ? null : Math.round(included * multiplier);
  const capVoiceSeconds =
    multiplier === null ? null : includedVoiceMinutes * 60 * multiplier;
  const nearCap =
    (capSegments !== null && capSegments > 0 && used >= 0.9 * capSegments) ||
    (capVoiceSeconds !== null &&
      capVoiceSeconds > 0 &&
      voiceSeconds >= 0.9 * capVoiceSeconds);
  const status = nearCap
    ? "capped"
    : projection.trendingOver
      ? "pacing"
      : "quiet";

  return c.json({
    status,
    period_start: company.current_period_start,
    period_end: company.current_period_end,
    included_segments: included,
    used_segments: used,
    inbound_segments: inboundUsed,
    overage_segments: overage,
    cap_segments: capSegments,
    projected_overage_cents: Math.round(
      overage * PLAN_OVERAGE_CENTS_PER_SEGMENT[company.plan],
    ),
    overage_projection: {
      trending_over: projection.trendingOver,
      projected_overage_cents: Math.round(
        projection.projectedOverageChargesCents,
      ),
    },
    history,
    storage: {
      attachments_bytes: Number(storage.attachments_bytes),
      mms_bytes: Number(storage.mms_bytes),
      // #121 one-release shim: storage is free (no budgets exist). Pre-#121
      // web bundles still loaded in a tab read the *_budget_bytes fields —
      // zeros hide their meters (nearLimit(x, 0) is false) without crashing.
      // Remove once those bundles have aged out.
      attachment_budget_bytes: 0,
      mms_budget_bytes: 0,
    },
    voice: {
      used_minutes: voiceUsedMinutes,
      included_minutes: includedVoiceMinutes,
      // D36: calling pauses at the SAME spending cap as texts.
      cap_minutes:
        multiplier === null
          ? null
          : Math.round(includedVoiceMinutes * multiplier),
      overage_minutes: voiceOverageMinutes,
      projected_overage_cents: Math.round(
        (voiceOverageSeconds / 60) * VOICE_OVERAGE_CENTS_PER_MINUTE,
      ),
      // #134: always true since D42 (grandfathered retired with the module);
      // kept for API-shape stability with deployed web bundles.
      overage_billed: true,
    },
    // #97/#103: no `mms` meter — picture messages have no separate cap; each
    // MMS counts 3 segments inside the message meter above. The zeros below
    // are a ONE-RELEASE shim: pre-#103 web bundles still loaded in a browser
    // tab read data.mms.* (included 0 hides their meter, nothing crashes).
    // Remove once those bundles have aged out.
    mms: { used_messages: 0, included_messages: 0 },
  });
});
