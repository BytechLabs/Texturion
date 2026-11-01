import type { Ctx } from "../context";
import { LIMIT_PROBE_ABSURD, LIMIT_PROBE_INTERVAL_MS, LIMIT_PROBE_MAX_WRITES } from "../limits";
import { Refusal } from "../refusal";
import { sendProductionEvent } from "../sentry";
import { LIMIT_KEYS, type Ceiling, type ValidationRecord } from "../state/concurrency";
import { KEYS, type PartitionRecord } from "../telnyx/partition";
import { requireSafe } from "./safety";
import { SPEC, type TelnyxSpec } from "./spec";

/**
 * The validation check (D142 update of 2026-11-01). Telnyx documents an
 * outbound voice profile's concurrent_call_limit as "no more than your global
 * concurrent call limit", so on a profile attached to nothing the largest
 * value Telnyx accepts says what the account's limit is, at no cost and with
 * no call placed.
 *
 * An absurd value goes first. Accepted, the rule is not enforced and proves
 * nothing. Refused with a 422 naming the field, the boundary is searched
 * within {@link LIMIT_PROBE_MAX_WRITES} writes, each refusal the same error as
 * the first. Any other answer is inconclusive. The profile is always put back
 * to 1, and nothing but the profile the spec names is ever written.
 */
export interface ProbeAttempt {
  at: number;
  result: ValidationRecord["result"];
}

type Item = Record<string, unknown>;
type Answer = { kind: "accepted" } | { kind: "refused"; signature: string; code: string | null } | { kind: "other" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The refusal the check relies on, recognised positively: a 422 whose error names the field. */
function identifiedRefusal(status: number, body: unknown): { signature: string; code: string | null } | null {
  if (status !== 422) return null;
  const errors = (body as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors)) return null;
  for (const error of errors as Item[]) {
    const pointer = String((error?.source as Item | undefined)?.pointer ?? "");
    const detail = String(error?.detail ?? "");
    if (pointer.includes("concurrent_call_limit") || detail.includes("concurrent_call_limit")) {
      const code = error?.code === undefined ? null : String(error.code);
      return { signature: `${code ?? ""}|${pointer}`, code };
    }
  }
  return null;
}

/**
 * Due when no conclusive result exists, the last is a month old, or Telnyx
 * has refused for a limit since it was measured; tried at most once a day.
 */
export async function limitProbeDue(ctx: Ctx): Promise<boolean> {
  const now = ctx.now();
  const last = await ctx.store.get<ProbeAttempt>(LIMIT_KEYS.probe);
  if (last && now - last.at < DAY_MS) return false;
  const validation = await ctx.store.get<ValidationRecord>(LIMIT_KEYS.validation);
  if (!validation || validation.result === "inconclusive") return true;
  const ceilings = (await ctx.store.get<Ceiling[]>(LIMIT_KEYS.ceiling)) ?? [];
  if (ceilings.some((ceiling) => ceiling.at > validation.measured_at)) return true;
  return now - validation.measured_at >= LIMIT_PROBE_INTERVAL_MS;
}

/**
 * The probe profile's id, found by its exact name in the partition's billing
 * group, and never one the partition dials on or any connection names. The
 * connections are listed again here, since the stored safety check can be
 * hours old and the first write is 9999.
 */
async function probeProfileId(ctx: Ctx, spec: TelnyxSpec): Promise<string | null> {
  const telnyx = ctx.telnyx!;
  const record = await ctx.store.get<PartitionRecord>(KEYS.record);
  if (!record) return null;
  const profiles = await telnyx.listAll<Item>("/v2/outbound_voice_profiles");
  const found = profiles.filter((item) => item.name === spec.limit_probe.name);
  if (found.length !== 1 || typeof found[0].id !== "string" || !found[0].id) return null;
  const id = found[0].id;
  if (found[0].billing_group_id !== record.billing_group_id) return null;
  if (Object.values(record.outbound_voice_profiles ?? {}).includes(id)) return null;
  const connections = [
    ...(await telnyx.listAll<Item>("/v2/call_control_applications")),
    ...(await telnyx.listAll<Item>("/v2/credential_connections")),
  ];
  const named = connections.some((item) => (item.outbound as Item | undefined)?.outbound_voice_profile_id === id);
  return named ? null : id;
}

export async function runLimitProbe(ctx: Ctx, spec: TelnyxSpec = SPEC): Promise<ValidationRecord> {
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  await requireSafe(ctx);
  const telnyx = ctx.telnyx;
  const id = await probeProfileId(ctx, spec);
  let writes = 0;
  const outcome = (result: ValidationRecord["result"], value: number | null = null, code: string | null = null): ValidationRecord => ({
    result,
    value,
    measured_at: ctx.now(),
    writes,
    refusal_code: code,
  });
  if (!id) return settle(ctx, outcome("inconclusive"));

  const write = async (value: number): Promise<Answer> => {
    writes += 1;
    try {
      const reply = await telnyx.send("PATCH", `/v2/outbound_voice_profiles/${encodeURIComponent(id)}`, {
        name: spec.limit_probe.name,
        concurrent_call_limit: value,
      });
      if (reply.status >= 200 && reply.status <= 299) return { kind: "accepted" };
      const refused = identifiedRefusal(reply.status, reply.body);
      return refused ? { kind: "refused", ...refused } : { kind: "other" };
    } catch {
      return { kind: "other" };
    }
  };

  let result: ValidationRecord;
  try {
    result = await search(write, () => writes, outcome);
  } finally {
    const reset = await write(spec.limit_probe.concurrent_call_limit);
    if (reset.kind !== "accepted") {
      await sendProductionEvent(ctx, {
        key: "telnyx-guard-limit-probe-reset",
        summary: "The rig's limit-probe voice profile was not put back to 1",
        detail: `${spec.limit_probe.name} is attached to nothing, and the start-up checks refuse if it ever is. The next setup run writes 1 again.`,
        level: "warning",
      });
    }
  }
  return settle(ctx, { ...result, writes });
}

async function search(
  write: (value: number) => Promise<Answer>,
  writes: () => number,
  outcome: (result: ValidationRecord["result"], value?: number | null, code?: string | null) => ValidationRecord,
): Promise<ValidationRecord> {
  const absurd = await write(LIMIT_PROBE_ABSURD);
  if (absurd.kind === "accepted") return outcome("not_enforced");
  if (absurd.kind !== "refused") return outcome("inconclusive");

  // lo is the largest value seen accepted (0 for none yet), hi the smallest seen refused.
  let lo = 0;
  let hi = LIMIT_PROBE_ABSURD;
  while (hi - lo > 1) {
    // One write stays in hand for the reset.
    if (writes() >= LIMIT_PROBE_MAX_WRITES - 1) return outcome("inconclusive");
    const mid = Math.floor((lo + hi) / 2);
    const answer = await write(mid);
    if (answer.kind === "accepted") lo = mid;
    else if (answer.kind === "refused" && answer.signature === absurd.signature) hi = mid;
    else return outcome("inconclusive");
  }
  // Both ends were written: lo accepted, lo + 1 refused with the same error.
  return lo === 0 ? outcome("inconclusive") : outcome("exact", lo, absurd.code);
}

/** Files the result. An inconclusive run never replaces a conclusive one, which lapses on its own. */
async function settle(ctx: Ctx, result: ValidationRecord): Promise<ValidationRecord> {
  await ctx.store.put(LIMIT_KEYS.probe, { at: ctx.now(), result: result.result } satisfies ProbeAttempt);
  const current = await ctx.store.get<ValidationRecord>(LIMIT_KEYS.validation);
  if (result.result !== "inconclusive" || !current || current.result === "inconclusive") {
    await ctx.store.put(LIMIT_KEYS.validation, result);
  }
  console.log(`guard: limit probe ${result.result} in ${result.writes} write(s)`);
  return result;
}
