/**
 * Public OAuth callbacks and provider webhook receivers for #245.
 *
 * These routes intentionally live outside `/v1`: an OAuth provider and a
 * calendar webhook have no Loonext session. OAuth is authenticated by a
 * one-use, hashed state plus PKCE; notifications are authenticated by the
 * random client-state/channel token stored only as a hash.
 */
import { Hono } from "hono";

import {
  calendarCallbackUri,
  getCalendarProviderConfiguration,
} from "../calendar/config";
import {
  openCalendarCredential,
  sealCalendarCredential,
  type SealedCalendarCredential,
} from "../calendar/crypto";
import {
  exchangeGoogleAuthorizationCode,
  GoogleCalendarProvider,
} from "../calendar/providers/google";
import {
  exchangeMicrosoftAuthorizationCode,
  MicrosoftCalendarProvider,
} from "../calendar/providers/microsoft";
import type {
  CalendarOAuthTokens,
  CalendarProvider,
  CalendarProviderName,
} from "../calendar/providers/types";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { generateToken, hashToken } from "../public-links/tokens";
import { unwrap } from "./core/http";

export const calendarPublicRoutes = new Hono<AppEnv>();

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const SUBSCRIPTION_ID_SHAPE = /^.{1,1000}$/s;
const GOOGLE_RESOURCE_ID_SHAPE = /^.{1,2000}$/s;
const GOOGLE_MESSAGE_NUMBER_SHAPE = /^\d{1,40}$/;
const PROVIDER_TIMEOUT_MS = 10_000;
const MICROSOFT_WEBHOOK_MAX_BYTES = 128 * 1024;
const MICROSOFT_WEBHOOK_RPC_CONCURRENCY = 8;

interface OauthStateRow {
  company_id: string;
  user_id: string;
  provider: CalendarProviderName;
  verifier_ciphertext: string;
  verifier_iv: string;
  verifier_key_version: string;
  redirect_uri: string;
}

interface ConsumeStateResult {
  outcome: "consumed" | "invalid";
  state?: OauthStateRow;
}

interface DefaultCalendar {
  providerAccountId: string;
  providerAccountLabel: string;
  calendarId: string;
  calendarName: string;
  timeZone: string;
}

interface GoogleCalendarMetadata {
  id?: string;
  summary?: string;
  timeZone?: string;
}

interface MicrosoftCalendarMetadata {
  id?: string;
  name?: string;
  owner?: { name?: string; address?: string };
}

function providerFromPath(raw: string): CalendarProviderName | null {
  return raw === "google" || raw === "microsoft" ? raw : null;
}

function settingsRedirect(
  env: Env,
  outcome:
    | "connected"
    | "failed"
    | "replacement_requires_disconnect"
    | "disconnect_in_progress",
): string {
  return `${env.APP_ORIGIN}/settings/profile?calendar=${outcome}`;
}

async function providerMetadata<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("calendar provider metadata request failed");
  return (await response.json()) as T;
}

async function companyTimeZone(
  env: Env,
  companyId: string,
): Promise<string> {
  const rows = unwrap<{ timezone: string }[]>(
    await getDb(env)
      .from("companies")
      .select("timezone")
      .eq("id", companyId)
      .limit(1),
    "calendar company timezone",
  );
  const zone = rows[0]?.timezone?.trim();
  if (!zone) throw new Error("calendar company timezone is unavailable");
  return zone;
}

async function defaultCalendar(
  provider: CalendarProviderName,
  accessToken: string,
  fallbackTimeZone: string,
): Promise<DefaultCalendar> {
  if (provider === "google") {
    const calendar = await providerMetadata<GoogleCalendarMetadata>(
      "https://www.googleapis.com/calendar/v3/calendars/primary",
      accessToken,
    );
    if (!calendar.id?.trim()) {
      throw new Error("Google primary calendar did not include an id");
    }
    return {
      providerAccountId: calendar.id,
      providerAccountLabel: calendar.id,
      // `primary` follows the account's default calendar if Google rotates its
      // opaque id. The real id is retained above as the account identity.
      calendarId: "primary",
      calendarName: calendar.summary?.trim() || calendar.id,
      timeZone: calendar.timeZone?.trim() || fallbackTimeZone,
    };
  }

  const calendar = await providerMetadata<MicrosoftCalendarMetadata>(
    "https://graph.microsoft.com/v1.0/me/calendar?$select=id,name,owner",
    accessToken,
  );
  if (!calendar.id?.trim() || !calendar.name?.trim()) {
    throw new Error("Microsoft default calendar did not include an id and name");
  }
  const accountId = calendar.owner?.address?.trim() || calendar.id;
  return {
    providerAccountId: accountId,
    providerAccountLabel:
      calendar.owner?.name?.trim() || calendar.owner?.address?.trim() || calendar.name,
    calendarId: calendar.id,
    calendarName: calendar.name,
    // Graph's default-calendar resource does not return an IANA zone. The
    // workspace zone is the phase-one wall-clock contract.
    timeZone: fallbackTimeZone,
  };
}

async function exchangeCode(
  provider: CalendarProviderName,
  code: string,
  verifier: string,
  env: Env,
): Promise<CalendarOAuthTokens> {
  const configuration = getCalendarProviderConfiguration(env, provider);
  return provider === "google"
    ? exchangeGoogleAuthorizationCode(fetch, configuration.oauth, code, verifier)
    : exchangeMicrosoftAuthorizationCode(
        fetch,
        configuration.oauth,
        code,
        verifier,
        configuration.tenant,
      );
}

interface ProvisionalWebhook {
  client: CalendarProvider;
  clientStateHash: string;
  expiresAt: string;
  watch: Awaited<ReturnType<CalendarProvider["startWatch"]>>;
}

async function startProvisionalWebhook(input: {
  env: Env;
  provider: CalendarProviderName;
  accessToken: string;
  calendarId: string;
}): Promise<ProvisionalWebhook> {
  const providerClient: CalendarProvider = input.provider === "google"
    ? new GoogleCalendarProvider(fetch)
    : new MicrosoftCalendarProvider(fetch);
  const clientState = generateToken();
  const requestedExpiration = new Date(
    Date.now() + (input.provider === "google" ? 6 : 2) * 86_400_000,
  ).toISOString();
  const watch = await providerClient.startWatch({
    accessToken: input.accessToken,
    calendarId: input.calendarId,
    callbackUrl: `${input.env.API_ORIGIN}/calendar/webhooks/${input.provider}`,
    // Google uses this as the channel id. Graph assigns its own id, but the
    // provider-neutral interface still carries an idempotency identifier.
    subscriptionId: crypto.randomUUID(),
    clientState,
    expiration: requestedExpiration,
  });
  return {
    client: providerClient,
    clientStateHash: await hashToken(clientState),
    expiresAt: watch.expiration ?? requestedExpiration,
    watch,
  };
}

async function stopProvisionalWebhook(input: {
  accessToken: string;
  provider: CalendarProviderName;
  provisional: ProvisionalWebhook;
}): Promise<void> {
  // Google requires the resource id to stop a channel. If its malformed
  // success response omitted that id, there is no usable stop operation; the
  // unstored client-state still makes every delivery unauthenticated here.
  if (input.provider === "google" && !input.provisional.watch.resourceId) return;
  await input.provisional.client.stopWatch({
    accessToken: input.accessToken,
    subscriptionId: input.provisional.watch.subscriptionId,
    resourceId: input.provisional.watch.resourceId ?? undefined,
  });
}

calendarPublicRoutes.get("/calendar/oauth/:provider/callback", async (c) => {
  const env = getEnv(c.env);
  const provider = providerFromPath(c.req.param("provider"));
  const failed = () => c.redirect(settingsRedirect(env, "failed"), 303);
  if (!provider) return failed();

  const stateToken = c.req.query("state");
  if (!stateToken || !TOKEN_SHAPE.test(stateToken)) return failed();

  let provisional: ProvisionalWebhook | null = null;
  let provisionalAccessToken: string | null = null;
  let completionAttempted = false;
  try {
    const db = getDb(env);
    // Consumption happens before checking provider/code. A callback delivered
    // on the wrong provider path, or one where consent was denied, still burns
    // the state and cannot be replayed onto a second callback.
    const consumed = unwrap<ConsumeStateResult>(
      await db.rpc("api_consume_calendar_oauth_state", {
        p_state_hash: await hashToken(stateToken),
      }),
      "calendar OAuth state consume",
    );
    const state = consumed.outcome === "consumed" ? consumed.state : undefined;
    if (
      !state ||
      state.provider !== provider ||
      state.redirect_uri !== calendarCallbackUri(env, provider)
    ) {
      return failed();
    }

    const code = c.req.query("code");
    if (!code || code.length > 4096 || c.req.query("error")) return failed();

    const configuration = getCalendarProviderConfiguration(env, provider);
    const sealedVerifier: SealedCalendarCredential = {
      ciphertext: state.verifier_ciphertext,
      iv: state.verifier_iv,
      keyVersion: state.verifier_key_version,
    };
    const verifier = await openCalendarCredential(
      sealedVerifier,
      {
        companyId: state.company_id,
        userId: state.user_id,
        provider,
        purpose: "oauth_pkce_verifier",
      },
      configuration.keyring,
    );
    const tokens = await exchangeCode(provider, code, verifier, env);
    // A short-lived access token alone cannot power durable sync. Google may
    // omit refresh_token if prompt=consent is removed; treating that as a
    // successful connection would create a time-bomb that dies in an hour.
    if (!tokens.refreshToken) return failed();

    const zone = await companyTimeZone(env, state.company_id);
    const calendar = await defaultCalendar(provider, tokens.accessToken, zone);
    const sealedRefreshToken = await sealCalendarCredential(
      tokens.refreshToken,
      {
        companyId: state.company_id,
        userId: state.user_id,
        provider,
        purpose: "refresh_token",
      },
      configuration.keyring,
    );

    // Establish the remote capability before replacing the currently working
    // connection. The one database RPC below then installs the watch and new
    // credential atomically; a failed provider call or transaction leaves the
    // old connection, its ICS fallback, and its outbox untouched.
    provisional = await startProvisionalWebhook({
      env,
      provider,
      accessToken: tokens.accessToken,
      calendarId: calendar.calendarId,
    });
    provisionalAccessToken = tokens.accessToken;

    completionAttempted = true;
    const completed = unwrap<{ outcome: string; connection_id?: string }>(
      await db.rpc("api_complete_calendar_connection", {
        p_company_id: state.company_id,
        p_user_id: state.user_id,
        p_provider: provider,
        p_provider_account_id: calendar.providerAccountId,
        p_provider_account_label: calendar.providerAccountLabel,
        p_selected_calendar_id: calendar.calendarId,
        p_selected_calendar_name: calendar.calendarName,
        p_selected_calendar_timezone: calendar.timeZone,
        p_credential_ciphertext: sealedRefreshToken.ciphertext,
        p_credential_iv: sealedRefreshToken.iv,
        p_credential_key_version: sealedRefreshToken.keyVersion,
        p_provider_subscription_id: provisional.watch.subscriptionId,
        p_provider_resource_id: provisional.watch.resourceId,
        // The provider received the plaintext once. Postgres receives only
        // the digest used to authenticate later notifications.
        p_client_state_hash: provisional.clientStateHash,
        p_webhook_expires_at: provisional.expiresAt,
        p_sync_cursor: null,
      }),
      "calendar connection complete",
    );
    if (
      completed.outcome === "replacement_requires_disconnect" ||
      completed.outcome === "disconnect_in_progress"
    ) {
      try {
        await stopProvisionalWebhook({
          accessToken: provisionalAccessToken,
          provider,
          provisional,
        });
      } catch {
        // The rejected watch has no matching digest in Postgres and expires
        // independently if provider cleanup is unavailable.
      }
      provisional = null;
      provisionalAccessToken = null;
      return c.redirect(
        settingsRedirect(env, completed.outcome),
        303,
      );
    }
    if (completed.outcome !== "connected" || !completed.connection_id) {
      try {
        await stopProvisionalWebhook({
          accessToken: provisionalAccessToken,
          provider,
          provisional,
        });
      } catch {
        // No committed digest authenticates this rejected watch.
      }
      provisional = null;
      provisionalAccessToken = null;
      return failed();
    }
    // The atomic transaction now owns the watch. From this point onward its
    // renewal/revocation belongs to the durable worker, not callback cleanup.
    provisional = null;
    provisionalAccessToken = null;
    return c.redirect(settingsRedirect(env, "connected"), 303);
  } catch (error) {
    if (provisional && provisionalAccessToken && !completionAttempted) {
      try {
        await stopProvisionalWebhook({
          accessToken: provisionalAccessToken,
          provider,
          provisional,
        });
      } catch {
        // No matching client-state digest was committed, so notifications are
        // rejected even if the provider's best-effort stop fails.
        console.error("calendar OAuth provisional webhook cleanup failed", {
          provider,
        });
      }
    }
    // Never log the callback URL, query, state, verifier, authorization code,
    // access token, refresh token, ciphertext, or provider response. The class
    // name is enough to group operational failures without creating a second
    // credential store in logs.
    console.error("calendar OAuth callback failed", {
      provider,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return failed();
  }
});

interface CalendarPullRequest {
  provider: CalendarProviderName;
  subscriptionId: string;
  resourceId: string | null;
  clientState: string;
}

async function requestPull(
  env: Env,
  request: CalendarPullRequest,
): Promise<boolean> {
  const result = unwrap<{ outcome: string }>(
    await getDb(env).rpc("api_request_calendar_pull", {
      p_provider: request.provider,
      p_subscription_id: request.subscriptionId,
      p_resource_id: request.resourceId,
      p_client_state_hash: await hashToken(request.clientState),
    }),
    "calendar webhook enqueue",
  );
  return result.outcome === "queued";
}

calendarPublicRoutes.post("/calendar/webhooks/google", async (c) => {
  const subscriptionId = c.req.header("X-Goog-Channel-ID") ?? "";
  const resourceId = c.req.header("X-Goog-Resource-ID") ?? "";
  const clientState = c.req.header("X-Goog-Channel-Token") ?? "";
  const resourceState = c.req.header("X-Goog-Resource-State") ?? "";
  const messageNumber = c.req.header("X-Goog-Message-Number") ?? "";
  if (
    !SUBSCRIPTION_ID_SHAPE.test(subscriptionId) ||
    !GOOGLE_RESOURCE_ID_SHAPE.test(resourceId) ||
    !TOKEN_SHAPE.test(clientState) ||
    !["sync", "exists", "not_exists"].includes(resourceState) ||
    !GOOGLE_MESSAGE_NUMBER_SHAPE.test(messageNumber)
  ) {
    return c.text("Not found", 404);
  }

  const accepted = await requestPull(getEnv(c.env), {
    provider: "google",
    subscriptionId,
    resourceId,
    clientState,
  });
  return accepted ? c.body(null, 204) : c.text("Not found", 404);
});

interface MicrosoftNotification {
  subscriptionId?: unknown;
  clientState?: unknown;
  resource?: unknown;
}

/**
 * Graph may deliver the webhook with chunked transfer encoding, so checking
 * Content-Length alone would still let an unauthenticated caller make the
 * worker buffer an arbitrary body. Read the stream under the same hard cap in
 * both the declared-length and chunked cases.
 */
async function boundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown | null> {
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maxBytes)
  ) {
    return null;
  }

  const stream = request.body;
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function requestPullsBounded(
  env: Env,
  requests: readonly CalendarPullRequest[],
): Promise<boolean> {
  let next = 0;
  let accepted = true;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= requests.length) return;
      if (!(await requestPull(env, requests[index]))) accepted = false;
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          MICROSOFT_WEBHOOK_RPC_CONCURRENCY,
          requests.length,
        ),
      },
      worker,
    ),
  );
  return accepted;
}

calendarPublicRoutes.post("/calendar/webhooks/microsoft", async (c) => {
  const validationToken = c.req.query("validationToken");
  if (validationToken !== undefined) {
    // Graph requires the decoded query value echoed byte-for-byte in the body.
    // It is not HTML and no wrapper/object/newline may be added.
    if (validationToken.length === 0 || validationToken.length > 1024) {
      return c.text("Not found", 404);
    }
    return c.body(validationToken, 200, { "Content-Type": "text/plain" });
  }

  const payload = await boundedJsonBody(
    c.req.raw,
    MICROSOFT_WEBHOOK_MAX_BYTES,
  );
  if (payload === null) return c.text("Not found", 404);
  const value = (payload as { value?: unknown } | null)?.value;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return c.text("Not found", 404);
  }

  const requests = new Map<string, CalendarPullRequest>();
  for (const raw of value as MicrosoftNotification[]) {
    const subscriptionId = raw?.subscriptionId;
    const clientState = raw?.clientState;
    const resource = raw?.resource;
    if (
      typeof subscriptionId !== "string" ||
      !SUBSCRIPTION_ID_SHAPE.test(subscriptionId) ||
      typeof clientState !== "string" ||
      !TOKEN_SHAPE.test(clientState) ||
      (resource !== undefined &&
        (typeof resource !== "string" || !GOOGLE_RESOURCE_ID_SHAPE.test(resource)))
    ) {
      return c.text("Not found", 404);
    }
    // Graph can batch duplicate notices for the same subscription. One RPC is
    // enough to coalesce a durable pull, and deduplication keeps the response
    // comfortably inside Graph's ten-second delivery deadline.
    requests.set(`${subscriptionId}\0${clientState}`, {
      provider: "microsoft",
      subscriptionId,
      resourceId: typeof resource === "string" ? resource : null,
      clientState,
    });
  }

  // The RPC only coalesces a durable pull; no provider event is fetched while
  // Graph waits for this response. Duplicate notifications merely increment a
  // generation and remain one claimable connection.
  const env = getEnv(c.env);
  const accepted = await requestPullsBounded(env, [...requests.values()]);
  return accepted
    ? c.body(null, 202)
    : c.text("Not found", 404);
});
