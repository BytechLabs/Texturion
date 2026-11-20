import { EDGE_PATHS } from '@loonext/rig-protocol';
import type { StandingRole } from '@loonext/rig-protocol';

import raw from "../../telnyx-spec.json";

/**
 * The edge paths a Telnyx resource may send its webhooks to, by their
 * EDGE_PATHS name. A name the protocol drops fails the typecheck here.
 */
export const WEBHOOK_PATHS = [
  "telnyxVoice",
  "telnyxVoiceFailover",
  "telnyxWebrtc",
  "telnyxMessaging",
  "telnyxRobot",
] as const satisfies readonly (keyof typeof EDGE_PATHS)[];

export type WebhookPath = (typeof WEBHOOK_PATHS)[number];

/**
 * A webhook URL on the edge. The spec names the path rather than spelling
 * it, so a path changed in the protocol changes here too. The JSON is not
 * typechecked, so a name outside {@link WEBHOOK_PATHS} throws before setup
 * writes anything with it.
 */
export function edgeUrl(edgeOrigin: string, path: WebhookPath): string {
  if (!(WEBHOOK_PATHS as readonly string[]).includes(path)) throw new Error(`setup: ${path} is not an edge webhook path`);
  return `${edgeOrigin}${EDGE_PATHS[path]}`;
}

/** tools/guard/telnyx-spec.json: the partition by name, never by id (docs/RIG.md). */
export interface TelnyxSpec {
  billing_group: { name: string };
  outbound_voice_profiles: {
    key: "voice" | "robot";
    name: string;
    whitelisted_destinations: string[];
  }[];
  call_control_applications: {
    key: "voice" | "robot";
    application_name: string;
    webhook: WebhookPath;
    failover?: WebhookPath;
    webhook_timeout_secs: number;
    outbound_voice_profile: "voice" | "robot";
    /** Telnyx's call.cost webhook, so the rig measures what each call cost. */
    call_cost_in_webhooks: boolean;
  }[];
  credential_connections: {
    key: "webrtc" | "sentinel";
    connection_name: string;
    webhook: WebhookPath;
    sip_uri_calling_preference: "internal";
  }[];
  messaging_profiles: {
    whitelisted_destinations: string[];
    profiles: { key: string; name: string; webhook: WebhookPath }[];
  };
  numbers: {
    country: string;
    area_codes: string[];
    standing: {
      role: StandingRole;
      connection: "voice" | "robot";
      messaging_profile: string;
      caller_name_lookup?: boolean;
      /** The rig lanes the number serves. Every role is ordered whatever its lanes. */
      lanes: ("texts" | "calls")[];
    }[];
  };
  notifications: { profile_name: string; event_conditions: string[] };
}

export const SPEC = raw as TelnyxSpec;

/** Every name the partition's resources carry: what "nonprod" means when listing. */
export function nonprodNames(spec: TelnyxSpec = SPEC): {
  ovp: Set<string>;
  apps: Set<string>;
  credentialConnections: Set<string>;
  messagingProfiles: Set<string>;
} {
  return {
    ovp: new Set(spec.outbound_voice_profiles.map((item) => item.name)),
    apps: new Set(spec.call_control_applications.map((item) => item.application_name)),
    credentialConnections: new Set(spec.credential_connections.map((item) => item.connection_name)),
    messagingProfiles: new Set(spec.messaging_profiles.profiles.map((item) => item.name)),
  };
}
