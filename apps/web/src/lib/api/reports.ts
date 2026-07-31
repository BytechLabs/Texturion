/**
 * #239 — the response-time report hook. GET /v1/reports/response-time.
 *
 * The definition of every number here lives in `docs/RESPONSE-TIME.md`, and the
 * server computes all of it: this hook does no arithmetic, because a median
 * computed twice is a median that can disagree with itself.
 */
import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/** Windows the API accepts; anything else is clamped server-side to 30. */
export type ResponseTimeWindow = 7 | 30 | 90;

export interface ResponseTimeSide {
  leads: number;
  answered: number;
  median_seconds: number | null;
}

export interface ResponseTimeReport {
  window: { days: number; since: string; until: string };
  leads: number;
  answered: number;
  unanswered: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  business_hours: ResponseTimeSide;
  after_hours: ResponseTimeSide;
  /**
   * #482: per-number medians, slowest first, ALREADY labelled and already
   * filtered — the server returns an empty list when the leads arrived on one
   * number, because that row would repeat the headline. Nothing here decides
   * whether to show it; the length does.
   */
  by_number: {
    number_e164: string;
    phone_number_id: string;
    leads: number;
    answered: number;
    median_seconds: number | null;
  }[];
  /** Null when the owner has not opted in — NOT the same as an empty crew. */
  by_member: { user_id: string; answered: number; median_seconds: number }[] | null;
  per_member_enabled: boolean;
  baseline: {
    since: string;
    until: string;
    leads: number;
    answered: number;
    median_seconds: number | null;
  } | null;
  /** Why there is no arc: 'too_new' | 'no_answered_leads' | null. */
  baseline_unavailable: string | null;
  improved_by_seconds: number | null;
  split_truncated: boolean;
  split_row_limit: number;
}

export function useResponseTime(days: ResponseTimeWindow = 30) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.responseTime(companyId, days),
    queryFn: () =>
      apiFetch<ResponseTimeReport>("/v1/reports/response-time", {
        companyId,
        searchParams: { days: String(days) },
      }),
  });
}
