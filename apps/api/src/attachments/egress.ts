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
 * a fixed per-period pool, EGRESS_ALLOWANCE_BYTES) — so
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

import { type PlanId } from "../billing/plans";
import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { unwrap } from "../routes/core/http";

/**
 * #121: the download allowance is a FIXED per-period pool now that the
 * storage budgets it used to derive from (4x their sum) are gone. 200 GB/mo
 * matches the old maxed-Pro ceiling, so no legitimate tenant is newly
 * blocked, while a hotlink/scrape abuser still hits a wall: worst case
 * 200 GB x ~$0.09/GB = ~$18/mo of egress, inside margin. This is an
 * anti-abuse cost backstop (never marketed as a plan limit); the fair-use
 * policy's reasonable-use line covers the human follow-up.
 */
export const EGRESS_ALLOWANCE_BYTES = 200 * 1024 * 1024 * 1024;

/**
 * #261: how long a claim keeps covering its object.
 *
 * The ledger used to charge per REQUEST, so asking for a URL to the same
 * attachment twice cost twice — even though the first URL was still valid and
 * nothing new had become downloadable. That made the whole workspace's period
 * allowance reachable from a single 25 MB file with a shell loop, after which
 * every download, gallery page, MMS thumbnail and voicemail in the company
 * answered 402 until the period rolled, with no way to reset it.
 *
 * A claim now covers its object for as long as the URL it paid for could still
 * be used. The default matches the longest TTL any mint path hands out (the
 * MMS gallery and voicemail playback, 1 h); paths with shorter URLs pass their
 * own. Erring long is the safe direction here: the risk of a too-long window
 * is undercounting egress we would have absorbed anyway, while too short
 * re-opens the amplification.
 */
export const EGRESS_DEDUPE_SECONDS = 60 * 60;

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
 * Shape of the claim_signed_url_egress_objects RPC result
 * (20260726000100_egress_claim_per_object.sql).
 */
const egressClaimSchema = z.object({
  allowed: z.boolean(),
  used_bytes: z.coerce.number(),
  claimed_bytes: z.coerce.number(),
});

export interface EgressClaim {
  allowed: boolean;
  usedBytes: number;
  /** Bytes charged by THIS call — 0 when everything was still covered. */
  claimedBytes: number;
}

/**
 * Atomically claim signed-URL egress for a set of objects against the
 * company's period allowance. `allowed: false` means the mint must be refused
 * (over allowance, nothing was written). Any RPC error or malformed result
 * THROWS — the caller must not mint a URL it could not account for (fail
 * closed).
 */
export async function claimSignedUrlEgress(
  db: SupabaseClient,
  args: {
    companyId: string;
    since: string;
    /** Claims for the same object at or after this instant still stand. */
    dedupeSince: string;
    objects: readonly { key: string; bucket: string; bytes: number }[];
    limitBytes: number;
  },
): Promise<EgressClaim> {
  const { data, error } = await db.rpc("claim_signed_url_egress_objects", {
    p_company_id: args.companyId,
    p_since: args.since,
    p_dedupe_since: args.dedupeSince,
    p_objects: args.objects,
    p_limit_bytes: args.limitBytes,
  });
  if (error) {
    throw new Error(`claim_signed_url_egress_objects failed: ${error.message}`);
  }
  const result = egressClaimSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `claim_signed_url_egress_objects returned an unexpected shape: ${result.error}`,
    );
  }
  return {
    allowed: result.data.allowed,
    usedBytes: result.data.used_bytes,
    claimedBytes: result.data.claimed_bytes,
  };
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

/**
 * #261: bound how fast ONE member can ask for signed URLs.
 *
 * Every mint costs a row lookup, a #106 access check and a claim RPC, and the
 * routes had no rate limit of any kind — the only thing between a member and
 * an unbounded loop was the egress cap, which the loop was busy exhausting.
 * The per-object claim removed the cost of that loop; this removes the flood.
 * Keyed on company + user so one runaway client or stolen token cannot crowd
 * out the rest of the crew. Absent binding (local dev/tests) → gate skipped,
 * exactly like SEND_RATE_LIMITER at the dispatch choke point.
 */
export async function assertMintRateWithinLimit(
  env: Env,
  companyId: string,
  userId: string,
): Promise<void> {
  if (!env.ATTACHMENT_URL_RATE_LIMITER) return;
  const { success } = await env.ATTACHMENT_URL_RATE_LIMITER.limit({
    key: `attachment-url:${companyId}:${userId}`,
  });
  if (!success) {
    throw new ApiError(
      "rate_limited",
      "That's a lot of downloads at once. Give it a moment and try again.",
    );
  }
}

/** One to-be-signed Storage object: its bucket, path and accounted size. */
export interface EgressObject {
  bucket: string;
  /**
   * Storage path — the identity a repeat mint is recognised by (#261). Without
   * it the ledger counts requests instead of exposure, and one attachment can
   * be looped until the whole workspace's allowance is gone.
   */
  path: string;
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
  /**
   * Lifetime of the URLs about to be handed out. A claim for the same object
   * made within this window still covers it — see EGRESS_DEDUPE_SECONDS.
   */
  ttlSeconds: number = EGRESS_DEDUPE_SECONDS,
): Promise<void> {
  if (objects.length === 0) return;

  const { currentPeriodStart } = await companyPlanRow(db, companyId);
  const limitBytes = EGRESS_ALLOWANCE_BYTES;
  const since = egressPeriodStart(currentPeriodStart);
  const dedupeSince = new Date(Date.now() - ttlSeconds * 1000).toISOString();

  // One claim for the whole page: the RPC dedupes by object key and keeps the
  // per-object attribution the ledger needs, so a 100-item gallery is a single
  // round trip and can no longer be a free side door around the cap.
  const claim = await claimSignedUrlEgress(db, {
    companyId,
    since,
    dedupeSince,
    objects: objects.map((object) => ({
      key: `${object.bucket}/${object.path}`,
      bucket: object.bucket,
      bytes: Number(object.sizeBytes ?? 0),
    })),
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
