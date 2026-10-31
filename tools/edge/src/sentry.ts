/**
 * Sentry by DSN alone, one envelope POST per event. No Sentry token exists
 * anywhere in the rig, and a DSN can only ingest.
 */

export interface SentryTarget {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** `https://<key>@<host>[/<path>]/<project>` to its envelope endpoint, or null. */
export function parseDsn(dsn: string | undefined): SentryTarget | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  const project = url.pathname.split("/").filter(Boolean);
  const projectId = project.pop();
  if (url.protocol !== "https:" || !url.username || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = project.length > 0 ? `/${project.join("/")}` : "";
  return {
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    publicKey: decodeURIComponent(url.username),
    dsn: dsn.trim(),
  };
}

/**
 * No `release`: Sentry creates a release for every one an event names, and
 * production's project tracks regressions by its own deploys. The edge's
 * commit goes in the `edge_sha` tag instead.
 */
export interface EdgeEvent {
  fingerprint: string[];
  message: string;
  level: "warning" | "error";
  environment: string;
  edgeSha?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** True when Sentry accepted the event. Never throws. */
export async function sendSentryEvent(dsn: string | undefined, event: EdgeEvent): Promise<boolean> {
  const target = parseDsn(dsn);
  if (!target) return false;
  const id = eventId();
  const now = new Date();
  const payload = {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: "javascript",
    level: event.level,
    logger: "loonext-rig-edge",
    server_name: "loonext-rig-edge",
    environment: event.environment,
    message: { formatted: event.message },
    fingerprint: event.fingerprint,
    tags: {
      ...event.tags,
      ...(event.edgeSha ? { edge_sha: event.edgeSha } : {}),
      ...(event.fingerprint[0] === "ops" ? { ops_key: event.fingerprint[1] } : {}),
    },
    extra: event.extra ?? {},
  };
  const body = [
    JSON.stringify({ event_id: id, sent_at: now.toISOString(), dsn: target.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(payload),
  ].join("\n");
  try {
    const response = await fetch(target.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=loonext-rig-edge/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (cause) {
    console.warn(`sentry: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  }
}
