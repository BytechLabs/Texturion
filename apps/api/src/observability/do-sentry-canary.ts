/**
 * #375 — the alarm that proves the alarms can still speak.
 *
 * `docs/CALLS-V3.md` names its own telemetry as load-bearing and then names
 * the single condition under which all of it stops working. §17 item 5 calls
 * the queue-latency signal the drift alarm for the webhook-ack budget, and §13
 * says the plainest version of it: Sentry inside the DO REQUIRES the §2.1
 * instrumentation or every one of those alerts is a silent no-op.
 *
 * That dependency fails in the worst possible direction. A warning that fires
 * at 50% of a cap is SUPPOSED to be quiet — silence is its healthy state — so
 * a broken channel and a healthy system produce byte-identical evidence. There
 * is no threshold, no dashboard and no amount of care that distinguishes them,
 * because the distinguishing observation was never made.
 *
 * So this makes it. Two assertions, both from inside the Durable Object,
 * because the DO is a different isolate from the Worker and only the DO's own
 * runtime can answer for itself:
 *
 *   1. THE CLIENT IS PRESENT. `Sentry.getClient()` returning undefined inside
 *      the DO means the §2.1 wrapper is gone — the exact regression a refactor
 *      or a new DO class introduces without failing a build. Free: no event,
 *      no network, no quota.
 *   2. THE CHANNEL CARRIES. A minimal envelope POSTed to the ingest endpoint,
 *      whose HTTP response is the proof. That covers what a client check
 *      cannot: DSN valid, project still accepting, egress from the DO isolate
 *      permitted, not rate-limited into silence.
 *
 * Only both together record the heartbeat, and the alert for its absence is an
 * EMAIL (`liveness-check.ts`) — deliberately a channel with an unrelated
 * failure mode, since a Sentry alert about Sentry being down is not an alert.
 * That is where this recursion stops, and one level is enough.
 *
 * WHY THE RAW ENVELOPE AND NOT `captureMessage`. Not distrust of the SDK: a
 * captured message is fire-and-forget, and `flush()` tells us the queue
 * drained locally, not that Sentry accepted anything. This canary exists
 * precisely because "we handed it off successfully" was already the assumption
 * that failed. The response status is the only fact worth recording.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { recordHeartbeatBestEffort } from "./liveness";

/** Sentry's ingest is a hard dependency of nothing else; fail fast. */
const INGEST_TIMEOUT_MS = 5_000;

/**
 * Every 6 hours, not hourly, and the reason is the cost mandate rather than
 * caution about load.
 *
 * Each probe is a billable Sentry event. Hourly would spend ~720 events a
 * month — a seventh of a 5k plan — on saying "still fine", and a quota spent
 * on canaries is quota unavailable to the real errors this whole system
 * exists to deliver. A canary that rate-limits the alarms it protects would be
 * the failure it was built to prevent.
 *
 * Six hours costs ~120 a month and loses nothing, because the fault being
 * watched for is not transient: a dropped wrapper or a revoked DSN stays
 * broken until somebody fixes it. Detection a few hours later is the same
 * detection.
 */
export const DO_SENTRY_CANARY_INTERVAL_HOURS = 6;

export interface SentryChannelProbe {
  /** A Sentry client exists in this isolate — i.e. §2.1 instrumentation ran. */
  clientPresent: boolean;
  /** Sentry's ingest accepted the envelope. */
  ingestOk: boolean;
  /** The ingest response status, or null if the request never completed. */
  ingestStatus: number | null;
  /** Why it failed, for the log. Never contains the DSN secret. */
  detail: string | null;
}

/** A DSN, split into the parts the envelope endpoint needs. */
interface ParsedDsn {
  origin: string;
  publicKey: string;
  projectId: string;
}

/**
 * `https://<publicKey>@<host>/<projectId>`.
 *
 * Parsed rather than string-built so a malformed DSN is caught here, with a
 * message, instead of becoming a 404 that reads like an outage.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.replace(/^\//, "");
  if (!url.username || !projectId) return null;
  return { origin: url.origin, publicKey: url.username, projectId };
}

/**
 * 32 lowercase hex characters, the event_id shape Sentry requires. A
 * rejected id would fail the probe for a reason that has nothing to do with
 * the channel, so this is generated the way the SDK does it.
 */
function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * POST one envelope and report what came back.
 *
 * `sentry_key` rides the query string because that is the ingest protocol's
 * own scheme, and the public key is not a secret — it ships in every browser
 * bundle that reports to the same project.
 */
async function postCanaryEnvelope(
  dsn: string,
  environment: string,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number | null; detail: string | null }> {
  const parsed = parseDsn(dsn);
  if (!parsed) {
    return { ok: false, status: null, detail: "SENTRY_DSN is not a parseable DSN" };
  }

  const id = eventId();
  const url =
    `${parsed.origin}/api/${parsed.projectId}/envelope/` +
    `?sentry_key=${encodeURIComponent(parsed.publicKey)}&sentry_version=7`;

  const envelope =
    JSON.stringify({ event_id: id, sent_at: now.toISOString() }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify({
      event_id: id,
      timestamp: now.getTime() / 1000,
      platform: "javascript",
      // 'debug' so it never pages anyone and never enters an issue stream a
      // human watches. Its VALUE is that it arrived, not that it is read.
      level: "debug",
      environment,
      logentry: {
        message:
          "Durable Object alert-channel canary (#375). Deliberate: its arrival " +
          "is the assertion that DO-scoped Sentry still works.",
      },
      tags: { canary: "do-sentry", runtime: "durable-object" },
    }) +
    "\n";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: envelope,
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      // 429 is the one worth naming: it means the project is shedding events,
      // so the alarms are degraded even though the channel technically works.
      detail: res.ok
        ? null
        : res.status === 429
          ? "Sentry is rate-limiting this project — alerts are being dropped"
          : `Sentry ingest returned ${res.status}`,
    };
  } catch (cause) {
    return { ok: false, status: null, detail: `ingest request failed: ${String(cause)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run both assertions. Called from INSIDE the Durable Object — that placement
 * is the entire point, and moving it to the Worker would leave it testing a
 * runtime nobody was worried about.
 *
 * `getClient` is injected rather than imported so a test can express the
 * regression this exists to catch (an isolate with no Sentry client) without
 * having to dismantle a real SDK.
 */
export async function probeSentryChannel(
  env: Env,
  getClient: () => unknown,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<SentryChannelProbe> {
  const clientPresent = Boolean(getClient());

  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    return {
      clientPresent,
      ingestOk: false,
      ingestStatus: null,
      detail: "SENTRY_DSN is not configured in this Durable Object's environment",
    };
  }

  // The same production/development split `sentry.ts` uses, so the canary
  // lands in the same bucket as the alarms it speaks for. A canary filed under
  // a different environment than the alerts would still prove the channel and
  // still be impossible to find next to them.
  const environment = env.GIT_SHA ? "production" : "development";
  const sent = await postCanaryEnvelope(dsn, environment, now, fetchImpl);
  return {
    clientPresent,
    ingestOk: sent.ok,
    ingestStatus: sent.status,
    detail: clientPresent
      ? sent.detail
      : // Worth stating separately: the channel can be perfectly healthy while
        // nothing is wired to speak into it, and that combination is exactly
        // the silent no-op §13 warns about.
        (sent.detail ?? "no Sentry client in the Durable Object isolate (§2.1 wrapper missing)"),
  };
}

/** Both assertions passed — the alarms in §13 and §17 can still reach anyone. */
export function channelIsHealthy(probe: SentryChannelProbe): boolean {
  return probe.clientPresent && probe.ingestOk;
}

/**
 * The well-known DO instance the canary runs in.
 *
 * A reserved name, never a real session id: `CallSessionDO` keys on
 * `idFromName(sessionId)`, so a name that cannot be a session id can never
 * collide with a live call. The instance holds no call state and answers one
 * RPC.
 *
 * It has to be a REAL instance of a REAL DO class rather than a purpose-built
 * one, because a canary running in a DO that nothing else uses would prove
 * only that a freshly-written DO is instrumented — which was never in doubt.
 * The claim worth making is about the class that carries the alarms.
 */
export const CANARY_SESSION_NAME = "__do-sentry-canary__";

/** The one RPC the canary needs; kept structural so the job does not import the DO. */
interface ProbeCapableStub {
  probeAlertChannel(): Promise<SentryChannelProbe>;
}

/**
 * Cron entry point: ask the DO to prove the channel, and record the heartbeat
 * only if it does.
 *
 * The heartbeat is the reporting mechanism ON PURPOSE. Writing a row on
 * success and nothing on failure means a broken channel, a DO that will not
 * start, and a job that stopped running all converge on the same observable —
 * an absent heartbeat — and the checker's email says so without needing to
 * know which. That is the whole design of #387 applied one layer up, and it is
 * why this does not need an alert path of its own.
 */
export async function runDoSentryCanaryJob(
  env: Env,
  now: Date = new Date(),
  db?: SupabaseClient,
): Promise<SentryChannelProbe | null> {
  const namespace = env.CALL_SESSIONS;
  if (!namespace) {
    // Not an error and not silence: without the binding there is no DO to ask,
    // and `channel:do-sentry` is withheld from the expectations in exactly
    // that case, so nothing alerts about a runtime that is not deployed.
    console.warn("do-sentry-canary: CALL_SESSIONS is not bound; skipping probe");
    return null;
  }

  const stub = namespace.get(
    namespace.idFromName(CANARY_SESSION_NAME),
  ) as unknown as ProbeCapableStub;

  let probe: SentryChannelProbe;
  try {
    probe = await stub.probeAlertChannel();
  } catch (cause) {
    // The DO itself would not answer. Same conclusion as a failed probe, so it
    // takes the same path: no heartbeat, and the checker speaks in one grace.
    console.error(`do-sentry-canary: the Durable Object did not answer: ${String(cause)}`);
    return null;
  }

  if (!channelIsHealthy(probe)) {
    console.error(
      `do-sentry-canary: the DO alert channel is NOT healthy ` +
        `(client=${probe.clientPresent}, ingest=${probe.ingestStatus ?? "no response"}): ` +
        `${probe.detail ?? "unknown"}. Every §13 cost-cap warning and §17 drift alarm ` +
        `is currently a silent no-op.`,
    );
    return probe;
  }

  await recordHeartbeatBestEffort(env, "channel:do-sentry", now, db);
  return probe;
}
