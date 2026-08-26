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
  wallClockFromInstant,
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
import { windowsZoneToIana } from "./windows-zones";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const SCRUBBED_EVENT_TITLE = "Loonext event removed";

export const MICROSOFT_CALENDAR_SCOPES = [
  "offline_access",
  "Calendars.ReadWrite",
] as const;

interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphEvent {
  id?: string;
  changeKey?: string;
  "@odata.etag"?: string;
  "@removed"?: unknown;
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  seriesMasterId?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  subject?: string;
  body?: { content?: string; contentType?: "text" | "html" };
  start?: GraphDateTime;
  end?: GraphDateTime;
  attendees?: unknown[];
  isOnlineMeeting?: boolean;
  onlineMeeting?: unknown;
  onlineMeetingProvider?: string;
  organizer?: { emailAddress?: { address?: string } };
  isOrganizer?: boolean;
  webLink?: string;
}

interface GraphDeltaPage {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface GraphSubscriptionResponse {
  id: string;
  resource?: string;
  expirationDateTime?: string;
}

export interface MicrosoftAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  tenant?: string;
  loginHint?: string;
}

function graphUrl(path: string): string {
  return `${GRAPH_API}${path}`;
}

function graphHeaders(
  accessToken: string,
  additional: Record<string, string> = {},
  maxPageSize?: number,
  bodyContentType: "text" | "html" = "text",
): HeadersInit {
  // Outlook's default event IDs can change when an item moves between
  // calendars. Calendar links are durable, so every event request (including
  // subscription setup) must opt into IDs that survive those moves.
  const preferences = [
    'IdType="ImmutableId"',
    `outlook.body-content-type="${bodyContentType}"`,
  ];
  if (maxPageSize !== undefined) {
    preferences.push(`odata.maxpagesize=${maxPageSize}`);
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Prefer: preferences.join(", "),
    ...additional,
  };
}

function sameEmail(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function decodeNumericHtmlEntity(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "";
}

function graphBodyText(body: GraphEvent["body"]): string {
  const content = body?.content ?? "";
  if (body?.contentType !== "html") return normalizeCalendarText(content);
  const withoutActiveContent = content.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const withoutTags = withoutActiveContent
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const decoded = withoutTags
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      decodeNumericHtmlEntity(Number(decimal)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      decodeNumericHtmlEntity(Number.parseInt(hex, 16)),
    )
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, name: string) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    })[name.toLowerCase()] ?? "");
  return normalizeCalendarText(decoded).replace(/\n+$/, "");
}

function assertVersion(version: string, operation: string): void {
  if (!version.trim()) {
    throw new InvalidCalendarEventError(
      "microsoft",
      operation,
      "Microsoft conditional writes require a stored entity tag",
    );
  }
}

function graphEntityTag(event: GraphEvent): string | null {
  const entityTag = event["@odata.etag"]?.trim();
  if (entityTag) return entityTag;
  const changeKey = event.changeKey?.trim();
  // Graph documents the event entity tag as the changeKey wrapped in the
  // weak, quoted HTTP ETag syntax. A raw changeKey is never a valid If-Match
  // value; reject characters that cannot appear unescaped in an opaque tag.
  if (changeKey && /^[\x21\x23-\x7e]+$/.test(changeKey)) {
    return `W/"${changeKey}"`;
  }
  return null;
}

function assertGraphCursor(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidCalendarEventError(
      "microsoft",
      "list changes",
      "Microsoft delta cursor is not a valid URL",
    );
  }
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new InvalidCalendarEventError(
      "microsoft",
      "list changes",
      "Microsoft delta cursor must point to graph.microsoft.com",
    );
  }
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function annotatedBody(input: AnnotateCalendarEventInput): {
  contentType: "text" | "html";
  content: string;
} {
  if (input.descriptionFormat === "html") {
    const note = normalizeCalendarText(input.note).trim();
    // The provider owns this markup. Preserve it byte-for-byte and append only
    // our escaped paragraph; flattening or reserializing can destroy Outlook
    // formatting even on an attendee-free, non-meeting event.
    const existing = input.currentDescription;
    return {
      contentType: "html",
      content: note
        ? `${existing}<p>${escapeHtml(note)}</p>`
        : existing,
    };
  }
  return {
    contentType: "text",
    content: appendUnlinkNote(input.currentDescription, input.note),
  };
}

function graphWriteBody(input: WriteCalendarEventInput): Record<string, unknown> {
  if (!isIanaTimeZone(input.schedule.timeZone)) {
    throw new InvalidCalendarEventError(
      "microsoft",
      "build event write",
      "Microsoft event has an invalid IANA display time zone",
    );
  }
  // Graph's dateTimeTimeZone shape has no DST-fold bit. Sending a selected
  // local wall clock would therefore collapse the two occurrences of (for
  // example) 01:30 during fall-back. UTC preserves the exact instant; the
  // selected IANA zone remains in our canonical snapshot for display.
  const start = wallClockFromInstant(
    input.schedule.start,
    "Etc/UTC",
  );
  const end = wallClockFromInstant(input.schedule.end, "Etc/UTC");
  if (!start || !end) {
    throw new InvalidCalendarEventError(
      "microsoft",
      "build event write",
      "Microsoft event has an invalid instant or IANA time zone",
    );
  }
  return {
    subject: normalizeCalendarText(input.schedule.title),
    body: {
      contentType: "text",
      content: normalizeCalendarText(input.description),
    },
    start: { dateTime: start, timeZone: "UTC" },
    end: { dateTime: end, timeZone: "UTC" },
  };
}

function graphPatchBody(
  input: PatchCalendarEventInput,
): Record<string, unknown> {
  const changes = input.changes ?? {
    timing: true,
    title: true,
    description: true,
  };
  const full = graphWriteBody(input);
  return {
    ...(changes.title ? { subject: full.subject } : {}),
    ...(changes.description ? { body: full.body } : {}),
    ...(changes.timing ? { start: full.start, end: full.end } : {}),
  };
}

async function assertDescriptionMatches(
  input: WriteCalendarEventInput,
  operation: string,
): Promise<void> {
  if ((await hashCalendarDescription(input.description)) !== input.schedule.descriptionHash) {
    throw new InvalidCalendarEventError(
      "microsoft",
      operation,
      "Microsoft write description does not match the scheduling snapshot hash",
    );
  }
}

/** Series masters are filtered; occurrences and exceptions retain their id. */
export async function normalizeMicrosoftEvent(
  event: GraphEvent,
  connectedAccountEmail?: string,
  canonicalScheduleTimeZone?: string,
): Promise<CalendarRemoteEvent | null> {
  const instanceId = typeof event.id === "string" ? event.id.trim() : "";
  if (!instanceId) {
    throw new InvalidCalendarEventError(
      "microsoft",
      "normalize event",
      "Microsoft event is missing its instance id",
    );
  }
  const recurrenceRefused = event.type === "seriesMaster";

  const description = graphBodyText(event.body);
  const descriptionFormat: "text" | "html" =
    event.body?.contentType === "html" ? "html" : "text";
  const organizerEmail = event.organizer?.emailAddress?.address?.trim() || null;
  const version = graphEntityTag(event);
  const common = {
    instanceId,
    // Conditional Graph writes require the HTTP entity tag, including its
    // weak/quoted syntax. changeKey is event metadata, not an If-Match value.
    version,
    description,
    rawDescription:
      descriptionFormat === "html" ? (event.body?.content ?? "") : null,
    descriptionFormat,
    hasAttendees: Boolean(event.attendees?.length),
    hasOnlineMeeting:
      event.isOnlineMeeting === true ||
      event.onlineMeeting != null ||
      (typeof event.onlineMeetingProvider === "string" &&
        event.onlineMeetingProvider !== "unknown"),
    organizerEmail,
    organizerIsConnectedAccount:
      event.isOrganizer === true ||
      sameEmail(organizerEmail ?? undefined, connectedAccountEmail),
    webUrl: event.webLink ?? null,
  };

  if (event["@removed"] || event.isCancelled) {
    return { ...common, inbound: { kind: "removed" } };
  }
  if (!version) {
    throw new InvalidCalendarEventError(
      "microsoft",
      "normalize event",
      "Microsoft event is missing a conditional-write entity tag",
    );
  }
  if (recurrenceRefused) {
    return { ...common, inbound: { kind: "recurrence_refused" } };
  }
  if (event.isAllDay) {
    return { ...common, inbound: { kind: "all_day" } };
  }

  const providerZone = event.start?.timeZone ?? "";
  const startZone = windowsZoneToIana(providerZone);
  if (!startZone) {
    return {
      ...common,
      inbound: { kind: "zone_refused", providerZone },
    };
  }
  const endProviderZone = event.end?.timeZone ?? providerZone;
  const endZone = windowsZoneToIana(endProviderZone);
  if (!endZone) {
    return {
      ...common,
      inbound: { kind: "zone_refused", providerZone: endProviderZone },
    };
  }
  const title = normalizeCalendarText(event.subject);
  const titleRefusal = calendarTitleRefusalReason(title);
  if (titleRefusal) {
    return {
      ...common,
      inbound: { kind: "title_refused", reason: titleRefusal },
    };
  }
  const startValue = event.start?.dateTime;
  const endValue = event.end?.dateTime;
  const start = startValue
    ? instantFromRfc3339OrWallClock(startValue, startZone)
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
  if (!common.hasOnlineMeeting && [...description].length > 5_000) {
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
        // A Windows zone maps to one territory-001 IANA name (for example
        // Mountain Standard Time -> America/Denver), which is not necessarily
        // the selected workspace zone (America/Edmonton). Graph reads and
        // writes use UTC to preserve the exact instant; retaining the selected
        // canonical IANA identity keeps display/diff semantics stable.
        timeZone:
          canonicalScheduleTimeZone &&
          isIanaTimeZone(canonicalScheduleTimeZone)
            ? canonicalScheduleTimeZone
            : startZone,
        title,
        descriptionHash: await hashCalendarDescription(description),
      },
    },
  };
}

function microsoftOAuthBase(tenant = "common"): string {
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) {
    throw new InvalidCalendarEventError(
      "microsoft",
      "build authorization URL",
      "Microsoft tenant is invalid",
    );
  }
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export function microsoftAuthorizationUrl(
  input: MicrosoftAuthorizationUrlInput,
): string {
  const url = new URL(`${microsoftOAuthBase(input.tenant)}/authorize`);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

async function graphTokenRequest(
  fetcher: CalendarFetch,
  tenant: string | undefined,
  body: URLSearchParams,
  operation: string,
): Promise<unknown> {
  const url = `${microsoftOAuthBase(tenant)}/token`;
  const response = await fetcher(url, {
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
      throw new CalendarReauthRequiredError(
        "microsoft",
        operation,
        response.status,
      );
    }
    await providerJson<never>(
      async () => new Response(raw, {
        status: response.status,
        headers: response.headers,
      }),
      url,
      {},
      { provider: "microsoft", operation },
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
      "microsoft calendar token endpoint returned a malformed success response",
      "microsoft",
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
      "microsoft calendar token endpoint returned a malformed success response",
      "microsoft",
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

export async function exchangeMicrosoftAuthorizationCode(
  fetcher: CalendarFetch,
  client: CalendarOAuthClient,
  code: string,
  codeVerifier: string,
  tenant?: string,
): Promise<CalendarOAuthTokens> {
  const payload = await graphTokenRequest(
    fetcher,
    tenant,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    }),
    "exchange authorization code",
  );
  return oauthTokens(payload, null);
}

export async function refreshMicrosoftAccessToken(
  fetcher: CalendarFetch,
  client: CalendarOAuthClient,
  refreshToken: string,
  tenant?: string,
): Promise<CalendarOAuthTokens> {
  const payload = await graphTokenRequest(
    fetcher,
    tenant,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    }),
    "refresh access token",
  );
  return oauthTokens(payload, refreshToken);
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly name = "microsoft" as const;

  constructor(private readonly fetcher: CalendarFetch = fetch) {}

  async listChanges(
    input: ListCalendarChangesInput,
  ): Promise<CalendarChangePage> {
    let url: string;
    const opaqueLink = input.pageToken ?? input.cursor;
    if (opaqueLink) {
      url = assertGraphCursor(opaqueLink);
    } else {
      if (!input.rangeStart || !input.rangeEnd) {
        throw new InvalidCalendarEventError(
          "microsoft",
          "list changes",
          "Initial Microsoft delta requires rangeStart and rangeEnd",
        );
      }
      const initial = new URL(
        graphUrl(
          `/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView/delta`,
        ),
      );
      initial.searchParams.set("startDateTime", input.rangeStart);
      initial.searchParams.set("endDateTime", input.rangeEnd);
      // Keep unrelated calendar content out of memory and logs. Full bodies
      // and schedule fields are fetched only for ids with an existing mapping.
      initial.searchParams.set("$select", "id,changeKey,isCancelled,type");
      url = initial.toString();
    }
    const page = await providerJson<GraphDeltaPage>(
      this.fetcher,
      url,
      {
        headers: graphHeaders(
          input.accessToken,
          {},
          500,
        ),
      },
      { provider: "microsoft", operation: "list changes" },
    );
    const events = page.value ?? [];
    const idLessCount = events.filter(
      (event) => typeof event.id !== "string" || event.id.trim() === "",
    ).length;
    if (idLessCount > 0) {
      console.warn("calendar change page skipped id-less provider events", {
        provider: "microsoft",
        count: idLessCount,
      });
    }
    const notices = events.flatMap((event): CalendarChangeNotice[] => {
      const instanceId = event.id?.trim();
      if (!instanceId) return [];
      return [{
        instanceId,
        version: graphEntityTag(event),
        removed: Boolean(event["@removed"] || event.isCancelled),
      }];
    });
    return {
      events: notices,
      nextPageToken: page["@odata.nextLink"] ?? null,
      nextCursor: page["@odata.nextLink"]
        ? null
        : (page["@odata.deltaLink"] ?? null),
    };
  }

  async getEvent(input: GetCalendarEventInput): Promise<CalendarRemoteEvent> {
    const event = await providerJson<GraphEvent>(
      this.fetcher,
      graphUrl(
        `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}`,
      ),
      {
        headers: graphHeaders(
          input.accessToken,
          {},
          undefined,
          input.preserveDescriptionFormatting ? "html" : "text",
        ),
      },
      { provider: "microsoft", operation: "get event" },
    );
    const normalized = await normalizeMicrosoftEvent(
      event,
      input.connectedAccountEmail,
      input.calendarTimeZone,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "get event",
        "Microsoft series master cannot be mapped as a task event",
      );
    }
    return normalized;
  }

  async createEvent(
    input: CreateCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    await assertDescriptionMatches(input, "create event");
    const transactionId = input.idempotencyKey.trim();
    if (!transactionId || transactionId.length > 255) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "create event",
        "Microsoft event create requires a stable idempotency key of at most 255 characters",
      );
    }
    const event = await providerJson<GraphEvent>(
      this.fetcher,
      graphUrl(`/me/calendars/${encodeURIComponent(input.calendarId)}/events`),
      {
        method: "POST",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          ...graphWriteBody(input),
          transactionId,
        }),
      },
      { provider: "microsoft", operation: "create event" },
    );
    const normalized = await normalizeMicrosoftEvent(
      event,
      input.connectedAccountEmail,
      input.schedule.timeZone,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "create event",
        "Microsoft returned a series master for a single event create",
      );
    }
    if (normalized.inbound.kind === "recurrence_refused") {
      throw new InvalidCalendarEventError(
        "microsoft",
        "create event",
        "Microsoft returned a recurring series for a single event create",
      );
    }
    return normalized;
  }

  async patchEvent(
    input: PatchCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    assertVersion(input.version, "patch event");
    await assertDescriptionMatches(input, "patch event");
    const event = await providerJson<GraphEvent>(
      this.fetcher,
      graphUrl(
        `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}`,
      ),
      {
        method: "PATCH",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
          "If-Match": input.version,
        }),
        body: JSON.stringify(graphPatchBody(input)),
      },
      { provider: "microsoft", operation: "patch event" },
    );
    const normalized = await normalizeMicrosoftEvent(
      event,
      input.connectedAccountEmail,
      input.schedule.timeZone,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "patch event",
        "Microsoft returned a series master for an instance patch",
      );
    }
    if (normalized.inbound.kind === "recurrence_refused") {
      throw new InvalidCalendarEventError(
        "microsoft",
        "patch event",
        "Microsoft returned a recurring series for an instance patch",
      );
    }
    return normalized;
  }

  async annotateAndUnlink(
    input: AnnotateCalendarEventInput,
  ): Promise<CalendarRemoteEvent> {
    assertVersion(input.version, "annotate event");
    const event = await providerJson<GraphEvent>(
      this.fetcher,
      graphUrl(
        `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.instanceId)}`,
      ),
      {
        method: "PATCH",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
          "If-Match": input.version,
        }),
        body: JSON.stringify({ body: annotatedBody(input) }),
      },
      { provider: "microsoft", operation: "annotate event" },
    );
    const normalized = await normalizeMicrosoftEvent(
      event,
      input.connectedAccountEmail,
      input.calendarTimeZone,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "annotate event",
        "Microsoft series master cannot be annotated through a task link",
      );
    }
    return normalized;
  }

  async deleteEvent(input: DeleteCalendarEventInput): Promise<void> {
    assertVersion(input.version, "delete event");
    try {
      await providerVoid(
        this.fetcher,
        graphUrl(`/me/events/${encodeURIComponent(input.instanceId)}`),
        {
          method: "DELETE",
          headers: graphHeaders(input.accessToken, {
            "If-Match": input.version,
          }),
        },
        { provider: "microsoft", operation: "delete event" },
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
    const event = await providerJson<GraphEvent>(
      this.fetcher,
      graphUrl(`/me/events/${encodeURIComponent(input.instanceId)}`),
      {
        method: "PATCH",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
          "If-Match": input.version,
        }),
        body: JSON.stringify({
          subject: SCRUBBED_EVENT_TITLE,
          body: { contentType: "text", content: "" },
        }),
      },
      { provider: "microsoft", operation: "scrub event" },
    );
    const normalized = await normalizeMicrosoftEvent(
      event,
      input.connectedAccountEmail,
      input.calendarTimeZone,
    );
    if (!normalized) {
      throw new InvalidCalendarEventError(
        "microsoft",
        "scrub event",
        "Microsoft series master cannot be scrubbed through a task link",
      );
    }
    return normalized;
  }

  async startWatch(input: StartCalendarWatchInput): Promise<CalendarWatch> {
    const watch = await providerJson<GraphSubscriptionResponse>(
      this.fetcher,
      graphUrl("/subscriptions"),
      {
        method: "POST",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          changeType: "created,updated,deleted",
          notificationUrl: input.callbackUrl,
          resource: "/me/events",
          expirationDateTime: input.expiration,
          ...(input.clientState ? { clientState: input.clientState } : {}),
        }),
      },
      { provider: "microsoft", operation: "start watch" },
    );
    return {
      subscriptionId: watch.id,
      resourceId: watch.resource ?? null,
      expiration: watch.expirationDateTime ?? null,
    };
  }

  async renewWatch(input: RenewCalendarWatchInput): Promise<CalendarWatch> {
    const watch = await providerJson<GraphSubscriptionResponse>(
      this.fetcher,
      graphUrl(`/subscriptions/${encodeURIComponent(input.currentSubscriptionId)}`),
      {
        method: "PATCH",
        headers: graphHeaders(input.accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ expirationDateTime: input.expiration }),
      },
      { provider: "microsoft", operation: "renew watch" },
    );
    return {
      subscriptionId: watch.id,
      resourceId: watch.resource ?? null,
      expiration: watch.expirationDateTime ?? null,
    };
  }

  async stopWatch(input: StopCalendarWatchInput): Promise<void> {
    try {
      await providerVoid(
        this.fetcher,
        graphUrl(`/subscriptions/${encodeURIComponent(input.subscriptionId)}`),
        {
          method: "DELETE",
          headers: graphHeaders(input.accessToken),
        },
        { provider: "microsoft", operation: "stop watch" },
      );
    } catch (error) {
      if (error instanceof CalendarProviderError && error.kind === "not_found") {
        return;
      }
      throw error;
    }
  }
}
