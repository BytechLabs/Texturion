/**
 * Ring beacons (D142): what a member's device says happened to one ring.
 *
 * The server only sees the push go out. Splitting "the phone didn't ring" into
 * never received, never shown, or shown but the answer failed needs the device
 * to report each stage it reaches, one beacon per stage:
 *
 *   POST /v1/ring-beacons   { call_session_id, stage, occurred_at?, os?,
 *                             permissions?, standby_bucket?, power_save?,
 *                             device_idle?, screen_locked? }   → 202 { recorded }
 *
 * NOTHING PERSONAL. The body is a session id, a stage word and device state
 * from fixed vocabularies; no caller number, name, message or recording.
 * Platform and build come from the X-Client and X-App-Version headers,
 * validated as the session ledger validates them so the two cannot disagree.
 *
 * BEST-EFFORT. Clients fire and forget and never wait on this before ringing.
 * Device-state fields that do not parse are dropped rather than refused, so a
 * newer client reporting an unknown state still records its stage.
 *
 * CAPPED. Each beacon costs a count and an insert under a session id the
 * client names, so a member records at most RING_BEACON_DAILY_CAP per
 * workspace in any 24 hours. Past it the beacon is dropped with a 202; the
 * operator is alerted at 80% and at the cap.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import { requestAppVersion, requestClient } from "../auth/request-origin";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { opsAlert } from "../observability/ops-alert";
import { parseJsonBody } from "./core/http";

/**
 * The stages a ring can reach on a device, in the order they normally happen.
 * The three clients spell these exactly; ring-beacons.test.ts reads their
 * sources and fails on a word that exists on one side only.
 */
export const RING_BEACON_STAGES = [
  "push_received",
  "os_reported",
  "ring_me_sent",
  "ringing_shown",
  "answered",
  "declined",
] as const;

export type RingBeaconStage = (typeof RING_BEACON_STAGES)[number];

/** The permissions worth knowing about when a ring goes missing. */
export const RING_BEACON_PERMISSIONS = [
  "notifications",
  "microphone",
  "full_screen_intent",
  "battery_unrestricted",
] as const;

export const RING_BEACON_PERMISSION_STATES = [
  "granted",
  "denied",
  "prompt",
  "unknown",
] as const;

/** Android's app standby buckets, by name rather than by framework integer. */
export const RING_BEACON_STANDBY_BUCKETS = [
  "exempted",
  "active",
  "working_set",
  "frequent",
  "rare",
  "restricted",
  "unknown",
] as const;

/**
 * Per member, per workspace, per rolling 24 hours. A crew member on two phones
 * and a browser taking sixty calls a day writes a few hundred; this is several
 * times that, so only a broken or hostile client reaches it.
 */
export const RING_BEACON_DAILY_CAP = 1500;
export const RING_BEACON_WARN_AT = Math.floor(RING_BEACON_DAILY_CAP * 0.8);
const RING_BEACON_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Each member's warning and cap alert fire at most once an hour per isolate.
 * Equality with the threshold would fire on every dropped beacon at the cap,
 * because a dropped beacon leaves the count where it was, and two beacons
 * racing past the warning line would skip it altogether.
 */
const CAP_ALERT_EVERY_MS = 60 * 60 * 1000;
const lastCapAlertAt = new Map<string, number>();

function capAlertDue(key: string, nowMs: number): boolean {
  const last = lastCapAlertAt.get(key);
  if (last !== undefined && nowMs - last < CAP_ALERT_EVERY_MS) return false;
  // Bounded memory: forgetting every member costs at most one repeat each.
  if (lastCapAlertAt.size >= 1000) lastCapAlertAt.clear();
  lastCapAlertAt.set(key, nowMs);
  return true;
}

/** Test seam: forget every alert so each test starts unthrottled. */
export function resetRingBeaconAlertsForTest(): void {
  lastCapAlertAt.clear();
}

/**
 * How far a device clock may disagree with ours before its timestamp is thrown
 * away. Beacons are sent as they happen, so anything older than a day is a
 * wrong clock rather than a slow network.
 */
const MAX_CLOCK_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_FUTURE_MS = 5 * 60 * 1000;

const PLATFORMS = new Set(["web", "android", "ios"]);

/**
 * The OS strings the three clients send, lowercased: an SDK level, an iOS
 * version, or the platform a browser names itself by. The ring_beacons CHECK
 * is the same pattern (push-evidence-schema.test.ts), so a value outside it is
 * dropped here rather than failing the insert.
 */
export const RING_BEACON_OS_SHAPE =
  /^(android-[0-9]{1,3}|ios-[0-9]{1,2}(\.[0-9]{1,2}){0,2}|web(-(android|chrome-os|chromium-os|fuchsia|ios|linux|macos|unknown|windows))?)$/;

const beaconSchema = z.object({
  // Telnyx session ids and the server's versioned ones both carry a hyphen or
  // a colon. All digits is a phone number in the wrong field, which this table
  // must never hold.
  call_session_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9:_.-]+$/)
    .refine((value) => !/^\d+$/.test(value)),
  stage: z.enum(RING_BEACON_STAGES),
  occurred_at: z.iso.datetime({ offset: true }).optional().catch(undefined),
  os: z
    .string()
    .max(40)
    .toLowerCase()
    .regex(RING_BEACON_OS_SHAPE)
    .optional()
    .catch(undefined),
  permissions: z
    .record(z.string().max(40), z.string().max(16))
    .optional()
    .catch(undefined),
  standby_bucket: z.enum(RING_BEACON_STANDBY_BUCKETS).optional().catch(undefined),
  power_save: z.boolean().optional().catch(undefined),
  device_idle: z.boolean().optional().catch(undefined),
  screen_locked: z.boolean().optional().catch(undefined),
});

/** Known keys with known values only; anything else is silence. */
function knownPermissions(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const key of RING_BEACON_PERMISSIONS) {
    const value = raw[key];
    if (
      value !== undefined &&
      (RING_BEACON_PERMISSION_STATES as readonly string[]).includes(value)
    ) {
      out[key] = value;
    }
  }
  return out;
}

function believableTimestamp(raw: string | undefined, nowMs: number): string | null {
  if (!raw) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  if (at < nowMs - MAX_CLOCK_PAST_MS || at > nowMs + MAX_CLOCK_FUTURE_MS) return null;
  return new Date(at).toISOString();
}

export const ringBeaconsRoutes = new Hono<AppEnv>();

// The capability that mints the WebRTC credential and asks for ring-me: a
// member without it is never rung, so has no ring to report.
ringBeaconsRoutes.post("/ring-beacons", requireCapability("conversations.send"), async (c) => {
  const platform = requestClient(c);
  if (!PLATFORMS.has(platform)) {
    throw new ApiError(
      "validation_failed",
      "X-Client must name the app sending the beacon.",
    );
  }
  const body = await parseJsonBody(c, beaconSchema);
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const nowMs = Date.now();

  const { count, error: countError } = await db
    .from("ring_beacons")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .gte("created_at", new Date(nowMs - RING_BEACON_CAP_WINDOW_MS).toISOString());
  if (countError) {
    throw new Error(`ring beacon cap count failed: ${countError.message}`);
  }
  const recent = count ?? 0;

  const member = `${companyId}:${userId}`;
  if (recent >= RING_BEACON_DAILY_CAP) {
    if (capAlertDue(`cap:${member}`, nowMs)) {
      await opsAlert(env, {
        key: "ring-beacons-member-cap",
        summary: "A member reached the daily ring-beacon cap; further beacons are dropped",
        detail: `company ${companyId}: ${recent} beacons in 24h (cap ${RING_BEACON_DAILY_CAP})`,
        action:
          "Look for a client stuck in a loop on that workspace. Rings are unaffected; only the evidence is.",
      });
    }
    return c.json({ recorded: false }, 202);
  }
  if (recent >= RING_BEACON_WARN_AT && capAlertDue(`warn:${member}`, nowMs)) {
    await opsAlert(env, {
      key: "ring-beacons-member-cap-warning",
      summary: "A member is at 80% of the daily ring-beacon cap",
      detail: `company ${companyId}: ${recent} beacons in 24h (cap ${RING_BEACON_DAILY_CAP})`,
    });
  }

  const { error } = await db.from("ring_beacons").insert({
    company_id: companyId,
    user_id: userId,
    auth_session_id: c.get("sessionId") ?? null,
    call_session_id: body.call_session_id,
    platform,
    stage: body.stage,
    occurred_at: believableTimestamp(body.occurred_at, nowMs),
    app_version: requestAppVersion(c),
    os: body.os ?? null,
    permissions: knownPermissions(body.permissions),
    standby_bucket: body.standby_bucket ?? null,
    power_save: body.power_save ?? null,
    device_idle: body.device_idle ?? null,
    screen_locked: body.screen_locked ?? null,
  });
  if (error) throw new Error(`ring beacon insert failed: ${error.message}`);

  return c.json({ recorded: true }, 202);
});
