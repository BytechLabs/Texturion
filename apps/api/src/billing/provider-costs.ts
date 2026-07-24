/**
 * #216 — actual Telnyx cost capture + read. The #85 cost model estimates
 * telecom cost from usage units; Telnyx webhooks the REAL cost per call
 * (`call.cost`) and message (`message.finalized`). We record each into the
 * provider_costs ledger (idempotent per (kind, ref)) and expose the period sum
 * so the fair-use projection can price telecom from ground truth.
 */
import type { getDb } from "../db";

type Db = ReturnType<typeof getDb>;

export type ProviderCostKind = "voice" | "message";

/** Parse a Telnyx decimal-string dollar amount to a finite, non-negative number. */
export function parseCostUsd(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Our session-id candidates from a Telnyx `client_state` (base64 "a|b|c"). Our
 * S sits at a tag-dependent position (`op|S|user`, `oc_customer|..|..|S`, or S
 * alone), so rather than branch per tag we return every UUID-shaped part and let
 * the calls lookup disambiguate — only our real S matches a calls row. Pure.
 */
export function decodeSessionCandidates(
  clientState: string | null | undefined,
): string[] {
  if (!clientState) return [];
  let decoded: string;
  try {
    decoded = atob(clientState);
  } catch {
    return [];
  }
  return decoded.split("|").filter((part) => UUID_RE.test(part));
}

/** Extract what we need from a `call.cost` payload (pure, defensive). */
export function parseCallCost(payload: unknown): {
  callLegId: string;
  candidates: string[];
  costUsd: number;
} | null {
  const p = payload as Record<string, unknown> | null | undefined;
  const callLegId = typeof p?.call_leg_id === "string" ? p.call_leg_id : "";
  if (!callLegId) return null;
  return {
    callLegId,
    candidates: decodeSessionCandidates(p?.client_state as string | undefined),
    costUsd: parseCostUsd(p?.total_cost),
  };
}

/**
 * Record a `call.cost` leg against its company, resolved via the calls row
 * (call_session_id = our S, extracted from client_state). Best-effort: an
 * untracked leg, or a cost that raced ahead of the calls row, is skipped (the
 * projection's max(estimate, actual) absorbs the small under-count). #216.
 */
/**
 * Returns `true` when the cost was recorded OR the leg is a definite skip
 * (untracked / raced ahead / no candidates), and `false` ONLY on a transient
 * DB error — so the caller can leave the webhook_events row unprocessed and let
 * the §11 sweeper re-drive it instead of permanently dropping the leg's cost.
 */
export async function recordVoiceCost(
  db: Db,
  payload: unknown,
  occurredAt?: string | null,
): Promise<boolean> {
  const parsed = parseCallCost(payload);
  if (!parsed || parsed.candidates.length === 0) return true; // definite skip
  const { data, error } = await db
    .from("calls")
    .select("company_id")
    .in("call_session_id", parsed.candidates)
    .limit(1);
  if (error) {
    // Transient: do NOT let the caller mark the event processed — a swallowed
    // error here previously dropped the real per-leg cost forever.
    console.error(`call.cost company lookup failed: ${error.message}`);
    return false;
  }
  const companyId = (data?.[0] as { company_id: string } | undefined)
    ?.company_id;
  if (!companyId) return true; // untracked leg / cost raced ahead — legit skip
  return recordProviderCost(db, {
    kind: "voice",
    ref: parsed.callLegId,
    companyId,
    costUsd: parsed.costUsd,
    occurredAt: occurredAt ?? null,
  });
}

/**
 * Record one costed telecom event, idempotent per (kind, ref) so a webhook
 * REPLAY never double-counts. Never THROWS (it can't break the webhook path),
 * but returns `false` on a transient upsert error so the caller can decline to
 * mark the event processed and let the sweeper re-drive it; `true` on success
 * or a definite skip. A permanently-missed row only slightly under-counts,
 * which the projection's max(estimate, actual) absorbs.
 */
export async function recordProviderCost(
  db: Db,
  input: {
    kind: ProviderCostKind;
    /** call_leg_id (voice) or telnyx_message_id (message) — the idempotency key. */
    ref: string;
    companyId: string;
    costUsd: number;
    occurredAt?: string | null;
  },
): Promise<boolean> {
  if (!input.ref || !input.companyId) return true; // definite skip
  const row: Record<string, unknown> = {
    kind: input.kind,
    ref: input.ref,
    company_id: input.companyId,
    cost_usd: input.costUsd,
  };
  if (input.occurredAt) row.occurred_at = input.occurredAt;
  const { error } = await db
    .from("provider_costs")
    .upsert(row, { onConflict: "kind,ref" });
  if (error) {
    console.error(
      `provider_costs upsert failed (${input.kind}:${input.ref}): ${error.message}`,
    );
    return false; // transient — caller should not stamp the event processed
  }
  return true;
}

/**
 * Total actual provider cost this period, in CENTS (the model works in cents).
 * The RPC returns USD dollars; we scale ×100.
 */
export async function periodProviderCostCents(
  db: Db,
  companyId: string,
  since: string,
): Promise<number> {
  const { data, error } = await db.rpc("api_period_provider_cost", {
    p_company_id: companyId,
    p_since: since,
  });
  if (error) {
    throw new Error(`api_period_provider_cost failed: ${error.message}`);
  }
  const dollars = typeof data === "number" ? data : Number(data);
  return Number.isFinite(dollars) ? dollars * 100 : 0;
}
