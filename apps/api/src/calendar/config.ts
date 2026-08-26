import type { Env } from "../env";
import type { CalendarEncryptionKeyring } from "./crypto";
import type {
  CalendarOAuthClient,
  CalendarProviderName,
} from "./providers/types";

export interface CalendarProviderConfiguration {
  oauth: CalendarOAuthClient;
  /** Microsoft only; ignored by Google. */
  tenant?: string;
  keyring: CalendarEncryptionKeyring;
}

export class CalendarConnectorNotConfiguredError extends Error {
  constructor(readonly provider: CalendarProviderName) {
    super(`${provider} calendar connector is not configured`);
    this.name = "CalendarConnectorNotConfiguredError";
  }
}

function parseKeyring(env: Env): CalendarEncryptionKeyring | null {
  const encoded = env.CALENDAR_TOKEN_ENCRYPTION_KEYS;
  const activeVersion = env.CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY;
  if (!encoded || !activeVersion) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEYS must be a JSON object");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEYS must be a JSON object");
  }
  const keys: Record<string, string> = {};
  for (const [version, value] of Object.entries(parsed)) {
    if (!version.trim() || typeof value !== "string") {
      throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEYS has an invalid entry");
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      throw new Error(
        `calendar encryption key ${version} must be base64url for 32 bytes`,
      );
    }
    keys[version] = value;
  }
  if (!keys[activeVersion]) {
    throw new Error(
      "CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY is absent from the keyring",
    );
  }
  return { activeVersion, keys };
}

function credentials(
  env: Env,
  provider: CalendarProviderName,
): { clientId: string; clientSecret: string } | null {
  const clientId =
    provider === "google"
      ? env.GOOGLE_CALENDAR_CLIENT_ID
      : env.MICROSOFT_CALENDAR_CLIENT_ID;
  const clientSecret =
    provider === "google"
      ? env.GOOGLE_CALENDAR_CLIENT_SECRET
      : env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function calendarCallbackUri(
  env: Env,
  provider: CalendarProviderName,
): string {
  return `${env.API_ORIGIN}/calendar/oauth/${provider}/callback`;
}

export function calendarProviderIsConfigured(
  env: Env,
  provider: CalendarProviderName,
): boolean {
  return credentials(env, provider) !== null && parseKeyring(env) !== null;
}

export function getCalendarProviderConfiguration(
  env: Env,
  provider: CalendarProviderName,
): CalendarProviderConfiguration {
  const pair = credentials(env, provider);
  const keyring = parseKeyring(env);
  if (!pair || !keyring) throw new CalendarConnectorNotConfiguredError(provider);
  return {
    oauth: {
      ...pair,
      redirectUri: calendarCallbackUri(env, provider),
    },
    ...(provider === "microsoft"
      ? { tenant: env.MICROSOFT_CALENDAR_TENANT ?? "common" }
      : {}),
    keyring,
  };
}
