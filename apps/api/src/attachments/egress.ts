/**
 * #16 signed-URL egress metering (cost-protection mandate; docs/PRICING-AUDIT.md
 * §2/§4 "egress is the sleeper cost (4x storage)... meter + cap per plan").
 *
 * Downloads hit Supabase Storage directly, so the Worker can never observe the
 * bytes on the wire — the MINT of a signed URL is the meterable moment, and the
 * object's size_bytes is the downloadable exposure that mint created. Every
 * mint atomically claims those bytes against a per-company monthly allowance
 * via `claim_signed_url_egress` (the guarded-claim idiom: advisory-lock re-sum
 * + insert, no check-then-write TOCTOU). Over the allowance the mint is refused
 * (`usage_cap_reached`); the 80%/100% owner alerts fire from the usage-alerts
 * cron BEFORE the cap bites (its `egress` arm reads `api_period_egress_bytes`).
 *
 * The allowance is derived, not configured: EGRESS_ALLOWANCE_MULTIPLIER × the
 * company's combined EFFECTIVE storage budgets (attachments + MMS pools, each
 * already grown by the extra_storage add-on via effectiveStorageBudgets) — so
 * it scales with the plan and with #12 modules automatically, no new env.
 * Base figures: Starter 4×(5+5) = 40 GB/period, Pro 4×(25+25) = 200 GB/period —
 * generous for honest use (re-downloading the entire stored pool four times
 * over), a hard wall for the scripted re-download abuse in #16.
 *
 * FAIL CLOSED: a claim error (RPC failure, garbage shape) throws — no URL is
 * minted when the accounting can't be trusted.
 *
 * `assertEgressWithinAllowance` is the one gate EVERY mint path calls before
 * signing — the /v1/attachments/:id/url route AND the conversation gallery
 * (GET /v1/conversations/:id/attachments), which signs the exact same objects
 * and would otherwise be a free side door around the cap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { effectiveStorageBudgets } from "../billing/company-modules";
import { type PlanId } from "../billing/plans";
import { ApiError } from "../http/errors";
import { unwrap } from "../routes/core/http";

/**
 * Monthly egress allowance as a multiple of the combined storage budgets — the
 * PRICING-AUDIT's own "egress ≈ 4x storage" sizing. Worst case per maxed Pro
 * tenant: 200 GB × $0.09/GB ≈ $18/mo of egress against $79 of revenue, still
 * inside margin — vs the unbounded ~$250+/mo the unmetered route allowed.
 */
export const EGRESS_ALLOWANCE_MULTIPLIER = 4;

/**
 * The company's per-period signed-URL egress allowance in bytes. One pool for
 * both buckets (attachments + MMS media) — a download is a download; the split
 * pools matter for STORED bytes (D30) where the cap behaviours differ, not for
 * the read side.
 */
export function egressAllowanceBytes(budgets: {
  attachmentBytes: number;
  mmsBytes: number;
}): number {
  return EGRESS_ALLOWANCE_MULTIPLIER * (budgets.attachmentBytes + budgets.mmsBytes);
}

/**
 * The period window egress is summed over: the company's live billing period
 * when it has one, else the current UTC calendar month (a pre-checkout company
 * has no period start; it must still never mean "no window" — fail-closed
 * posture, the same Starter-defaults stance as companyStorageBudget).
 */
export function egressPeriodStart(currentPeriodStart: string | null): string {
  if (currentPeriodStart) return currentPeriodStart;
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

/**
 * Shape of the claim_signed_url_egress RPC result
 * (20260707120000_storage_egress_and_orphans.sql).
 */
const egressClaimSchema = z.object({
  allowed: z.boolean(),
  used_bytes: z.coerce.number(),
});

export interface EgressClaim {
  allowed: boolean;
  usedBytes: number;
}

/**
 * Atomically claim `bytes` of signed-URL egress against the company's period
 * allowance. `allowed: false` means the mint must be refused (over allowance,
 * nothing was written). Any RPC error or malformed result THROWS — the caller
 * must not mint a URL it could not account for (fail closed).
 */
export async function claimSignedUrlEgress(
  db: SupabaseClient,
  args: {
    companyId: string;
    since: string;
    bucket: string;
    bytes: number;
    limitBytes: number;
  },
): Promise<EgressClaim> {
  const { data, error } = await db.rpc("claim_signed_url_egress", {
    p_company_id: args.companyId,
    p_since: args.since,
    p_bucket: args.bucket,
    p_bytes: args.bytes,
    p_limit_bytes: args.limitBytes,
  });
  if (error) {
    throw new Error(`claim_signed_url_egress failed: ${error.message}`);
  }
  const result = egressClaimSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `claim_signed_url_egress returned an unexpected shape: ${result.error}`,
    );
  }
  return { allowed: result.data.allowed, usedBytes: result.data.used_bytes };
}

/**
 * The plan + billing-period anchor both the storage-budget and egress-allowance
 * resolvers read. A plan-null (pre-checkout) company gets the Starter posture
 * (same stance as seatLimit in routes/core/plans.ts) and a null period anchor
 * (→ the calendar-month fallback above).
 */
export async function companyPlanRow(
  db: SupabaseClient,
  companyId: string,
): Promise<{ plan: PlanId; currentPeriodStart: string | null }> {
  const companies = unwrap<
    { plan: PlanId | null; current_period_start: string | null }[]
  >(
    await db
      .from("companies")
      .select("plan,current_period_start")
      .eq("id", companyId)
      .is("deleted_at", null)
      .limit(1),
    "company plan lookup",
  );
  return {
    plan: companies[0]?.plan ?? "starter",
    currentPeriodStart: companies[0]?.current_period_start ?? null,
  };
}

/** One to-be-signed Storage object: its bucket and accounted size. */
export interface EgressObject {
  bucket: string;
  /** A legacy MMS row can carry a NULL size (pre-metering ingest); claims 0. */
  sizeBytes: number | null;
}

/**
 * #16: atomically claim signed-URL egress for a batch of to-be-signed objects
 * — every mint path calls this BEFORE signing anything. The company's
 * allowance is resolved ONCE per call (4× the combined effective storage
 * budgets via egressAllowanceBytes, window = live billing period with the
 * calendar-month fallback), then ONE claim per bucket present carries that
 * bucket's summed bytes — so a full 100-item gallery page costs at most two
 * claim RPCs, and the ledger keeps honest per-bucket attribution while the
 * allowance itself stays a single pool. Over the allowance → 402
 * `usage_cap_reached` with plain copy and NO further claims (bytes already
 * claimed for an earlier bucket of the same refused page stay burnt — the
 * error side that overcounts near the cap, never undercounts). Any accounting
 * error throws — nothing may be signed when the claim can't be trusted (fail
 * closed).
 */
export async function assertEgressWithinAllowance(
  db: SupabaseClient,
  companyId: string,
  objects: readonly EgressObject[],
): Promise<void> {
  if (objects.length === 0) return;

  const { plan, currentPeriodStart } = await companyPlanRow(db, companyId);
  const budgets = await effectiveStorageBudgets(db, companyId, plan);
  const limitBytes = egressAllowanceBytes(budgets);
  const since = egressPeriodStart(currentPeriodStart);

  const bytesByBucket = new Map<string, number>();
  for (const object of objects) {
    bytesByBucket.set(
      object.bucket,
      (bytesByBucket.get(object.bucket) ?? 0) + Number(object.sizeBytes ?? 0),
    );
  }

  for (const [bucket, bytes] of bytesByBucket) {
    const claim = await claimSignedUrlEgress(db, {
      companyId,
      since,
      bucket,
      bytes,
      limitBytes,
    });
    if (!claim.allowed) {
      const allowanceGb = Math.round(limitBytes / (1024 * 1024 * 1024));
      throw new ApiError(
        "usage_cap_reached",
        `Your plan's ${allowanceGb} GB of file downloads for this billing period ` +
          `is used up — downloads resume when your next period starts.`,
      );
    }
  }
}
