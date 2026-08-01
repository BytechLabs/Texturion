import { getDb } from "../db";
import type { Env } from "../env";

/**
 * #477 — synthetic probes: does the product actually work, right now, from
 * outside itself?
 *
 * # What these are for, and what they are not
 *
 * Sentry catches errors that THROW. The liveness ledger (#387) catches things
 * that stopped happening. Neither catches the third shape: a path that returns
 * 200 and does nothing useful — a token that mints but authorises nothing, a
 * send that reports `sent` and never reaches a carrier. A probe is the only
 * thing that notices that, because it is the only thing that checks the answer.
 *
 * They are also the PREREQUISITE for /status ever showing a service indicator.
 * DESIGN-DIRECTION v4 §6 and QA gate 6 say no operational indicator may render
 * until a real probe backs it, which is why the page currently says out loud
 * that it is written by a person. It has to keep saying that until these have
 * run for long enough to mean something.
 *
 * # Cost is the constraint, not the code
 *
 * Two of the four probes #477 names spend real money every run — a synthetic
 * send costs a segment, a synthetic call costs minutes. The two built here are
 * FREE, deliberately, and that is not a compromise: they are also the two with
 * the least overlap with what Sentry already sees.
 *
 * The billable one has a hard monthly ceiling and stops rather than overspends
 * (`SEND_PROBE_MONTHLY_CEILING`). Read off the results rather than a counter,
 * so there is nothing to drift and nothing to reset.
 */

/** Every probe this product runs. The `probe` column's vocabulary. */
export const PROBES = ["auth", "inbound-webhook", "outbound-send"] as const;
export type ProbeName = (typeof PROBES)[number];

/**
 * How many billable send probes one month may run.
 *
 * At roughly a cent a segment this is a ceiling of about 45¢ a month. Sized for
 * a DAILY probe plus headroom for retries — not hourly, which would be 24× the
 * cost for a path Sentry already covers whenever it throws. The value a
 * synthetic send adds over Sentry is narrow (a silent success that never
 * reaches the carrier), and that is worth cents rather than dollars.
 *
 * The ceiling is the point, not the number: per the cost posture this is capped
 * BEFORE it is prompted, and reaching it stops the probe rather than raising an
 * alarm somebody has to act on at 3am.
 */
export const SEND_PROBE_MONTHLY_CEILING = 45;

/** How long a probe may take before it counts as a failure. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeOutcome {
  ok: boolean;
  /** A short CODE, never a message — this ends up on a public page. */
  detail?: string;
  latencyMs?: number;
}

/**
 * Record one run.
 *
 * Never throws. A probe that takes the cron down when it fails is a probe that
 * hides every other job behind it, and the whole point of this module is to be
 * the thing that still reports when something else is broken.
 */
export async function recordProbe(
  env: Env,
  probe: ProbeName,
  outcome: ProbeOutcome,
): Promise<void> {
  try {
    await getDb(env).from("probe_results").insert({
      probe,
      ok: outcome.ok,
      detail: outcome.detail ?? null,
      latency_ms: outcome.latencyMs ?? null,
    });
  } catch (cause) {
    console.error(`probe ${probe}: could not record result: ${String(cause)}`);
  }
}

/**
 * #477 — auth still works end to end.
 *
 * FREE, and the most load-bearing thing here: if this fails nobody can open the
 * app at all, whatever else is green. It mints a service token and calls the one
 * endpoint every client calls first.
 *
 * A 401 is a FAILURE, not a pass. That distinction is the probe: a broken auth
 * stack answers 401 cheerfully all day, and a check that only looked for "a
 * response arrived" would call that healthy.
 */
export async function probeAuth(env: Env): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ok: false, detail: `status_${response.status}`, latencyMs };
    }
    return { ok: true, latencyMs };
  } catch (cause) {
    return {
      ok: false,
      // The NAME of the error, never its message — a message can carry a URL
      // with a key in it, and this row is read by a public page.
      detail: cause instanceof Error ? cause.name.slice(0, 64) : "unknown",
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * How long the carrier may go quiet before it means something is wrong.
 *
 * Generous on purpose. A real workspace can be genuinely silent overnight, and
 * a probe that cries wolf at 3am on a quiet Tuesday is a probe somebody mutes.
 * Six hours is longer than any plausible quiet stretch on a working line and
 * far shorter than a customer's patience.
 */
export const WEBHOOK_SILENCE_LIMIT_MS = 6 * 60 * 60 * 1000;

/**
 * #477 — are carrier callbacks still arriving at all?
 *
 * FREE, and ABSENCE-SHAPED, which is why it reads the liveness ledger rather
 * than making a request. Nothing throws when Telnyx stops calling us; the
 * product simply goes quiet, and quiet looks exactly like a slow day. This is
 * the only check that can tell those apart.
 */
export async function probeInboundWebhook(env: Env): Promise<ProbeOutcome> {
  try {
    // The `webhook_events` ledger, not `liveness_heartbeats`. The heartbeat
    // ledger's vocabulary is `cron:` and `job:` keys — there is no webhook key
    // in it, so a probe pointed there would have read a row that never exists
    // and reported healthy forever. A check that cannot fail is worse than no
    // check, because it occupies the space where a real one would go.
    //
    // Every carrier callback writes a row here for idempotency, so the most
    // recent `received_at` IS the answer to "are they still arriving".
    const { data, error } = await getDb(env)
      .from("webhook_events")
      .select("received_at")
      .eq("provider", "telnyx")
      .order("received_at", { ascending: false })
      .limit(1);
    if (error) return { ok: false, detail: "ledger_unreadable" };

    const seen = (data?.[0] as { received_at: string } | undefined)?.received_at;
    // No row at all is NOT a failure. It means no callback has ever been
    // recorded — a fresh environment, not a broken one — and reporting an
    // outage for a workspace that has never received a message would be the
    // invented signal this whole module exists to avoid.
    if (!seen) return { ok: true, detail: "never_seen" };

    const silentFor = Date.now() - Date.parse(seen);
    return silentFor > WEBHOOK_SILENCE_LIMIT_MS
      ? { ok: false, detail: "silent" }
      : { ok: true };
  } catch {
    return { ok: false, detail: "ledger_unreadable" };
  }
}

/**
 * #477 — may the billable send probe run this month?
 *
 * Counts ATTEMPTS, not successes: a failed send can still have reached the
 * carrier and still be billable, so a ceiling that counted only the successes
 * would leak exactly when things are going wrong and retries are most likely.
 *
 * Fails CLOSED. If the count cannot be read we do not spend — the failure this
 * must never have is an unbounded bill, and a probe that skips a run costs
 * nothing but a gap in a chart.
 */
export async function sendProbeAllowed(env: Env): Promise<boolean> {
  try {
    const { data, error } = await getDb(env).rpc("probe_runs_this_month", {
      p_probe: "outbound-send",
    });
    if (error) return false;
    return Number(data ?? SEND_PROBE_MONTHLY_CEILING) < SEND_PROBE_MONTHLY_CEILING;
  } catch {
    return false;
  }
}

/**
 * Run the free probes and record them.
 *
 * The billable one is deliberately NOT here. It needs a sink number this
 * product does not own yet, and wiring a spend to a cron before there is
 * somewhere safe to send to is how a probe bills a stranger.
 */
export async function runProbes(env: Env): Promise<void> {
  const [auth, webhook] = await Promise.all([
    probeAuth(env),
    probeInboundWebhook(env),
  ]);
  await Promise.all([
    recordProbe(env, "auth", auth),
    recordProbe(env, "inbound-webhook", webhook),
  ]);
}
