import raw from "../../telnyx-spec.json";
import type { StandingRole } from "../edge-contract";

/** tools/guard/telnyx-spec.json: the partition by name, never by id (docs/RIG.md). */
export interface TelnyxSpec {
  billing_group: { name: string };
  outbound_voice_profiles: {
    key: "voice" | "robot";
    name: string;
    daily_spend_limit: string;
    max_destination_rate: number;
    whitelisted_destinations: string[];
    /** A number, or "room-minus-robot": the room left for the voice app. */
    concurrent_call_limit: number | "room-minus-robot";
    calls_per_cld: number;
  }[];
  call_control_applications: {
    key: "voice" | "robot";
    application_name: string;
    webhook_path: string;
    failover_path?: string;
    webhook_timeout_secs: number;
    outbound_voice_profile: "voice" | "robot";
    /** A number, or "room": the room itself. */
    channel_limit: number | "room";
  }[];
  credential_connections: {
    key: "webrtc" | "sentinel";
    connection_name: string;
    webhook_path: string;
    sip_uri_calling_preference: "internal";
    max_credentials: number | null;
  }[];
  messaging_profiles: {
    max_profiles: number;
    max_daily_spend_limit: string;
    whitelisted_destinations: string[];
    webhook_path: string;
    profiles: { key: string; name: string; daily_spend_limit: string }[];
  };
  numbers: {
    country: string;
    area_codes: string[];
    standing: {
      role: StandingRole;
      connection: "voice" | "robot";
      messaging_profile: string;
      caller_name_lookup?: boolean;
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

export function callerNameNumbers(spec: TelnyxSpec = SPEC): number {
  return spec.numbers.standing.filter((item) => item.caller_name_lookup).length;
}

/** The sentinel's credential cap; the webrtc connection has none. */
export function sentinelCredentialCap(spec: TelnyxSpec = SPEC): number {
  return spec.credential_connections.find((item) => item.key === "sentinel")?.max_credentials ?? 1;
}
