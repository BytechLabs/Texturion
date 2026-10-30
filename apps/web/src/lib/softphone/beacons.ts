/**
 * Ring beacons from the browser softphone (D142): whether this tab showed,
 * answered or declined a ring. One POST per stage carries the session id, the
 * stage word and two permission states, never the caller, the number or
 * anything else from the call.
 *
 * Fire and forget: nothing on the ring path awaits a beacon, every failure is
 * swallowed, and a beacon with no session id is not sent.
 *
 * Its own fetch rather than `apiFetch`, which records every non-2xx in the
 * recent-errors ring the support sheet shares; an undeliverable beacon (an
 * older API without the route) would fill it on every call.
 */
import { publicEnv } from "@/env";
import { getAccessToken } from "@/lib/supabase/browser";

/**
 * The server's vocabulary, all of it, even the stages only a phone reaches —
 * apps/api/src/routes/ring-beacons.test.ts compares this list with the
 * server's and the phones' in both directions.
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

export type PermissionState = "granted" | "denied" | "prompt" | "unknown";

export interface WebDeviceState {
  os: string;
  permissions: { notifications: PermissionState; microphone: PermissionState };
}

interface NavigatorWithUaData {
  userAgentData?: { platform?: string };
  permissions?: { query: (descriptor: { name: string }) => Promise<{ state: string }> };
}

/** "web" plus the coarse platform Chromium volunteers; no user agent string. */
export function webOs(nav: NavigatorWithUaData | undefined): string {
  const platform = nav?.userAgentData?.platform?.trim().toLowerCase();
  if (!platform) return "web";
  return `web-${platform.replace(/[^a-z0-9._-]+/g, "-")}`.slice(0, 40);
}

function notificationPermission(): PermissionState {
  if (typeof Notification === "undefined") return "unknown";
  switch (Notification.permission) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "default":
      return "prompt";
    default:
      return "unknown";
  }
}

async function microphonePermission(
  nav: NavigatorWithUaData | undefined,
): Promise<PermissionState> {
  try {
    // Firefox rejects "microphone" as a permission name outright.
    const status = await nav?.permissions?.query({ name: "microphone" });
    const state = status?.state;
    return state === "granted" || state === "denied" || state === "prompt"
      ? state
      : "unknown";
  } catch {
    return "unknown";
  }
}

export async function collectWebDeviceState(): Promise<WebDeviceState> {
  const nav =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as unknown as NavigatorWithUaData);
  return {
    os: webOs(nav),
    permissions: {
      notifications: notificationPermission(),
      microphone: await microphonePermission(nav),
    },
  };
}

export interface RingBeaconSenderConfig {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  appVersion?: string;
  fetch?: typeof fetch;
  deviceState?: () => Promise<WebDeviceState>;
  now?: () => Date;
}

/**
 * The sender resolves when the attempt is over and never rejects, so a test
 * can await it and a caller can drop it with `void`.
 */
export function createRingBeaconSender(config: RingBeaconSenderConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  return async function send(
    companyId: string | null | undefined,
    stage: RingBeaconStage,
    sessionId: string | null | undefined,
  ): Promise<void> {
    if (!companyId || !sessionId) return;
    // Stamped before any await, so the time is the stage's and not the send's.
    const occurredAt = (config.now?.() ?? new Date()).toISOString();
    try {
      const token = await config.getAccessToken();
      if (!token) return;
      const device = await (config.deviceState ?? collectWebDeviceState)();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "X-Client": "web",
        "X-Company-Id": companyId,
        "Content-Type": "application/json",
      };
      if (config.appVersion) headers["X-App-Version"] = config.appVersion;
      await (config.fetch ?? fetch)(`${baseUrl}/v1/ring-beacons`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          call_session_id: sessionId,
          stage,
          occurred_at: occurredAt,
          os: device.os,
          permissions: device.permissions,
        }),
      });
    } catch {
      // Evidence about a ring must never become a failure of one.
    }
  };
}

let defaultSender: ReturnType<typeof createRingBeaconSender> | null = null;

/** The app's sender, built on first use so importing this costs nothing. */
export function emitRingBeacon(
  companyId: string | null | undefined,
  stage: RingBeaconStage,
  sessionId: string | null | undefined,
): Promise<void> {
  defaultSender ??= createRingBeaconSender({
    baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
    getAccessToken,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
  });
  return defaultSender(companyId, stage, sessionId);
}
