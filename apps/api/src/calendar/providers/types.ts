import type {
  CalendarInbound,
  CalendarScheduleSnapshot,
} from "../sync";

export type CalendarProviderName = "google" | "microsoft";

/** Kept injectable so provider behavior can be tested without credentials. */
export type CalendarFetch = typeof fetch;

export interface CalendarOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface CalendarOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scope: string | null;
}

export interface CalendarRemoteEvent {
  /** Always a single event or recurring occurrence id, never a series id. */
  instanceId: string;
  /** Etag/changeKey used for the next conditional write. */
  version: string | null;
  inbound: CalendarInbound;
  /** Plain-text projection used for task synchronization and hashing. */
  description: string;
  /** Original provider body, retained only in memory for format-safe unlink. */
  rawDescription?: string | null;
  descriptionFormat: "text" | "html";
  hasAttendees: boolean;
  /** Provider metadata whose body/meeting semantics an automatic patch could damage. */
  hasOnlineMeeting: boolean;
  organizerEmail: string | null;
  organizerIsConnectedAccount: boolean;
  webUrl: string | null;
}

/**
 * Content-free provider delta item. Full event content is fetched only after
 * the worker proves this provider id belongs to an existing task mapping.
 */
export interface CalendarChangeNotice {
  instanceId: string;
  version: string | null;
  removed: boolean;
}

export interface CalendarChangePage {
  events: CalendarChangeNotice[];
  /** Provider page token or opaque next-link. */
  nextPageToken: string | null;
  /** Durable sync token or opaque delta-link; present only on the final page. */
  nextCursor: string | null;
}

export interface ListCalendarChangesInput {
  accessToken: string;
  calendarId: string;
  calendarTimeZone?: string;
  connectedAccountEmail?: string;
  cursor?: string;
  pageToken?: string;
  /** Required for an initial Microsoft calendarView delta request. */
  rangeStart?: string;
  /** Required for an initial Microsoft calendarView delta request. */
  rangeEnd?: string;
}

export interface GetCalendarEventInput {
  accessToken: string;
  calendarId: string;
  instanceId: string;
  calendarTimeZone?: string;
  connectedAccountEmail?: string;
  /** Request the provider's original rich body for a format-preserving write. */
  preserveDescriptionFormatting?: boolean;
}

export interface WriteCalendarEventInput {
  accessToken: string;
  calendarId: string;
  schedule: CalendarScheduleSnapshot;
  /** Plain text owned by Loonext. Attendees are deliberately not accepted. */
  description: string;
  connectedAccountEmail?: string;
}

export interface CreateCalendarEventInput extends WriteCalendarEventInput {
  /**
   * Stable identity of the durable create intent. It must remain unchanged
   * across attempts and outbox generations so an accepted response lost in
   * transit cannot create a second provider event.
   */
  idempotencyKey: string;
}

export interface PatchCalendarEventInput extends WriteCalendarEventInput {
  instanceId: string;
  version: string;
  /** Only fields changed from the last mutually agreed scheduling snapshot. */
  changes?: {
    timing: boolean;
    title: boolean;
    description: boolean;
  };
}

export interface AnnotateCalendarEventInput {
  accessToken: string;
  calendarId: string;
  instanceId: string;
  version: string;
  currentDescription: string;
  descriptionFormat?: "text" | "html";
  note: string;
  calendarTimeZone?: string;
  connectedAccountEmail?: string;
}

export interface ScrubCalendarEventInput {
  accessToken: string;
  calendarId: string;
  instanceId: string;
  version: string;
  calendarTimeZone?: string;
  connectedAccountEmail?: string;
}

export type DeleteCalendarEventInput = ScrubCalendarEventInput;

export interface StartCalendarWatchInput {
  accessToken: string;
  calendarId: string;
  callbackUrl: string;
  /** Google channel id or Microsoft subscription idempotency identifier. */
  subscriptionId: string;
  clientState?: string;
  expiration: string;
}

export interface RenewCalendarWatchInput extends StartCalendarWatchInput {
  currentSubscriptionId: string;
}

export interface StopCalendarWatchInput {
  accessToken: string;
  subscriptionId: string;
  resourceId?: string;
}

export interface CalendarWatch {
  subscriptionId: string;
  resourceId: string | null;
  expiration: string | null;
}

export interface CalendarProvider {
  readonly name: CalendarProviderName;
  listChanges(input: ListCalendarChangesInput): Promise<CalendarChangePage>;
  getEvent(input: GetCalendarEventInput): Promise<CalendarRemoteEvent>;
  createEvent(input: CreateCalendarEventInput): Promise<CalendarRemoteEvent>;
  patchEvent(input: PatchCalendarEventInput): Promise<CalendarRemoteEvent>;
  annotateAndUnlink(
    input: AnnotateCalendarEventInput,
  ): Promise<CalendarRemoteEvent>;
  /** Permanently remove an attendee-free event owned by the connected user. */
  deleteEvent(input: DeleteCalendarEventInput): Promise<void>;
  /** Remove Loonext-owned content while preserving meeting participation. */
  scrubEvent(input: ScrubCalendarEventInput): Promise<CalendarRemoteEvent>;
  startWatch(input: StartCalendarWatchInput): Promise<CalendarWatch>;
  renewWatch(input: RenewCalendarWatchInput): Promise<CalendarWatch>;
  stopWatch(input: StopCalendarWatchInput): Promise<void>;
}

export type CalendarProviderErrorKind =
  | "reauth"
  | "retry"
  | "precondition"
  | "full_resync"
  | "not_found"
  | "invalid_event"
  | "response";

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    readonly provider: CalendarProviderName,
    readonly kind: CalendarProviderErrorKind,
    readonly operation: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

export class CalendarReauthRequiredError extends CalendarProviderError {
  constructor(provider: CalendarProviderName, operation: string, status = 401) {
    super(
      `${provider} calendar authorization must be renewed`,
      provider,
      "reauth",
      operation,
      status,
    );
    this.name = "CalendarReauthRequiredError";
  }
}

export class CalendarRetryableError extends CalendarProviderError {
  constructor(
    provider: CalendarProviderName,
    operation: string,
    status: number,
    retryAfterMs: number | null,
  ) {
    super(
      `${provider} calendar request should be retried`,
      provider,
      "retry",
      operation,
      status,
      retryAfterMs,
    );
    this.name = "CalendarRetryableError";
  }
}

export class CalendarPreconditionError extends CalendarProviderError {
  constructor(
    provider: CalendarProviderName,
    operation: string,
    status: 409 | 412,
  ) {
    super(
      `${provider} calendar event changed; re-read before deciding again`,
      provider,
      "precondition",
      operation,
      status,
    );
    this.name = "CalendarPreconditionError";
  }
}

export class CalendarFullResyncRequiredError extends CalendarProviderError {
  constructor(provider: CalendarProviderName, operation: string) {
    super(
      `${provider} calendar cursor expired; start a full resync`,
      provider,
      "full_resync",
      operation,
      410,
    );
    this.name = "CalendarFullResyncRequiredError";
  }
}

export class CalendarEventNotFoundError extends CalendarProviderError {
  constructor(
    provider: CalendarProviderName,
    operation: string,
    status: 404 | 410,
  ) {
    super(
      `${provider} calendar event no longer exists`,
      provider,
      "not_found",
      operation,
      status,
    );
    this.name = "CalendarEventNotFoundError";
  }
}

export class InvalidCalendarEventError extends CalendarProviderError {
  constructor(
    provider: CalendarProviderName,
    operation: string,
    message: string,
  ) {
    super(message, provider, "invalid_event", operation, null);
    this.name = "InvalidCalendarEventError";
  }
}
