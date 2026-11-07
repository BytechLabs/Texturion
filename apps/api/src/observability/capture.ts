/**
 * Everything the API Worker and the call Durable Object send to PostHog (D146,
 * docs/MONITORING.md): exceptions, ops notices and a small set of events.
 * PostHog's error tracking, dashboards and alerts do the rest.
 *
 * Scrubbed before the SDK sees anything (D8): the error is rebuilt from its
 * scrubbed text, and a `before_send` hook scrubs the finished event again.
 * Best effort by design: a failed capture is logged and never thrown, because
 * it runs inside the request, cron or call event whose own failure is being
 * reported.
 *
 * A client per call. The edge build has no background flush to rely on, so
 * each capture is sent immediately and handed to `waitUntil`, which keeps the
 * invocation alive for it without holding up the response.
 */
import { env as isolateBindings, waitUntil as invocationWaitUntil } from "cloudflare:workers";
// The build workerd resolves to, named so node tests run the same code.
import { PostHog } from "posthog-node/edge";

import type { Env } from "../env";
import { telemetryEnvironment } from "../environments/policy";
import { scrubProperties, scrubText, scrubUnknown } from "./scrub";

const POSTHOG_HOST = "https://us.i.posthog.com";

/** Identity for anything that is about the system rather than a workspace. */
export const SYSTEM_DISTINCT_ID = "loonext-api";

/** A slow PostHog must not keep a Worker invocation alive for long. */
const REQUEST_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 500;

/** A cause chain this deep is a loop, not a diagnosis. */
const MAX_CAUSES = 5;

/** `ops:<key>`: lowercase words joined by hyphens, never an id or amount. */
const NOTICE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type WaitUntil = (promise: Promise<unknown>) => void;

export interface ExceptionContext {
  /** Which part of the API caught it: a request, a cron run or a call. */
  source: "api" | "cron" | "call-session-do";
  route?: string;
  cron?: string;
  job?: string;
  company_id?: string;
  /** Defaults to "error". A warning is a handled condition worth a look. */
  level?: "error" | "warning";
  /** Ids and measurements that help; scrubbed like everything else. */
  extra?: Record<string, unknown>;
}

export interface OpsNotice {
  /** The problem's name, which becomes its fingerprint `ops:<key>`. */
  key: string;
  /** One line: what is wrong. Becomes the PostHog issue title. */
  summary: string;
  /** Measurements and ids. Free text, so it goes through the error scrubber. */
  detail?: string;
  /** The concrete first move for whoever reads this. */
  action?: string;
  /** Defaults to "warning". */
  level?: "error" | "warning";
}

/**
 * The bindings for a helper that is handed only a database client. They are
 * the isolate's, the same object every request and cron in it receives, and
 * capture reads only optional settings from them.
 */
export function workerEnv(): Env {
  return isolateBindings as unknown as Env;
}

function client(env: Env): PostHog | null {
  if (!env.POSTHOG_API_KEY) return null;
  // A laptop's errors are on the terminal in front of whoever caused them.
  if (env.LOCAL_DEV === "1") return null;
  const posthog = new PostHog(env.POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: REQUEST_TIMEOUT_MS,
    fetchRetryCount: 1,
    fetchRetryDelay: RETRY_DELAY_MS,
    disableGeoip: true,
    // A few hundred bytes each; plain JSON keeps Workers Logs readable.
    disableCompression: true,
    before_send: (event) =>
      event.event === "$exception"
        ? {
            ...event,
            properties: scrubUnknown(event.properties) as typeof event.properties,
          }
        : event,
  });
  // The SDK reports a failed send here rather than rejecting the capture.
  posthog.on("error", (cause: unknown) => {
    console.error("posthog send failed:", cause instanceof Error ? cause.message : String(cause));
  });
  return posthog;
}

/**
 * Which deployment sent an event, for the ones sent outside this module (the
 * funnel events), so an alert can leave the rig's out.
 */
export function environmentOf(env: Env): string {
  return telemetryEnvironment(env);
}

function baseProperties(env: Env): Record<string, unknown> {
  return {
    environment: environmentOf(env),
    release: env.GIT_SHA,
    // About the code or a workspace, never a visitor.
    $process_person_profile: false,
  };
}

/**
 * A copy of the thrown value that carries only scrubbed text. The SDK reads
 * `name`, `message`, `stack` and `cause`, so those are all it gets.
 */
export function scrubbedError(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) {
    return typeof value === "string" ? scrubText(value) : scrubUnknown(value);
  }
  const copy = new Error(scrubText(value.message));
  copy.name = value.name;
  copy.stack = value.stack === undefined ? undefined : scrubText(value.stack);
  if (value.cause !== undefined && depth < MAX_CAUSES) {
    copy.cause = scrubbedError(value.cause, depth + 1);
  }
  return copy;
}

function send(
  name: string,
  sending: () => Promise<void>,
  waitUntil: WaitUntil,
): Promise<void> {
  const done = sending().catch((cause: unknown) => {
    console.error(
      `posthog ${name} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  });
  waitUntil(done);
  return done;
}

/** One caught or uncaught error. */
export function captureException(
  env: Env,
  error: unknown,
  context: ExceptionContext,
  waitUntil: WaitUntil = invocationWaitUntil,
): Promise<void> {
  const posthog = client(env);
  if (posthog === null) return Promise.resolve();
  const { level = "error", extra, ...where } = context;
  return send(
    "exception capture",
    () =>
      posthog.captureExceptionImmediate(scrubbedError(error), SYSTEM_DISTINCT_ID, {
        ...baseProperties(env),
        ...where,
        ...(extra === undefined ? {} : { extra }),
        $exception_level: level,
      }),
    waitUntil,
  );
}

/**
 * A condition the product handles that a person must act on: a chargeback, a
 * port-out, a cost cap reached. One PostHog issue per key. Send it once, when
 * the condition starts, not on every request it refuses afterwards.
 */
export function opsNotice(
  env: Env,
  notice: OpsNotice,
  waitUntil: WaitUntil = invocationWaitUntil,
): Promise<void> {
  const posthog = client(env);
  if (posthog === null) return Promise.resolve();
  const { key, summary, detail, action, level = "warning" } = notice;
  if (!NOTICE_KEY.test(key)) {
    // Still sent: a badly named notice beats a lost one.
    console.error(`ops notice key '${key}' is not lowercase words joined by hyphens`);
  }
  const error = new Error(scrubText(summary));
  error.name = "OpsNotice";
  return send(
    `ops notice ${key}`,
    () =>
      posthog.captureExceptionImmediate(error, SYSTEM_DISTINCT_ID, {
        ...baseProperties(env),
        $exception_fingerprint: `ops:${key}`,
        $exception_level: level,
        ops_key: key,
        ...(detail === undefined ? {} : { detail: scrubText(detail) }),
        ...(action === undefined ? {} : { action: scrubText(action) }),
      }),
    waitUntil,
  );
}

/**
 * One product or health event. `properties` pass `scrubProperties`, which
 * drops anything that reads as free text, a phone number or an email address.
 */
export function captureEvent(
  env: Env,
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
  waitUntil: WaitUntil = invocationWaitUntil,
): Promise<void> {
  const posthog = client(env);
  if (posthog === null) return Promise.resolve();
  const safe = scrubProperties(event, properties, (message) => {
    console.error(message);
    void captureException(env, message, { source: "api", level: "warning" }, waitUntil);
  });
  return send(
    `capture '${event}'`,
    () =>
      posthog.captureImmediate({
        distinctId,
        event,
        properties: { ...baseProperties(env), ...safe },
      }),
    waitUntil,
  );
}
