/**
 * The rig's way in and out of PostHog's error tracking (D146).
 *
 * Out: scenario failures and infrastructure faults are `$exception` events in
 * environment `synthetic`, sent with the project's public key. The local API
 * sends its own under `rig`. No alert reads either environment.
 *
 * In: R00 and the scenarios read the local API's events back with a personal
 * key through HogQL: its exceptions, which the cron registry explains
 * (cron-events.ts), and the push and ring evidence the app probe reads. A read
 * that fails is an answer R00 reports, never an empty list, because an empty
 * list would pass the gate for the wrong reason.
 */
import type { SecretFiles } from "@loonext/rig-robot";
import type { Explanation, SeenEvent } from "./cron-events.ts";

export type { Explanation, SeenEvent };

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";
const APP_HOST = "https://us.posthog.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_LIMIT = 1000;

/** The environment rigd's own events carry, and the one the local API's do. */
const SYNTHETIC_ENVIRONMENT = "synthetic";
export const API_ENVIRONMENT = "rig";

export type Fingerprint = readonly string[];

export function syntheticFingerprint(scenario: string, failureClass: string): Fingerprint {
  return ["synthetic", scenario, failureClass];
}

export function infraFingerprint(component: string): Fingerprint {
  return ["synthetic-infra", component];
}

export type ReportDecision = { sent: true } | { sent: false; reason: "send_failed" };

export interface SyntheticEvent {
  fingerprint: Fingerprint;
  message: string;
  level?: "fatal" | "error" | "warning" | "info";
  runId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  release?: string;
}

export interface PostHogErrorsOptions {
  /** The project's public key, for sending. */
  projectKey?: string;
  /** A personal key that can run queries, for reading. */
  personalKey?: string;
  projectId?: string;
  fetch?: typeof fetch;
}

/** rigd's PostHog sender and reader, with the keys the rig's secret store holds now. */
export function posthogFromStore(store: Pick<SecretFiles, "readOptional">): PostHogErrors {
  return new PostHogErrors({
    projectKey: store.readOptional("posthog-api-key"),
    personalKey: store.readOptional("posthog-personal-api-key"),
    projectId: store.readOptional("posthog-project-id"),
  });
}

export class PostHogErrors {
  readonly #o: PostHogErrorsOptions;
  readonly #fetch: typeof fetch;

  constructor(options: PostHogErrorsOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  get canSend(): boolean {
    return Boolean(this.#o.projectKey);
  }

  get canRead(): boolean {
    return Boolean(this.#o.personalKey && this.#o.projectId);
  }

  /** One scenario failure or infrastructure fault, as a `synthetic` exception. */
  async send(event: SyntheticEvent): Promise<ReportDecision> {
    if (!this.#o.projectKey) return { sent: false, reason: "send_failed" };
    const properties = {
      environment: SYNTHETIC_ENVIRONMENT,
      source: "rig",
      release: event.release,
      $process_person_profile: false,
      $exception_fingerprint: event.fingerprint.join(":"),
      $exception_level: event.level ?? "error",
      $exception_list: [{ type: "RigReport", value: event.message, mechanism: { handled: true, synthetic: true } }],
      ...(event.runId ? { run_id: event.runId } : {}),
      ...event.tags,
      ...(event.extra ? { extra: event.extra } : {}),
    };
    try {
      const response = await this.#fetch(POSTHOG_CAPTURE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: this.#o.projectKey, event: "$exception", distinct_id: "loonext-rig", properties }),
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      return response.ok ? { sent: true } : { sent: false, reason: "send_failed" };
    } catch {
      return { sent: false, reason: "send_failed" };
    }
  }

  /**
   * The local API's exceptions since `since` (epoch ms). Throws when the read
   * cannot be made, so a caller never mistakes a dead read for a quiet API.
   */
  async apiExceptions(since: number): Promise<SeenEvent[]> {
    const seconds = Math.floor(Math.max(0, since) / 1000);
    const sql =
      "select toUnixTimestamp(timestamp), properties.$exception_level, properties.$exception_fingerprint, " +
      "properties.$exception_list, properties.source, properties.route, properties.cron, properties.job, properties.ops_key from events " +
      `where event = '$exception' and properties.environment = '${API_ENVIRONMENT}' and timestamp >= toDateTime(${seconds}) ` +
      `order by timestamp limit ${QUERY_LIMIT}`;
    return (await this.query(sql)).map(seenException);
  }

  /**
   * The rows of one HogQL query, with `{name}` placeholders filled from
   * `values`. Always computed fresh: PostHog would otherwise answer a repeated
   * query from its cache, and a poll would never see an event arrive. Throws
   * when the read cannot be made.
   */
  async query(sql: string, values: Record<string, unknown> = {}): Promise<unknown[][]> {
    const { personalKey, projectId } = this.#o;
    if (!personalKey || !projectId) throw new Error("posthog-personal-api-key and posthog-project-id are not both in the rig's store");
    const response = await this.#fetch(`${APP_HOST}/api/environments/${encodeURIComponent(projectId)}/query/`, {
      method: "POST",
      headers: { authorization: `Bearer ${personalKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql, values }, refresh: "force_blocking" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`PostHog answered ${response.status} for the HogQL query`);
    const body = (await response.json()) as { results?: unknown };
    if (!Array.isArray(body.results)) throw new Error("PostHog's HogQL query answered no results");
    return body.results as unknown[][];
  }
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * One result row as the registry reads it. PostHog lists the thrown error
 * first and its causes after; the registry wants the outermost last.
 */
export function seenException(row: unknown[]): SeenEvent {
  const [seconds, level, fingerprint, list, source, route, cron, job, opsKey] = row;
  const seen: SeenEvent = { at: Number(seconds) * 1000 };
  if (text(level)) seen.level = String(level);
  if (text(fingerprint)) seen.fingerprint = String(fingerprint).split(":");

  let parsed: unknown = list;
  if (typeof list === "string") {
    try {
      parsed = JSON.parse(list);
    } catch {
      parsed = [];
    }
  }
  const exceptions = (Array.isArray(parsed) ? parsed : []).slice(0, 20).map((entry: { type?: unknown; value?: unknown }) => ({
    type: typeof entry?.type === "string" ? entry.type : "",
    value: typeof entry?.value === "string" ? clip(entry.value, 500) : "",
  }));
  if (exceptions.length) seen.exceptions = exceptions.reverse();
  const message = seen.exceptions?.at(-1)?.value;
  if (message) seen.message = message;

  const tags: Record<string, string> = {};
  for (const [name, value] of [["source", source], ["route", route], ["cron", cron], ["job", job], ["ops_key", opsKey]] as const) {
    const found = text(value);
    if (found) tags[name] = clip(found, 200);
  }
  if (Object.keys(tags).length) seen.tags = tags;
  return seen;
}

/** The key R00 lists an unexplained exception under. */
export function exceptionKey(event: SeenEvent): string {
  if (event.fingerprint) return event.fingerprint.join(":");
  const outer = event.exceptions?.at(-1);
  return outer ? `${outer.type}: ${outer.value}` : (event.message ?? "(no message)");
}

/** R00's sorting of the last day's API exceptions (api-exceptions.ts). */
export interface ApiExceptionsReport {
  at: string;
  /** Set when the read failed; the other lists are then empty and mean nothing. */
  error?: string;
  unexplained_24h: string[];
  /** Exceptions the cron registry names as a defect of the rig's seed or setup, with its cause. */
  defects_24h: { key: string; means: string }[];
}

/** The last day's API exceptions, sorted into expected, defect and unexplained. */
export async function reportApiExceptions(
  source: Pick<PostHogErrors, "apiExceptions">,
  explain: (event: SeenEvent) => Explanation | undefined,
  now: number,
): Promise<ApiExceptionsReport> {
  const at = new Date(now).toISOString();
  let events: SeenEvent[];
  try {
    events = await source.apiExceptions(now - DAY_MS);
  } catch (error) {
    return { at, error: error instanceof Error ? error.message : String(error), unexplained_24h: [], defects_24h: [] };
  }
  const unexplained = new Set<string>();
  const defects = new Map<string, string>();
  for (const event of events) {
    const explanation = explain(event);
    if (explanation?.kind === "defect") defects.set(exceptionKey(event), explanation.means);
    else if (!explanation) unexplained.add(exceptionKey(event));
  }
  return {
    at,
    unexplained_24h: [...unexplained].sort(),
    defects_24h: [...defects].map(([key, means]) => ({ key, means })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
