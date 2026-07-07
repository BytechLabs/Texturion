/**
 * GET /v1/usage (SPEC §7, §9; DESIGN G8; D30) — current-period outbound
 * segment usage from usage_events (the app-side source of truth; never
 * Stripe), plus the D30 storage accounting:
 *   { period_start, period_end, included_segments, used_segments,
 *     overage_segments, cap_segments, projected_overage_cents,
 *     history: [{ month: 'YYYY-MM', segments }],
 *     storage: { attachments_bytes, mms_bytes },
 *     voice: { used_minutes, included_minutes },
 *     mms: { used_messages, included_messages } }
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
import { effectiveStorageBudgets } from "../billing/company-modules";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { unwrap } from "./core/http";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_MMS_INCLUDED,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
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
    // Pre-checkout: no numbers → no conversations → no notes/media, so the
    // storage arm is truthfully zero without querying (same posture as the
    // segment fields).
    return c.json({
      period_start: null,
      period_end: null,
      included_segments: 0,
      used_segments: 0,
      inbound_segments: 0,
      overage_segments: 0,
      cap_segments: null,
      projected_overage_cents: 0,
      history: [],
      storage: {
        attachments_bytes: 0,
        mms_bytes: 0,
        attachment_budget_bytes: 0,
        mms_budget_bytes: 0,
      },
      voice: { used_minutes: 0, included_minutes: 0 },
      mms: { used_messages: 0, included_messages: 0 },
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

  // #12: inbound volume this period (visibility only — not billed). Derived
  // from the messages table, the audit's #1 unmeasured cost center.
  const inboundUsed = Number(
    unwrap<number | string>(
      await db.rpc("api_period_inbound_segments", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      "inbound usage sum",
    ),
  );

  const history = unwrap<{ month: string; segments: number }[]>(
    await db.rpc("api_usage_history", {
      p_company_id: companyId,
      p_months: HISTORY_MONTHS,
    }),
    "usage history",
  );

  // D30: per-company stored bytes, both arms, via the exact-sum RPC (a plain
  // PostgREST read would truncate at the row cap — same reason as segments).
  const storage = unwrap<{
    attachments_bytes: number | string;
    mms_bytes: number | string;
  }>(
    await db.rpc("api_storage_usage", { p_company_id: companyId }),
    "storage usage",
  );

  // #12: effective budgets (base plan + extra_storage add-on), so the meter
  // shows the room the company actually has.
  const storageBudgets = await effectiveStorageBudgets(
    db,
    companyId,
    company.plan,
  );

  // #12: call-forwarding minutes this period, summed over both legs from
  // call_records. Whole minutes for display (the cap works in seconds).
  const voiceSeconds = Number(
    unwrap<number | string>(
      await db.rpc("api_period_voice_seconds", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      "voice usage sum",
    ),
  );

  // #12: outbound picture messages already sent this period — the same
  // period-count RPC the send-time cap-and-drop and usage-alert arm read.
  const mmsUsed = Number(
    unwrap<number | string>(
      await db.rpc("api_period_outbound_mms", {
        p_company_id: companyId,
        p_since: company.current_period_start,
      }),
      "mms usage count",
    ),
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
    inbound_segments: inboundUsed,
    overage_segments: overage,
    cap_segments: multiplier === null ? null : Math.round(included * multiplier),
    projected_overage_cents: Math.round(
      overage * PLAN_OVERAGE_CENTS_PER_SEGMENT[company.plan],
    ),
    history,
    storage: {
      attachments_bytes: Number(storage.attachments_bytes),
      mms_bytes: Number(storage.mms_bytes),
      attachment_budget_bytes: storageBudgets.attachmentBytes,
      mms_budget_bytes: storageBudgets.mmsBytes,
    },
    voice: {
      used_minutes: Math.floor(voiceSeconds / 60),
      included_minutes: PLAN_VOICE_MINUTES[company.plan],
    },
    mms: {
      used_messages: mmsUsed,
      included_messages: PLAN_MMS_INCLUDED[company.plan],
    },
  });
});
