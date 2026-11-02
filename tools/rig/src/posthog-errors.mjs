/**
 * PostHog's error tracking, read the way R00 and the Sentry-to-PostHog parity
 * check need it (D144, #652).
 *
 * Everything here goes through PostHog's HogQL query endpoint, which answers
 * for `$exception` events by fingerprint, environment and time. Credentials
 * come from the environment and are never written anywhere:
 *   POSTHOG_PERSONAL_API_KEY   a personal key with query:read (alerts: hog_function:write)
 *   POSTHOG_PROJECT_ID         optional; the key's first project when unset
 *   POSTHOG_APP_HOST           optional; https://us.posthog.com
 *   SENTRY_PARITY_TOKEN (else SENTRY_AUTH_TOKEN), SENTRY_ORG   parity only, to list Sentry's
 *                              ops keys; the token needs organization read access
 *
 * Usage:
 *   node tools/rig/src/posthog-errors.mjs parity [--days 14] [--environment production]
 *   node tools/rig/src/posthog-errors.mjs alerts   (needs POSTHOG_ALERT_WEBHOOK_URL and OPS_ALERT_WEBHOOK_SECRET)
 */
import { pathToFileURL } from "node:url";

export const DEFAULT_APP_HOST = "https://us.posthog.com";

/** The environments that must never reach PostHog: the rig's and rigd's own. */
export const NON_PRODUCTION_ENVIRONMENTS = ["rig", "synthetic", "development"];

/** The two events PostHog raises for an issue, which the alerts are filtered on. */
export const ALERT_EVENTS = [
  { name: "Loonext: new error issue", event: "$error_tracking_issue_created" },
  { name: "Loonext: reopened error issue", event: "$error_tracking_issue_reopened" },
];

/** The header the API Worker's /webhooks/posthog-alert reads the shared secret from. */
export const OPS_SECRET_HEADER = "x-loonext-ops-secret";

/** The rule the API Worker and the browser apply: a Sentry fingerprint joined by a colon. */
export function posthogFingerprint(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  if (parts.every((part) => part === "{{ default }}")) return undefined;
  return parts.join(":");
}

/** Reads the PostHog settings from an environment, or null when the key is missing. */
export function posthogSettings(env = process.env) {
  const key = env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return null;
  return {
    key,
    projectId: env.POSTHOG_PROJECT_ID || undefined,
    host: (env.POSTHOG_APP_HOST || DEFAULT_APP_HOST).replace(/\/+$/, ""),
  };
}

async function api(settings, fetchImpl, path, init = {}) {
  const response = await fetchImpl(`${settings.host}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${settings.key}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`PostHog answered ${response.status} for ${init.method ?? "GET"} ${path.split("?")[0]}`);
  return response.json();
}

/** The project to read: POSTHOG_PROJECT_ID, else the key's first project. */
export async function resolveProjectId(settings, fetchImpl = fetch) {
  if (settings.projectId) return settings.projectId;
  const projects = await api(settings, fetchImpl, "/api/projects/");
  const first = projects?.results?.[0]?.id;
  if (first === undefined) throw new Error("PostHog lists no project for this key");
  return String(first);
}

function hogql(sql) {
  return { query: { kind: "HogQLQuery", query: sql } };
}

/** Quote for HogQL: only the strings this module builds itself, never user input. */
function literal(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * `$exception` events in the last `hours`, one row per (fingerprint, environment).
 * An event with no custom fingerprint has a null `fingerprint`: PostHog grouped
 * it from the stack.
 *
 * @returns {Promise<{ fingerprint: string | null, environment: string | null, count: number, last_seen: string }[]>}
 */
export async function exceptionRows(settings, { hours = 24, environments, fetch: fetchImpl = fetch } = {}) {
  const projectId = await resolveProjectId(settings, fetchImpl);
  const where = [`event = '$exception'`, `timestamp > now() - interval ${Math.max(1, Math.floor(hours))} hour`];
  if (environments?.length) where.push(`properties.environment in (${environments.map(literal).join(", ")})`);
  const sql =
    "select properties.$exception_fingerprint as fingerprint, properties.environment as environment, " +
    "count() as n, toString(max(timestamp)) as last_seen from events " +
    `where ${where.join(" and ")} group by fingerprint, environment order by n desc limit 1000`;
  const body = await api(settings, fetchImpl, `/api/environments/${projectId}/query/`, {
    method: "POST",
    body: JSON.stringify(hogql(sql)),
  });
  if (!Array.isArray(body?.results)) throw new Error("PostHog's query answer has no results");
  return body.results.map(([fingerprint, environment, count, last]) => ({
    fingerprint: fingerprint ?? null,
    environment: environment ?? null,
    count: Number(count),
    last_seen: String(last),
  }));
}

/**
 * R00's PostHog half. No rig or rigd event may reach the production project:
 * the API Worker sends nothing from the rig because the rig has no
 * POSTHOG_API_KEY, and this fails the day that stops being true.
 *
 * @returns {Promise<{ failure: string | null, published: object }>}
 */
export async function posthogErrorsCheck(env = process.env, fetchImpl = fetch) {
  const settings = posthogSettings(env);
  if (settings === null) {
    return { failure: null, published: { configured: false } };
  }
  let rows;
  try {
    rows = await exceptionRows(settings, { hours: 24, fetch: fetchImpl });
  } catch (error) {
    return {
      failure: `PostHog's error events could not be read: ${error instanceof Error ? error.message : String(error)}`,
      published: { configured: true, readable: false },
    };
  }
  const leaked = rows.filter((row) => row.environment !== null && NON_PRODUCTION_ENVIRONMENTS.includes(row.environment));
  const published = {
    configured: true,
    readable: true,
    exception_events_24h: rows.reduce((sum, row) => sum + row.count, 0),
    fingerprints_24h: rows.filter((row) => row.fingerprint !== null).length,
  };
  if (leaked.length === 0) return { failure: null, published };
  const names = leaked.map((row) => `${row.environment}:${row.fingerprint ?? "(grouped by stack)"}`).slice(0, 5).join(", ");
  return {
    failure: `${leaked.length} non-production error fingerprint(s) reached PostHog in 24 hours (${names}); the rig must send none`,
    published,
  };
}

// ---------------------------------------------------------------------------
// Parity: every ops key Sentry saw must have arrived in PostHog (phase 2's gate)
// ---------------------------------------------------------------------------

/** The `ops_key` tag values Sentry saw in the window, for one environment. */
export async function sentryOpsKeys({ token, org, days, environment, fetch: fetchImpl = fetch }) {
  const url =
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/tags/ops_key/values/` +
    `?statsPeriod=${days}d&environment=${encodeURIComponent(environment)}&project=-1`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Sentry answered ${response.status} for the ops_key tag values`);
  const values = await response.json();
  if (!Array.isArray(values)) throw new Error("Sentry's ops_key tag values are not a list");
  return values.map((entry) => String(entry.value)).sort();
}

/**
 * The ops keys Sentry saw that PostHog did not. An empty `sentryKeys` is a
 * failure of its own: a parity check with nothing to compare proves nothing.
 *
 * @returns {{ ok: boolean, checked: number, missing: string[], reason?: string }}
 */
export function parity(sentryKeys, posthogFingerprints) {
  if (sentryKeys.length === 0) {
    return { ok: false, checked: 0, missing: [], reason: "Sentry saw no ops alert in the window, so there is nothing to compare" };
  }
  const have = new Set(posthogFingerprints.filter((fingerprint) => fingerprint !== null));
  const missing = sentryKeys.filter((key) => !have.has(posthogFingerprint(["ops", key])));
  return { ok: missing.length === 0, checked: sentryKeys.length, missing };
}

// ---------------------------------------------------------------------------
// Alerts: error-tracking hog functions, created through the API
// ---------------------------------------------------------------------------

/**
 * The hog function body for one alert event, posting the issue to a webhook.
 *
 * PostHog does not fill in the template's default body when a function is
 * created through the API (the input is stored as null and the POST goes out
 * empty), so the body is spelled out here in the shape
 * apps/api/src/webhooks/posthog-alert.ts reads. The shared secret goes in
 * `secret_headers`, which PostHog stores encrypted and never shows again.
 */
export function alertFunction(alert, webhookUrl, secret) {
  return {
    type: "internal_destination",
    name: alert.name,
    enabled: true,
    template_id: "template-webhook",
    filters: { events: [{ id: alert.event, type: "events" }] },
    inputs: {
      url: { value: webhookUrl },
      method: { value: "POST" },
      headers: { value: { "content-type": "application/json" } },
      body: {
        value: {
          event: {
            event: "{event.event}",
            distinct_id: "{event.distinct_id}",
            url: "{project.url}/error-tracking/fingerprint/{encodeURLComponent(event.properties.fingerprint)}?utm_source=alert&utm_medium=email",
            properties: {
              name: "{event.properties.name}",
              description: "{event.properties.description}",
              status: "{event.properties.status}",
              fingerprint: "{event.properties.fingerprint}",
              $exception_fingerprint: "{event.properties.$exception_fingerprint}",
            },
          },
        },
      },
      ...(secret ? { secret_headers: { value: { [OPS_SECRET_HEADER]: secret } } } : {}),
    },
  };
}

/** Creates or updates the two alerts so a re-run converges on one copy of each. */
export async function applyAlerts(settings, webhookUrl, secret, fetchImpl = fetch) {
  if (!/^https:\/\//.test(webhookUrl)) throw new Error("POSTHOG_ALERT_WEBHOOK_URL must be an https URL");
  if (!secret) throw new Error("OPS_ALERT_WEBHOOK_SECRET is needed: the Worker refuses a webhook without it");
  const projectId = await resolveProjectId(settings, fetchImpl);
  const listed = await api(settings, fetchImpl, `/api/environments/${projectId}/hog_functions/?type=internal_destination&limit=200`);
  const outcomes = [];
  for (const alert of ALERT_EVENTS) {
    const existing = (listed?.results ?? []).find((fn) => fn.name === alert.name && !fn.deleted);
    const body = JSON.stringify(alertFunction(alert, webhookUrl, secret));
    if (existing) {
      await api(settings, fetchImpl, `/api/environments/${projectId}/hog_functions/${existing.id}/`, { method: "PATCH", body });
      outcomes.push({ name: alert.name, action: "updated" });
    } else {
      await api(settings, fetchImpl, `/api/environments/${projectId}/hog_functions/`, { method: "POST", body });
      outcomes.push({ name: alert.name, action: "created" });
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

export async function main(args, env = process.env, fetchImpl = fetch, out = console.log) {
  const [command] = args;
  const settings = posthogSettings(env);
  if (settings === null) {
    out("POSTHOG_PERSONAL_API_KEY is not set");
    return 2;
  }
  if (command === "parity") {
    const days = Number(flag(args, "days", "14"));
    const environment = flag(args, "environment", "production");
    const sentryToken = env.SENTRY_PARITY_TOKEN || env.SENTRY_AUTH_TOKEN;
    if (!sentryToken || !env.SENTRY_ORG) {
      out("SENTRY_PARITY_TOKEN (or SENTRY_AUTH_TOKEN) and SENTRY_ORG are needed to list Sentry's ops keys");
      return 2;
    }
    const keys = await sentryOpsKeys({ token: sentryToken, org: env.SENTRY_ORG, days, environment, fetch: fetchImpl });
    const rows = await exceptionRows(settings, { hours: days * 24, environments: [environment], fetch: fetchImpl });
    const result = parity(keys, rows.map((row) => row.fingerprint));
    out(JSON.stringify({ days, environment, ...result }, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === "alerts") {
    const webhook = env.POSTHOG_ALERT_WEBHOOK_URL;
    if (!webhook) {
      out("POSTHOG_ALERT_WEBHOOK_URL is not set");
      return 2;
    }
    const secret = env.OPS_ALERT_WEBHOOK_SECRET;
    if (!secret) {
      out("OPS_ALERT_WEBHOOK_SECRET is not set");
      return 2;
    }
    out(JSON.stringify(await applyAlerts(settings, webhook, secret, fetchImpl), null, 2));
    return 0;
  }
  out("usage: posthog-errors.mjs parity [--days N] [--environment E] | alerts");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
