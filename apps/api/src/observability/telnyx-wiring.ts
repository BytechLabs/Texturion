import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { productionWatchRefusal } from "../environments/policy";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";
import type { ReportedSpendLimit } from "../telnyx/spend-limits";
import { telnyxWebhookUrl } from "../telnyx/wizard";
import { opsAlert } from "./ops-alert";

/**
 * D142 PW01: is production's Telnyx wiring still pointed at production?
 *
 * Every call and text reaches us through a webhook URL held on a Telnyx
 * resource: the Call Control application, the WebRTC credential connection,
 * and each workspace's messaging profile. A portal edit, or a rig setup
 * routine aimed at the wrong resource, moves one of them and nothing errors:
 * the events just go somewhere else. So once a day this reads each one and
 * compares it with the URL production builds for itself, then reads the last
 * 24 hours of failed webhook deliveries.
 *
 * READ ONLY. Every request is a GET with production's own key; a test asserts
 * it. Production only: on the rig and on a laptop `productionWatchRefusal`
 * stops it before any request.
 *
 * NOTHING PERSONAL LEAVES. A delivery carries the event's payload (numbers,
 * message text) and a credential connection carries its password. Neither is
 * read past the fields compared here: URLs are reported without query or
 * credentials, deliveries as counts by event type and HTTP status.
 */

export type WiredResource =
  | "call_control_application"
  | "credential_connection"
  | "messaging_profile";

export interface WiringMismatch {
  resource: WiredResource;
  id: string;
  field: string;
  expected: string;
  actual: string;
}

export interface DeliveryFailures {
  /** Failed deliveries with an attempt at production's webhook URL. */
  failed: number;
  /** Failed deliveries tried at production's host under another path. */
  misrouted: number;
  /** Failed deliveries to other hosts: the rig's edge, or another integration. */
  elsewhere: number;
  byEventType: Record<string, number>;
  /** The last attempt's HTTP status, or "none" when nothing answered. */
  byStatus: Record<string, number>;
  /** More failures exist than the pages read. */
  truncated: boolean;
}

export interface WiringReport {
  expectedWebhookUrl: string;
  checked: { resource: WiredResource; id: string }[];
  mismatches: WiringMismatch[];
  /** Notes about what could not be checked, never a pass in disguise. */
  unchecked: string[];
  deliveries: DeliveryFailures;
}

export const PAGE_SIZE = 250;
/** 5,000 profiles, far beyond today's fleet; past it the rest are reported unchecked. */
export const MAX_PROFILE_PAGES = 20;
/** 1,000 failed deliveries is already a fire; counting further changes nothing. */
const MAX_DELIVERY_PAGES = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ConnectionSettings {
  webhook_event_url?: string | null;
  webhook_event_failover_url?: string | null;
  webhook_api_version?: string | null;
}

interface ConnectionResponse {
  data?: ConnectionSettings;
}

export interface MessagingProfileItem extends ReportedSpendLimit {
  id?: string;
  webhook_url?: string | null;
  webhook_failover_url?: string | null;
  webhook_api_version?: string | null;
}

interface PageMeta {
  page_number?: number;
  total_pages?: number;
  total_results?: number;
}

interface DeliveryAttempt {
  http?: {
    request?: { url?: string | null };
    response?: { status?: number | null } | null;
  } | null;
}

interface DeliveryItem {
  webhook?: { event_type?: string | null } | null;
  attempts?: DeliveryAttempt[] | null;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** A URL as it may be reported: origin and path, never a query or a userinfo. */
export function reportableUrl(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "(unset)";
  try {
    const url = new URL(value);
    return trimSlash(`${url.origin}${url.pathname}`);
  } catch {
    return "(not a URL)";
  }
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function sameUrl(value: string | null | undefined, expected: string): boolean {
  return typeof value === "string" && trimSlash(value.trim()) === trimSlash(expected);
}

function compare(
  mismatches: WiringMismatch[],
  resource: WiredResource,
  id: string,
  fields: {
    url?: string | null;
    failover?: string | null;
    apiVersion?: string | null;
  },
  expected: string,
  failoverMayBeUnset: boolean,
): void {
  if (!sameUrl(fields.url, expected)) {
    mismatches.push({
      resource,
      id,
      field: "webhook URL",
      expected,
      actual: reportableUrl(fields.url),
    });
  }
  const failoverUnset = fields.failover === null || fields.failover === undefined ||
    fields.failover.trim() === "";
  if (!(sameUrl(fields.failover, expected) || (failoverMayBeUnset && failoverUnset))) {
    mismatches.push({
      resource,
      id,
      field: "webhook failover URL",
      expected: failoverMayBeUnset ? `${expected} or unset` : expected,
      actual: reportableUrl(fields.failover),
    });
  }
  // Every handler parses v2 events; a v1 resource delivers nothing we can read.
  if (fields.apiVersion !== undefined && fields.apiVersion !== null && fields.apiVersion !== "2") {
    mismatches.push({
      resource,
      id,
      field: "webhook API version",
      expected: "2",
      actual: String(fields.apiVersion),
    });
  }
}

async function readConnection(
  env: Env,
  resource: "call_control_application" | "credential_connection",
  id: string,
): Promise<ConnectionSettings | null> {
  try {
    const response =
      resource === "call_control_application"
        ? await telnyxRequest<ConnectionResponse>(env, {
            method: "GET",
            path: `/v2/call_control_applications/${id}`,
          })
        : await telnyxRequest<ConnectionResponse>(env, {
            method: "GET",
            path: `/v2/credential_connections/${id}`,
          });
    return response?.data ?? null;
  } catch (cause) {
    // The id production is configured with no longer exists: that is drift.
    if (cause instanceof TelnyxApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** Telnyx's view of every messaging profile in the account, up to the page cap. */
export async function listMessagingProfiles(
  env: Env,
): Promise<{ profiles: Map<string, MessagingProfileItem>; truncated: boolean }> {
  const profiles = new Map<string, MessagingProfileItem>();
  for (let page = 1; page <= MAX_PROFILE_PAGES; page += 1) {
    const body = await telnyxRequest<{ data?: MessagingProfileItem[]; meta?: PageMeta }>(env, {
      method: "GET",
      path: "/v2/messaging_profiles",
      query: { "page[number]": String(page), "page[size]": String(PAGE_SIZE) },
    });
    const items = Array.isArray(body?.data) ? body.data : [];
    for (const item of items) {
      if (typeof item.id === "string") profiles.set(item.id, item);
    }
    const lastPage = body?.meta?.total_pages;
    if (items.length < PAGE_SIZE || (typeof lastPage === "number" && page >= lastPage)) {
      return { profiles, truncated: false };
    }
  }
  return { profiles, truncated: true };
}

/** Production's own profiles: the ones its workspaces were given. */
export async function productionProfileIds(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from("companies")
    .select("telnyx_messaging_profile_id")
    .not("telnyx_messaging_profile_id", "is", null);
  if (error) throw new Error(`messaging profile ids read failed: ${error.message}`);
  const ids = (data ?? [])
    .map((row) => (row as { telnyx_messaging_profile_id: string | null }).telnyx_messaging_profile_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].sort();
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** The last 24 hours of failed deliveries, as counts. */
async function readDeliveryFailures(
  env: Env,
  now: Date,
  expected: string,
): Promise<DeliveryFailures> {
  const summary: DeliveryFailures = {
    failed: 0,
    misrouted: 0,
    elsewhere: 0,
    byEventType: {},
    byStatus: {},
    truncated: false,
  };
  const productionOrigin = new URL(expected).origin;
  const since = new Date(now.getTime() - DAY_MS).toISOString();

  for (let page = 1; page <= MAX_DELIVERY_PAGES; page += 1) {
    const body = await telnyxRequest<{ data?: DeliveryItem[]; meta?: PageMeta }>(env, {
      method: "GET",
      path: "/v2/webhook_deliveries",
      query: {
        "filter[status][eq]": "failed",
        "filter[started_at][gte]": since,
        "page[number]": String(page),
        "page[size]": String(PAGE_SIZE),
      },
    });
    const items = Array.isArray(body?.data) ? body.data : [];
    for (const item of items) {
      const attempts = Array.isArray(item.attempts) ? item.attempts : [];
      const urls = attempts
        .map((attempt) => attempt?.http?.request?.url)
        .filter((url): url is string => typeof url === "string");
      if (urls.some((url) => sameUrl(url, expected))) {
        summary.failed += 1;
        bump(summary.byEventType, item.webhook?.event_type ?? "unknown");
        // Attempts are listed most recent first.
        const status = attempts[0]?.http?.response?.status;
        bump(summary.byStatus, typeof status === "number" ? String(status) : "none");
      } else if (urls.some((url) => originOf(url) === productionOrigin)) {
        summary.misrouted += 1;
      } else {
        summary.elsewhere += 1;
      }
    }
    const lastPage = body?.meta?.total_pages;
    if (items.length < PAGE_SIZE || (typeof lastPage === "number" && page >= lastPage)) {
      return summary;
    }
  }
  summary.truncated = true;
  return summary;
}

/**
 * Read production's wiring and report it. Null when this deployment is not
 * production, before any request is made.
 */
export async function runTelnyxWiringWatch(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<WiringReport | null> {
  const refusal = productionWatchRefusal(env);
  if (refusal !== null) {
    console.log(`telnyx wiring watch skipped: ${refusal}`);
    return null;
  }

  const expected = telnyxWebhookUrl(env);
  const report: WiringReport = {
    expectedWebhookUrl: expected,
    checked: [],
    mismatches: [],
    unchecked: [],
    deliveries: {
      failed: 0,
      misrouted: 0,
      elsewhere: 0,
      byEventType: {},
      byStatus: {},
      truncated: false,
    },
  };

  const voiceId = env.TELNYX_VOICE_CONNECTION_ID;
  const voice = await readConnection(env, "call_control_application", voiceId);
  report.checked.push({ resource: "call_control_application", id: voiceId });
  if (voice === null) {
    report.mismatches.push({
      resource: "call_control_application",
      id: voiceId,
      field: "existence",
      expected: "TELNYX_VOICE_CONNECTION_ID exists",
      actual: "not found",
    });
  } else {
    compare(
      report.mismatches,
      "call_control_application",
      voiceId,
      {
        url: voice.webhook_event_url,
        failover: voice.webhook_event_failover_url,
        apiVersion: voice.webhook_api_version,
      },
      expected,
      false,
    );
  }

  // docs/deploy/04-telnyx.md creates the credential connection with a webhook
  // URL and no failover, so unset is expected there; anything else is not.
  const webrtcId = env.TELNYX_WEBRTC_CONNECTION_ID;
  if (webrtcId === undefined) {
    report.unchecked.push("TELNYX_WEBRTC_CONNECTION_ID is unset, so no credential connection");
  } else {
    const webrtc = await readConnection(env, "credential_connection", webrtcId);
    report.checked.push({ resource: "credential_connection", id: webrtcId });
    if (webrtc === null) {
      report.mismatches.push({
        resource: "credential_connection",
        id: webrtcId,
        field: "existence",
        expected: "TELNYX_WEBRTC_CONNECTION_ID exists",
        actual: "not found",
      });
    } else {
      compare(
        report.mismatches,
        "credential_connection",
        webrtcId,
        {
          url: webrtc.webhook_event_url,
          failover: webrtc.webhook_event_failover_url,
          apiVersion: webrtc.webhook_api_version,
        },
        expected,
        true,
      );
    }
  }

  // The account also holds the rig's profiles, so only the ones production's
  // workspaces were given are judged.
  const ids = await productionProfileIds(db);
  if (ids.length > 0) {
    const { profiles, truncated } = await listMessagingProfiles(env);
    for (const id of ids) {
      const profile = profiles.get(id);
      if (profile === undefined) {
        if (truncated) {
          report.unchecked.push(`messaging profile ${id}: beyond the ${MAX_PROFILE_PAGES * PAGE_SIZE} profiles read`);
        } else {
          report.mismatches.push({
            resource: "messaging_profile",
            id,
            field: "existence",
            expected: "listed in the account",
            actual: "not found",
          });
          report.checked.push({ resource: "messaging_profile", id });
        }
        continue;
      }
      report.checked.push({ resource: "messaging_profile", id });
      compare(
        report.mismatches,
        "messaging_profile",
        id,
        {
          url: profile.webhook_url,
          failover: profile.webhook_failover_url,
          apiVersion: profile.webhook_api_version,
        },
        expected,
        false,
      );
    }
  }

  report.deliveries = await readDeliveryFailures(env, now, expected);

  console.log(
    `telnyx wiring: checked ${report.checked.length} resource(s), ` +
      `${report.mismatches.length} mismatch(es), ${report.deliveries.failed} failed ` +
      `delivery(ies) to production, ${report.deliveries.misrouted} misrouted, ` +
      `${report.deliveries.elsewhere} elsewhere` +
      (report.unchecked.length > 0 ? `; unchecked: ${report.unchecked.join("; ")}` : ""),
  );

  const failing =
    report.mismatches.length > 0 ||
    report.deliveries.failed > 0 ||
    report.deliveries.misrouted > 0;
  if (failing) await alertWiring(env, report);
  return report;
}

function counts(record: Record<string, number>): string {
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
}

async function alertWiring(env: Env, report: WiringReport): Promise<void> {
  const lines: string[] = [];
  for (const mismatch of report.mismatches) {
    lines.push(
      `${mismatch.resource} ${mismatch.id}: ${mismatch.field} is ${mismatch.actual}, ` +
        `expected ${mismatch.expected}`,
    );
  }
  const { deliveries } = report;
  if (deliveries.failed > 0) {
    lines.push(
      `${deliveries.failed}${deliveries.truncated ? "+" : ""} webhook deliveries to ` +
        `${report.expectedWebhookUrl} failed in the last 24 hours ` +
        `(events: ${counts(deliveries.byEventType)}; last status: ${counts(deliveries.byStatus)})`,
    );
  }
  if (deliveries.misrouted > 0) {
    lines.push(
      `${deliveries.misrouted} failed deliveries went to production's host under a ` +
        "path other than the webhook route",
    );
  }
  if (report.unchecked.length > 0) lines.push(`Not checked: ${report.unchecked.join("; ")}`);

  const summary =
    report.mismatches.length > 0
      ? `Telnyx wiring has drifted: ${report.mismatches.length} setting(s) differ from production's`
      : "Telnyx could not deliver webhooks to production";

  await opsAlert(env, {
    key: "telnyx-wiring",
    level: report.mismatches.length > 0 ? "error" : "warning",
    summary,
    detail: lines.join("\n"),
    action:
      "For a setting: open the resource in portal.telnyx.com (Voice > Programmable Voice " +
      "for the application, SIP Connections for the credential connection, Messaging for " +
      `a profile) and set the webhook and failover URLs back to ${report.expectedWebhookUrl}. ` +
      "For failed deliveries: portal.telnyx.com > Debugging > Webhooks, filtered to failed, " +
      "shows each attempt's response; the /webhooks/telnyx route's own errors are in Sentry.",
  });
}
