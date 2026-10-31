import type { Ctx } from "./context";

/**
 * Production Sentry events, by DSN envelope only (docs/RIG.md:
 * no Sentry write token exists anywhere). The fingerprint is `['ops', key]`,
 * the same grouping `apps/api/src/observability/ops-alert.ts` uses, so one
 * problem is one production issue whichever Worker raised it.
 */
export interface ProductionEvent {
  key: string;
  summary: string;
  detail?: string;
  level?: "warning" | "error";
}

export interface ParsedDsn {
  publicKey: string;
  envelopeUrl: string;
}

/** `https://<key>@<host>[/<path>]/<project>` to its envelope endpoint, or null. */
export function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.username) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const project = segments.pop();
  if (!project || !/^\d+$/.test(project)) return null;
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return {
    publicKey: decodeURIComponent(url.username),
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
  };
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** The envelope body: header, item header, event, one JSON object per line. */
export function buildEnvelope(dsn: string, event: ProductionEvent, now: number): string {
  const id = eventId();
  const sentAt = new Date(now).toISOString();
  const payload = {
    event_id: id,
    timestamp: now / 1000,
    platform: "javascript",
    level: event.level ?? "warning",
    logger: "loonext-telnyx-guard",
    server_name: "loonext-telnyx-guard",
    environment: "production",
    message: { formatted: event.summary },
    fingerprint: ["ops", event.key],
    tags: { ops_key: event.key, source: "loonext-telnyx-guard" },
    extra: event.detail ? { detail: event.detail } : {},
  };
  return [
    JSON.stringify({ event_id: id, sent_at: sentAt, dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(payload),
  ].join("\n");
}

/**
 * Best effort, and never thrown: this runs inside refusals and crons, where a
 * failed alert must not become a second failure. Returns whether Sentry
 * accepted it, so a caller that must know (the key inventory) can say so.
 */
export async function sendProductionEvent(ctx: Ctx, event: ProductionEvent): Promise<boolean> {
  const dsn = ctx.config.sentryProdDsn;
  const parsed = dsn ? parseDsn(dsn) : null;
  if (!dsn || !parsed) {
    console.error(`guard: production event ${event.key} not sent: SENTRY_PROD_DSN unset or malformed`);
    return false;
  }
  try {
    const response = await ctx.fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=loonext-telnyx-guard/1`,
      },
      body: buildEnvelope(dsn, event, ctx.now()),
    });
    await response.body?.cancel();
    if (!response.ok) console.error(`guard: production event ${event.key}: Sentry answered ${response.status}`);
    return response.ok;
  } catch (cause) {
    console.error(
      `guard: production event ${event.key} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return false;
  }
}
