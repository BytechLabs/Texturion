import {
  calendarProviderSignal,
  providerJson,
  providerVoid,
} from "./http";
import {
  appendUnlinkNote,
  calendarTitleRefusalReason,
  hashCalendarDescription,
  instantFromRfc3339OrWallClock,
  isIanaTimeZone,
  normalizeCalendarText,
} from "./normalize";
import {
  type AnnotateCalendarEventInput,
  type CalendarChangePage,
  type CalendarChangeNotice,
  type CalendarFetch,
  type CalendarOAuthClient,
  type CalendarOAuthTokens,
  type CalendarProvider,
  CalendarProviderError,
  type CalendarRemoteEvent,
  CalendarReauthRequiredError,
  type CalendarWatch,
  type CreateCalendarEventInput,
  type DeleteCalendarEventInput,
  type GetCalendarEventInput,
  InvalidCalendarEventError,
  type ListCalendarChangesInput,
  type PatchCalendarEventInput,
  type RenewCalendarWatchInput,
  type ScrubCalendarEventInput,
  type StartCalendarWatchInput,
  type StopCalendarWatchInput,
  type WriteCalendarEventInput,
} from "./types";

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const SCRUBBED_EVENT_TITLE = "Loonext event removed";

export const GOOGLE_CALENDAR_SCOPES = [
  // The product only selects `primary`; it never needs to write delegated or
  // shared calendars. Keep event access to calendars the member owns.
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.calendars.readonly",
] as const;

interface GoogleDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDateTime;
  attendees?: unknown[];
  conferenceData?: unknown;
  hangoutLink?: string;
  organizer?: { email?: string; self?: boolean };
  htmlLink?: string;
}

interface GoogleEventPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  timeZone?: string;
}

interface GoogleWatchResponse {
  id: string;
  resourceId?: string;
  expiration?: string;
}

export interface GoogleAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}

function googleUrl(path: string): string {
  return `${GOOGLE_API}${path}`;
}

function bearer(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function sameEmail(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function expirationFromMilliseconds(value: string | undefined): string | null {
  if (!value) return null;
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function assertVersion(version: string, operation: string): void {
  if (!version.trim()) {
    throw new InvalidCalendarEventError(
      "google",
      operation,
      "Google conditional writes require a stored etag",
    );
  }
}

function writeBody(input: WriteCalendarEventInput): Record<string, unknown> {
  return {
    summary: normalizeCalendarText(input.schedule.title),
    description: normalizeCalendarText(input.description),
    start: {
      dateTime: input.schedule.start,
      timeZone: input.schedule.timeZone,
    },
    end: {
      dateTime: input.schedule.end,
      timeZone: input.schedule.timeZone,
    },
  };
}

function patchBody(input: PatchCalendarEventInput): Record<string, unknown> {
  const changes = input.changes ?? {
    timing: true,
    title: true,
    description: true,
  };
  return {
    ...(changes.title
      ? { summary: normalizeCalendarText(input.schedule.title) }
      : {}),
    ...(changes.description
      ? { description: normalizeCalendarText(input.description) }
      : {}),
    ...(changes.timing
      ? {
          start: {
            dateTime: input.schedule.start,
            timeZone: input.schedule.timeZone,
          },
          end: {
            dateTime: input.schedule.end,
            timeZone: input.schedule.timeZone,
          },
        }
      : {}),
  };
}

/**
 * Google accepts a caller-supplied event id, but only in lower-case base32hex.
 * A SHA-256 hex digest is inside that alphabet and makes the durable outbox id
 * safe without weakening its stability or leaking internal identifiers.
 */
async function googleEventId(idempotencyKey: string): Promise<string> {
  const identity = idempotencyKey.trim();
  if (!identity) {
    throw new InvalidCalendarEventError(
      "google",
      "create event",
      "Google event create requires a stable idempotency key",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function assertDescriptionMatches(
  input: WriteCalendarEventInput,
  operation: string,
): Promise<void> {
  if ((await hashCalendarDescription(input.description)) !== input.schedule.descriptionHash) {
    throw new InvalidCalendarEventError(
      "google",
      operation,
      "Google write description does not match the scheduling snapshot hash",
    );
  }
}

/** A recurring master is never returned; expanded occurrences keep their id. */
export async function normalizeGoogleEvent(
  event: GoogleEvent,
  calendarTimeZone: string | undefined,
  connectedAccountEmail?: string,
): Promise<CalendarRemoteEvent | null> {
  const instanceId = typeof event.id === "string" ? event.id.trim() : "";
  if (!instanceId) {
    throw new InvalidCalendarEventError(
      "google",
      "normalize event",
      "Google event is missing its instance id",
    );
  }
  const recurrenceRefused =
    Boolean(event.recurrence?.length && !event.recurringEventId) ||
    Boolean(event.recurringEventId && !event.originalStartTime);

  const description = normalizeCalendarText(event.description);
  const organizerEmail = event.organizer?.email?.trim() || null;
  const common = {
    instanceId,
    version: event.etag ?? null,
    description,
    descriptionFormat: "text" as const,
    hasAttendees: Boolean(event.attendees?.length),
    hasOnlineMeeting: Boolean(event.conferenceData || event.hangoutLink),
    organizerEmail,
    organizerIsConnectedAccount:
      event.organizer?.self === true ||
      sameEmail(organizerEmail ?? undefined, connectedAccountEmail),
    webUrl: event.htmlLink ?? null,
  };

  if (event.status === "cancelled") {
    return { ...common, inbound: { kind: "removed" } };
  }
  if (recurrenceRefused) {
    return { ...common, inbound: { kind: "recurrence_refused" } };
  }
  if (event.start?.date || event.end?.date) {
    return { ...common, inbound: { kind: "all_day" } };
  }

  const providerZone = event.start?.timeZone ?? calendarTimeZone;
  if (!providerZone || !isIanaTimeZone(providerZone)) {
    return {
      ...common,
      inbound: { kind: "zone_refused", providerZone: providerZone ?? "" },
    };
  }
  const title = normalizeCalendarText(event.summary);
  const titleRefusal = calendarTitleRefusalReason(title);
  if (titleRefusal) {
    return {
      ...common,
      inbound: { kind: "title_refused", reason: titleRefusal },
    };
  }
  const startValue = event.start?.dateTime;
  const endValue = event.end?.dateTime;
  const endZone = event.end?.timeZone ?? providerZone;
  const start = startValue
    ? instantFromRfc3339OrWallClock(startValue, providerZone)
    : null;
  const end = endValue
    ? instantFromRfc3339OrWallClock(endValue, endZone)
    : null;
  if (!start || !end) {
    return {
      ...common,
      inbound: { kind: "time_refused", reason: "invalid_time" },
    };
  }
  if (Date.parse(end) <= Date.parse(start)) {
    return {
      ...common,
      inbound: { kind: "time_refused", reason: "invalid_range" },
    };
  }
  if ([...description].length > 5_000) {
    return {
      ...common,
      inbound: { kind: "description_refused", reason: "too_long" },
    };
  }

  return {
    ...common,
    inbound: {
      kind: "scheduled",
      schedule: {
        start,
        end,
        timeZone: providerZone,
        title,
        descriptionHash: await hashCalendarDescription(description),
      },
    },
  };
}

export function googleAuthorizationUrl(input: GoogleAuthorizationUrlInput): string {
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

async function googleTokenRequest(
  fetcher: CalendarFetch,
  body: URLSearchParams,
  operation: string,
): Promise<unknown> {
  const response = await fetcher(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: calendarProviderSignal(undefined),
  });
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const providerCode =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
    if (response.status === 401 || providerCode === "invalid_grant") {
      throw new CalendarReauthRequiredError("google", operation, response.status);
    }
    await providerJson<never>(
      async () => new Response(raw, {
        status: response.status,
        headers: response.headers,
      }),
      GOOGLE_TOKEN,
      {},
      { provider: "google", operation },
    );
  }
  return payload;
}

function oauthTokens(
  payload: unknown,
  fallbackRefreshToken: string | null,
): CalendarOAuthTokens {
  if (typeof payload !== "object" || payload === null) {
    throw new CalendarProviderError(
      "google calendar token endpoint returned a malformed success response",
      "google",
      "response",
      "parse token response",
      200,
    );
  }
  const token = payload as Record<string, unknown>;
  if (
    typeof token.access_token !== "string" ||
    token.access_token.trim() === "" ||
    (token.refresh_token !== undefined &&
      (typeof token.refresh_token !== "string" ||
        token.refresh_token.trim() === "")) ||
    (token.expires_in !== undefined &&
      (typeof token.expires_in !== "number" ||
        !Number.isFinite(token.expires_in) ||
        token.expires_in < 0)) ||
    (token.scope !== undefined && typeof token.scope !== "string")
  ) {
    throw new CalendarProviderError(
      "google calendar token endpoint returned a malformed success response",
      "google",
      "response",
      "parse token response",
      200,
    );
  }
  return {
    accessToken: token.access_token,
    refreshToken: (token.refresh_token as string | undefined) ?? fallbackRefreshToken,
    expiresInSeconds: (token.expires_in as number | undefined) ?? null,
    scope: (token.scope as string | undefined) ?? null,
  };
}

export async function exchangeGoogleAuthorizationCode(
  fetcher: CalendarFetch,
  client: CalendarOAuthClient,
  code: string,
  codeVerifier: string,
): Promise<CalendarOAuthTokens> {
  const payload = await googleTokenRequest(
    fetcher,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
    "exchange authorization code",
  );
  return oauthTokens(payload, null);
}

export async function refreshGoogleAccessToken(
  fetcher: CalendarFetch,
  client: CalendarOAuthClient,
  refreshToken: string,
): Promise<CalendarOAuthTokens> {
  const payload = await googleTokenRequest(
    fetcher,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    "refresh access token",
  );
  return oauthTokens(payload, refreshToken);
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google" as const;

  constructor(private readonly fetcher: CalendarFetch = fetch) {}

  async listChanges(
    input: ListCalendarChangesInput,
  ): Promise<CalendarChangePage> {
    const url = new URL(
      googleUrl(`/calendars/${encodeURIComponent(input.calendarId)}/events`),
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "2500");
    // Delta pages may contain thousands of unrelated primary-calendar events.
    // Fetch identity/tombstone metadata only; the worker GETs full content
    // after proving an id belongs to one of our task mappings.
    url.searchParams.set(
      "fields",
      "items(id,etag,status),nextPageToken,nextSyncToken,timeZone",
    );
    if (input.cursor) url.searchParams.set("syncToken", input.cursor);
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
    if (!input.cursor && input.rangeStart) {
      url.searchParams.set("timeMin", input.rangeStart);
    }
    if (!input.cursor && input.rangeEnd) {
      url.searchParams.set("timeMax", input.rangeEnd);
    }
    const page = await providerJson<GoogleEventPage>(
      this.fetcher,
      url.toString(),
      { headers: bearer(input.accessToken) },
      {
        provider: "google",
        operation: "list changes",
        fullResyncOnGone: Boolean(input.cursor),
      },
    );
    const items = page.items ?? [];
    const idLessCount = items.filter(
      (event) => typeof event.id !== "string" || event.id.trim() === "",
    ).length;
    if (idLessCount > 0) {
      console.warn("calendar change page skipped id-less provider events", {
        provider: "google",
        count: idLessCount,
      });
    }
    const notices = items.flatMap((event): CalendarChangeNotice[] => {
      const instanceId = event.id?.trim();
      if (!instanceId) return [];
      return [{
        instanceId,
        version: event.etag?.trim() || null,
        removed: event.status === "cancelled",
      }];
    });
    return {
      events: notices,
      nextPageToken: page.nextPageToken ?? null,
      nextCursor: page.nextPageToken ? null : (page.nextSyncToken ?? null),
    };
  }

  async getEvent(input: GetCalendarEventInput): Promise<CalendarRemoteEvent> {
    const event = await providerJson<GoogleEvent>(
      this.fetcher,
      googleUrl(
        `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}`,
      ),
      { headers: bearer(input.accessToken) },
      { provider: "google", operation: "get event" },
    );
    const normalized = await normalizeGoogleEvent(
      event,
      input.calendarTimeZone,
      input.connectedAccountEmail,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "google",
        "get event",
        "Google recurring master cannot be mapped as a task event",
      );
    }
    return normalized;
  }

  async createEvent(
    input: CreateCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    await assertDescriptionMatches(input, "create event");
    const eventId = await googleEventId(input.idempotencyKey);
    let event: GoogleEvent;
    try {
      event = await providerJson<GoogleEvent>(
        this.fetcher,
        googleUrl(`/calendars/${encodeURIComponent(input.calendarId)}/events`),
        {
          method: "POST",
          headers: {
            ...bearer(input.accessToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: eventId, ...writeBody(input) }),
        },
        { provider: "google", operation: "create event" },
      );
    } catch (error) {
      if (
        error instanceof CalendarProviderError &&
        error.kind === "precondition" &&
        error.status === 409
      ) {
        // The POST may have succeeded before its response was lost. The same
        // outbox identity names the same event on every attempt/generation, so
        // a conflict is recovered with a read instead of a second create.
        return this.getEvent({
          accessToken: input.accessToken,
          calendarId: input.calendarId,
          instanceId: eventId,
          calendarTimeZone: input.schedule.timeZone,
          connectedAccountEmail: input.connectedAccountEmail,
        });
      }
      throw error;
    }
    const normalized = await normalizeGoogleEvent(
      event,
      input.schedule.timeZone,
      input.connectedAccountEmail,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "google",
        "create event",
        "Google returned a recurring master for a single event create",
      );
    }
    if (normalized.inbound.kind === "recurrence_refused") {
      throw new InvalidCalendarEventError(
        "google",
        "create event",
        "Google returned a recurring series for a single event create",
      );
    }
    return normalized;
  }

  async patchEvent(
    input: PatchCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    assertVersion(input.version, "patch event");
    await assertDescriptionMatches(input, "patch event");
    const event = await providerJson<GoogleEvent>(
      this.fetcher,
      googleUrl(
        `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}`,
      ),
      {
        method: "PATCH",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
          "If-Match": input.version,
        },
        body: JSON.stringify(patchBody(input)),
      },
      { provider: "google", operation: "patch event" },
    );
    const normalized = await normalizeGoogleEvent(
      event,
      input.schedule.timeZone,
      input.connectedAccountEmail,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "google",
        "patch event",
        "Google returned a recurring master for an instance patch",
      );
    }
    if (normalized.inbound.kind === "recurrence_refused") {
      throw new InvalidCalendarEventError(
        "google",
        "patch event",
        "Google returned a recurring series for an instance patch",
      );
    }
    return normalized;
  }

  async annotateAndUnlink(
    input: AnnotateCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    assertVersion(input.version, "annotate event");
    const event = await providerJson<GoogleEvent>(
      this.fetcher,
      googleUrl(
        `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}?sendUpdates=none`,
      ),
      {
        method: "PATCH",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
          "If-Match": input.version,
        },
        body: JSON.stringify({
          description: appendUnlinkNote(input.currentDescription, input.note),
        }),
      },
      { provider: "google", operation: "annotate event" },
    );
    const normalized = await normalizeGoogleEvent(
      event,
      input.calendarTimeZone,
      input.connectedAccountEmail,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "google",
        "annotate event",
        "Google recurring master cannot be annotated through a task link",
      );
    }
    return normalized;
  }

  async deleteEvent(input: DeleteCalendarEventInput): Promise<void> {
    assertVersion(input.version, "delete event");
    try {
      await providerVoid(
        this.fetcher,
        googleUrl(
          `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}?sendUpdates=none`,
        ),
        {
          method: "DELETE",
          headers: {
            ...bearer(input.accessToken),
            "If-Match": input.version,
          },
        },
        { provider: "google", operation: "delete event" },
      );
    } catch (error) {
      if (error instanceof CalendarProviderError && error.kind === "not_found") {
        return;
      }
      throw error;
    }
  }

  async scrubEvent(
    input: ScrubCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    assertVersion(input.version, "scrub event");
    const event = await providerJson<GoogleEvent>(
      this.fetcher,
      googleUrl(
        `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}?sendUpdates=none`,
      ),
      {
        method: "PATCH",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
          "If-Match": input.version,
        },
        body: JSON.stringify({
          summary: SCRUBBED_EVENT_TITLE,
          description: "",
        }),
      },
      { provider: "google", operation: "scrub event" },
    );
    const normalized = await normalizeGoogleEvent(
      event,
      input.calendarTimeZone,
      input.connectedAccountEmail,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "google",
        "scrub event",
        "Google recurring master cannot be scrubbed through a task link",
      );
    }
    return normalized;
  }

  async startWatch(input: StartCalendarWatchInput): Promise<CalendarWatch> {
    const expiration = Date.parse(input.expiration);
    if (!Number.isFinite(expiration)) {
      throw new InvalidCalendarEventError(
        "google",
        "start watch",
        "Google watch expiration must be an ISO instant",
      );
    }
    const ttlSeconds = Math.max(1, Math.floor((expiration - Date.now()) / 1_000));
    const watch = await providerJson<GoogleWatchResponse>(
      this.fetcher,
      googleUrl(`/calendars/${encodeURIComponent(input.calendarId)}/events/watch`),
      {
        method: "POST",
        headers: {
          ...bearer(input.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: input.subscriptionId,
          type: "web_hook",
          address: input.callbackUrl,
          ...(input.clientState ? { token: input.clientState } : {}),
          params: { ttl: String(ttlSeconds) },
        }),
      },
      { provider: "google", operation: "start watch" },
    );
    return {
      subscriptionId: watch.id,
      resourceId: watch.resourceId ?? null,
      expiration: expirationFromMilliseconds(watch.expiration),
    };
  }

  async renewWatch(input: RenewCalendarWatchInput): Promise<CalendarWatch> {
    // Google channels cannot be extended. Establish the replacement first;
    // the caller can stop the old channel after persisting this result.
    return this.startWatch(input);
  }

  async stopWatch(input: StopCalendarWatchInput): Promise<void> {
    if (!input.resourceId) {
      throw new InvalidCalendarEventError(
        "google",
        "stop watch",
        "Google channel stop requires the stored resource id",
      );
    }
    try {
      await providerVoid(
        this.fetcher,
        googleUrl("/channels/stop"),
        {
          method: "POST",
          headers: {
            ...bearer(input.accessToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: input.subscriptionId,
            resourceId: input.resourceId,
          }),
        },
        { provider: "google", operation: "stop watch" },
      );
    } catch (error) {
      if (error instanceof CalendarProviderError && error.kind === "not_found") {
        return;
      }
      throw error;
    }
  }
}
