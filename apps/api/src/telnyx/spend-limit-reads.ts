import type { Env } from "../env";
import { TelnyxApiError, telnyxRequest } from "./client";
import type { ReportedSpendLimit } from "./spend-limits";

const PAGE_SIZE = 250;
/** 5,000 profiles, far beyond today's fleet. */
const MAX_PROFILE_PAGES = 20;

/**
 * Read-only views of the Telnyx resources that carry production's daily spend
 * limits (#642). Every request here is a GET.
 */

export interface ProfileReading {
  id: string;
  /** Null when Telnyx no longer has the profile. */
  limit: ReportedSpendLimit | null;
}

interface ConnectionOutbound {
  data?: { outbound?: { outbound_voice_profile_id?: string | null } | null };
}

async function connectionProfileId(
  env: Env,
  kind: "call_control_application" | "credential_connection",
  id: string,
): Promise<string | null> {
  try {
    const body =
      kind === "call_control_application"
        ? await telnyxRequest<ConnectionOutbound>(env, {
            method: "GET",
            path: `/v2/call_control_applications/${id}`,
          })
        : await telnyxRequest<ConnectionOutbound>(env, {
            method: "GET",
            path: `/v2/credential_connections/${id}`,
          });
    const profileId = body?.data?.outbound?.outbound_voice_profile_id;
    return typeof profileId === "string" && profileId.length > 0 ? profileId : null;
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status === 404) return null;
    throw cause;
  }
}

/**
 * The outbound voice profiles production's own connections dial through: the
 * Call Control application and, when configured, the WebRTC credential
 * connection. Read from the connections rather than configured, so the check
 * follows the profile the portal actually has them on. The rig's profiles hang
 * off its own connections and never appear here.
 */
export async function productionVoiceProfileIds(env: Env): Promise<string[]> {
  const ids = new Set<string>();
  const app = await connectionProfileId(
    env,
    "call_control_application",
    env.TELNYX_VOICE_CONNECTION_ID,
  );
  if (app !== null) ids.add(app);
  if (env.TELNYX_WEBRTC_CONNECTION_ID !== undefined) {
    const webrtc = await connectionProfileId(
      env,
      "credential_connection",
      env.TELNYX_WEBRTC_CONNECTION_ID,
    );
    if (webrtc !== null) ids.add(webrtc);
  }
  return [...ids].sort();
}

function limitOf(body: { data?: ReportedSpendLimit } | undefined): ReportedSpendLimit | null {
  return body?.data ?? null;
}

export async function readVoiceProfile(env: Env, id: string): Promise<ProfileReading> {
  try {
    const body = await telnyxRequest<{ data?: ReportedSpendLimit }>(env, {
      method: "GET",
      path: `/v2/outbound_voice_profiles/${id}`,
    });
    return { id, limit: limitOf(body) };
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status === 404) return { id, limit: null };
    throw cause;
  }
}

export interface MessagingProfileItem extends ReportedSpendLimit {
  id?: string;
}

interface PageMeta {
  page_number?: number;
  total_pages?: number;
}

/**
 * Telnyx's view of every messaging profile in the account, up to the page cap.
 * A profile past the cap reads as unlisted, which the gauge reports as having
 * no limit: the safe direction to be wrong in.
 */
export async function listMessagingProfiles(
  env: Env,
): Promise<Map<string, MessagingProfileItem>> {
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
      return profiles;
    }
  }
  return profiles;
}

