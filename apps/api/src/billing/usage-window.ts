/**
 * #304 — what a workspace used between two instants, asked once.
 *
 * WHY THIS IS A MODULE. The usage screen used to ask three questions of three
 * tables — usage_events for billed segments, messages for inbound volume,
 * call_records for voice — each with its own `>= since` and no upper bound.
 * That held while the only answerable window was "the current period, so far".
 *
 * #304 needs a CLOSED window: a bookkeeper's month that has already ended. Two
 * callers computing a bounded total from three unbounded reads is two chances
 * to disagree about the same workspace, and the disagreement would surface as
 * an export that contradicts the screen the owner is looking at. Whichever one
 * they believe, they have lost confidence in both.
 *
 * So there is one question, asked here, of `api_usage_window`.
 *
 * `to: null` means "still running", which is what the live screen asks for. It
 * is deliberately not "now": a period that has not ended must not be trimmed by
 * whichever clock happened to answer, and null says so where a timestamp would
 * quietly claim the period had closed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "../routes/core/http";

export interface UsageWindow {
  /** Inclusive start of the window. */
  from: string;
  /** Inclusive end, or null when the window is still running. */
  to: string | null;
}

export interface UsageTotals {
  /** Billed outbound segments — the meter, and the only arm Stripe sees. */
  outboundSegments: number;
  /** Received segments. Visibility only; never billed (#12). */
  inboundSegments: number;
  /** Dialed-leg seconds — both legs the voice meter bills (D36). */
  voiceSeconds: number;
  /**
   * The reconciliation split, and the reason a bookkeeper can use this at all.
   *
   * We do not store Stripe's invoice, so nothing here restates it. What we do
   * store is whether each meter row has been REPORTED to Stripe yet. Segments
   * still unreported are metered usage that is on no invoice — they land on a
   * later one, and that difference is otherwise the phone call we get.
   *
   * These two always sum to `outboundSegments`; the SQL suite asserts it.
   */
  reportedSegments: number;
  unreportedSegments: number;
}

interface WindowRow {
  outbound_segments: number | string;
  inbound_segments: number | string;
  forward_seconds: number | string;
  reported_segments: number | string;
  unreported_segments: number | string;
}

export async function readUsageWindow(
  db: SupabaseClient,
  companyId: string,
  window: UsageWindow,
): Promise<UsageTotals> {
  const rows = unwrap<WindowRow[]>(
    await db.rpc("api_usage_window", {
      p_company_id: companyId,
      p_from: window.from,
      p_to: window.to,
    }),
    "usage window",
  );
  // A set-returning function with every arm coalesced always yields one row.
  // The fallback is here so a shape change reads as zeros rather than throwing
  // on the usage screen, which is a member surface the composer depends on.
  const row = rows[0];
  return {
    outboundSegments: Number(row?.outbound_segments ?? 0),
    inboundSegments: Number(row?.inbound_segments ?? 0),
    voiceSeconds: Number(row?.forward_seconds ?? 0),
    reportedSegments: Number(row?.reported_segments ?? 0),
    unreportedSegments: Number(row?.unreported_segments ?? 0),
  };
}
