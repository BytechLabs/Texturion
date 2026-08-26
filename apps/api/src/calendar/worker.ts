import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { syncTaskReminders as regenerateTaskReminders } from "../messaging/appointment-reminders";
import { deliverPush } from "../notifications/deliver";
import { generateToken, hashToken } from "../public-links/tokens";
import {
  authorizeCalendarConnection,
  type CalendarCredentialClaimResult,
  type CalendarCredentialMutationResult,
  type CalendarCredentialRefreshStore,
} from "./authorization";
import { CALENDAR_VERIFICATION_MAX_AGE_MS } from "./liveness";
import {
  hashCalendarDescription,
  normalizeCalendarText,
} from "./providers/normalize";
import {
  CalendarProviderError,
  type CalendarProvider,
  type CalendarProviderName,
  type CalendarRemoteEvent,
} from "./providers/types";
import type { CalendarScheduleSnapshot } from "./sync";

const CLAIM_LIMIT = 25;
const LEASE_SECONDS = 120;
const WEBHOOK_RENEWAL_WINDOW_SECONDS = 86_400;
const INITIAL_LOOKBACK_DAYS = 90;
const INITIAL_LOOKAHEAD_DAYS = 365;
const MAX_PROVIDER_PAGES = 100;
const LINK_VERIFICATION_PAGE_SIZE = 500;
const UNLINK_NOTE =
  "This job was removed in Loonext. Changes to this event no longer sync.";

export interface CalendarConnectionRow {
  id: string;
  company_id: string;
  user_id: string;
  provider: CalendarProviderName;
  provider_account_id: string;
  provider_account_label: string | null;
  selected_calendar_id: string;
  selected_calendar_timezone: string;
  credential_ciphertext: string;
  credential_iv: string;
  credential_key_version: string;
  credential_generation: number;
  sync_cursor: string | null;
  pull_full_sync: boolean;
  last_full_sync_at: string | null;
  full_sync_due_at: string;
  pull_generation: number;
}

export interface CalendarWebhookSubscriptionRow {
  id: string;
  company_id: string;
  connection_id: string;
  provider_subscription_id: string;
  provider_resource_id: string | null;
  provider_calendar_id: string;
  expires_at: string;
  renewal_generation: number;
  renewal_attempts: number;
}

export interface CalendarOutboxRow {
  id: string;
  company_id: string;
  connection_id: string;
  task_id: string;
  link_id: string | null;
  action: "create" | "upsert" | "unlink" | "scrub";
  requested_snapshot: CalendarScheduleSnapshot | null;
  provider_effect_ambiguous: boolean;
  generation: number;
  attempts: number;
}

export interface CalendarReminderReplanRow {
  id: string;
  company_id: string;
  task_id: string;
  requester_user_id: string;
  generation: number;
  attempts: number;
}

export interface CalendarOwnerDisclosureRow {
  connection_id: string;
  company_id: string;
  user_id: string;
  reason: "reauth_required" | "sync_stale" | "cleanup_failed";
  generation: number;
}

export interface CalendarTaskRow {
  id: string;
  company_id: string;
  title: string;
  description: string;
  due_at: string | null;
  assigned_user_id: string | null;
  deleted_at: string | null;
}

export interface CalendarLinkRow {
  id: string;
  company_id: string;
  connection_id: string;
  task_id: string;
  provider_event_id: string;
  provider_instance_id: string;
  provider_series_id: string | null;
  provider_version: string | null;
  link_state: "active" | "conflict" | "event_removed" | "refused" | "unlinked";
  base_snapshot: CalendarScheduleSnapshot;
  last_sent_snapshot: CalendarScheduleSnapshot | null;
}

export interface CalendarAuthorizedProvider {
  accessToken: string;
  provider: CalendarProvider;
}

export interface CalendarMutationResult {
  outcome: string;
}

export interface CalendarSyncStore extends CalendarCredentialRefreshStore {
  purgeOauthStates(limit: number): Promise<number>;
  queueStaleOwnerDisclosures(
    staleBefore: string,
    limit: number,
  ): Promise<number>;
  claimOwnerDisclosures(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CalendarOwnerDisclosureRow[]>;
  commitOwnerDisclosure(input: {
    disclosure: CalendarOwnerDisclosureRow;
    workerId: string;
  }): Promise<CalendarMutationResult>;
  retryOwnerDisclosure(input: {
    disclosure: CalendarOwnerDisclosureRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
  }): Promise<CalendarMutationResult>;
  claimReminderReplans(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CalendarReminderReplanRow[]>;
  completeReminderReplan(input: {
    replan: CalendarReminderReplanRow;
    workerId: string;
  }): Promise<CalendarMutationResult>;
  retryReminderReplan(input: {
    replan: CalendarReminderReplanRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
  }): Promise<CalendarMutationResult>;
  claimWebhookRenewals(
    workerId: string,
    limit: number,
    leaseSeconds: number,
    withinSeconds: number,
  ): Promise<CalendarWebhookSubscriptionRow[]>;
  claimWebhookRevocations(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CalendarWebhookSubscriptionRow[]>;
  claimOutbox(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CalendarOutboxRow[]>;
  markProviderEffectStarted(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
  }): Promise<CalendarMutationResult>;
  claimPulls(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<CalendarConnectionRow[]>;
  renewPullLease(input: {
    connection: CalendarConnectionRow;
    workerId: string;
    leaseSeconds: number;
  }): Promise<CalendarMutationResult>;
  getConnection(id: string): Promise<CalendarConnectionRow | null>;
  getTask(id: string): Promise<CalendarTaskRow | null>;
  getLink(id: string): Promise<CalendarLinkRow | null>;
  findSyncableLink(
    companyId: string,
    connectionId: string,
    providerInstanceId: string,
  ): Promise<CalendarLinkRow | null>;
  listSyncableLinks(
    companyId: string,
    connectionId: string,
  ): Promise<CalendarLinkRow[]>;
  refreshTaskReminders(input: {
    companyId: string;
    taskId: string;
    userId: string;
  }): Promise<void>;
  commitCreated(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    remote: CalendarRemoteEvent;
    sent: CalendarScheduleSnapshot;
    description: string;
  }): Promise<CalendarMutationResult>;
  commitSent(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    providerVersion: string | null;
    sent: CalendarScheduleSnapshot | null;
    description: string | null;
  }): Promise<CalendarMutationResult>;
  commitScrubbed(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    providerVersion: string | null;
    providerDeleted: boolean;
  }): Promise<CalendarMutationResult>;
  abandonCleanup(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    errorCode: string;
    errorDetail: string;
  }): Promise<CalendarMutationResult>;
  applyProviderEvent(input: {
    connection: CalendarConnectionRow;
    link: CalendarLinkRow;
    remote: CalendarRemoteEvent;
    workerId: string;
    outbox?: CalendarOutboxRow;
  }): Promise<CalendarMutationResult>;
  markEventRemoved(input: {
    connection: CalendarConnectionRow;
    link: CalendarLinkRow;
    remote: CalendarRemoteEvent;
    workerId: string;
    outbox?: CalendarOutboxRow;
  }): Promise<CalendarMutationResult>;
  markRefused(input: {
    connection: CalendarConnectionRow;
    link: CalendarLinkRow;
    remote: CalendarRemoteEvent;
    code:
      | "all_day"
      | "unknown_time_zone"
      | "invalid_title"
      | "description_too_long"
      | "unsafe_meeting"
      | "recurrence"
      | "invalid_time";
    detail: string;
    workerId: string;
    outbox?: CalendarOutboxRow;
  }): Promise<CalendarMutationResult>;
  retryOutbox(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
    requiresReauth: boolean;
    effectDefinitelyAbsent: boolean;
  }): Promise<CalendarMutationResult>;
  cancelOutbox(input: {
    outbox: CalendarOutboxRow;
    workerId: string;
    reason: string;
  }): Promise<CalendarMutationResult>;
  commitPull(input: {
    connection: CalendarConnectionRow;
    workerId: string;
    cursor: string | null;
  }): Promise<CalendarMutationResult>;
  retryPull(input: {
    connection: CalendarConnectionRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
    requiresReauth: boolean;
  }): Promise<CalendarMutationResult>;
  commitWebhookRenewal(input: {
    subscription: CalendarWebhookSubscriptionRow;
    workerId: string;
    providerSubscriptionId: string;
    providerResourceId: string | null;
    clientStateHash: string;
    expiresAt: string;
  }): Promise<CalendarMutationResult>;
  retryWebhookRenewal(input: {
    subscription: CalendarWebhookSubscriptionRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
    requiresReauth: boolean;
  }): Promise<CalendarMutationResult>;
  commitWebhookRevocation(input: {
    subscription: CalendarWebhookSubscriptionRow;
    workerId: string;
  }): Promise<CalendarMutationResult>;
  retryWebhookRevocation(input: {
    subscription: CalendarWebhookSubscriptionRow;
    workerId: string;
    delaySeconds: number;
    errorCode: string;
    errorDetail: string;
  }): Promise<CalendarMutationResult>;
}

export interface CalendarWorkerDependencies {
  store: CalendarSyncStore;
  authorize(
    connection: CalendarConnectionRow,
  ): Promise<CalendarAuthorizedProvider>;
  webhookCallbackUrl?(provider: CalendarProviderName): string;
  discloseOwner?(disclosure: CalendarOwnerDisclosureRow): Promise<void>;
  now?: Date;
  workerId?: string;
}

class CalendarLeaseEndedError extends Error {
  constructor(
    readonly operation: string,
    readonly outcome: "lease_lost" | "superseded",
  ) {
    super(`${operation}: ${outcome}`);
    this.name = "CalendarLeaseEndedError";
  }
}

class CalendarMutationRejectedError extends Error {
  constructor(
    readonly operation: string,
    readonly outcome: string,
  ) {
    super(`${operation}: unexpected outcome ${outcome}`);
    this.name = "CalendarMutationRejectedError";
  }
}

function expectMutationOutcome(
  operation: string,
  result: CalendarMutationResult,
  accepted: readonly string[],
): string {
  if (result.outcome === "lease_lost" || result.outcome === "superseded") {
    throw new CalendarLeaseEndedError(operation, result.outcome);
  }
  if (!accepted.includes(result.outcome)) {
    throw new CalendarMutationRejectedError(operation, result.outcome);
  }
  return result.outcome;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return "Unknown calendar sync error";
}

function errorCode(error: unknown): string {
  if (error instanceof CalendarProviderError) {
    return `${error.provider}_${error.kind}`.slice(0, 100);
  }
  return "calendar_sync_failed";
}

const CALENDAR_WRITE_OPERATIONS = new Set([
  "create event",
  "patch event",
  "annotate event",
  "delete event",
  "scrub event",
]);

/**
 * Once the effect-start marker is durable, ambiguity may only be cleared by a
 * concrete provider rejection of that exact write request. A timeout, 5xx,
 * malformed success, normalization failure, recovery GET, or precondition can
 * all describe a write that the provider accepted.
 */
function effectDefinitelyAbsent(error: unknown): boolean {
  return (
    error instanceof CalendarProviderError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    error.kind !== "precondition" &&
    CALENDAR_WRITE_OPERATIONS.has(error.operation)
  );
}

function retryDelaySeconds(error: unknown, attempts = 1): number {
  if (
    error instanceof CalendarProviderError &&
    error.retryAfterMs !== null
  ) {
    return Math.max(1, Math.min(86_400, Math.ceil(error.retryAfterMs / 1_000)));
  }
  return Math.min(3_600, Math.max(5, 5 * 2 ** Math.min(attempts, 9)));
}

function taskIsEligible(
  task: CalendarTaskRow,
  connection: CalendarConnectionRow,
  now: Date,
): task is CalendarTaskRow & { due_at: string } {
  const dueAt = task.due_at === null ? Number.NaN : Date.parse(task.due_at);
  return (
    task.deleted_at === null &&
    task.due_at !== null &&
    Number.isFinite(dueAt) &&
    dueAt >= now.getTime() - INITIAL_LOOKBACK_DAYS * 86_400_000 &&
    dueAt <= now.getTime() + INITIAL_LOOKAHEAD_DAYS * 86_400_000 &&
    task.assigned_user_id === connection.user_id
  );
}

async function taskSnapshot(
  task: CalendarTaskRow & { due_at: string },
  reference: CalendarScheduleSnapshot | null,
  fallbackTimeZone: string,
): Promise<CalendarScheduleSnapshot> {
  const start = new Date(task.due_at);
  if (!Number.isFinite(start.getTime())) {
    throw new Error("calendar task has an invalid due_at");
  }
  const referenceStart = reference ? new Date(reference.start).getTime() : 0;
  const referenceEnd = reference ? new Date(reference.end).getTime() : 0;
  const duration =
    reference &&
    Number.isFinite(referenceStart) &&
    Number.isFinite(referenceEnd) &&
    referenceEnd > referenceStart
      ? referenceEnd - referenceStart
      : 60 * 60 * 1_000;
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + duration).toISOString(),
    timeZone: reference?.timeZone ?? fallbackTimeZone,
    title: normalizeCalendarText(task.title),
    descriptionHash: await hashCalendarDescription(task.description),
  };
}

function scheduledRemote(remote: CalendarRemoteEvent): CalendarScheduleSnapshot {
  if (remote.inbound.kind !== "scheduled") {
    throw new Error("calendar provider did not return the event just written");
  }
  return remote.inbound.schedule;
}

async function applyInbound(
  store: CalendarSyncStore,
  connection: CalendarConnectionRow,
  link: CalendarLinkRow,
  remote: CalendarRemoteEvent,
  workerId: string,
  outbox?: CalendarOutboxRow,
): Promise<void> {
  switch (remote.inbound.kind) {
    case "scheduled": {
      const result = await store.applyProviderEvent({
        connection,
        link,
        remote,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("apply calendar provider event", result, [
        "echo",
        "push_queued",
        "provider_applied",
        "local_unscheduled",
        "converged",
        "conflict",
        "unlink_queued",
        "scrub_queued",
        "refused",
      ]);
      // Provider-side reschedules delete the literal, pre-rendered reminder
      // rows inside the SQL transaction. Rebuild them only after that durable
      // decision succeeds. Retrying this after an interrupted pull is safe and
      // necessary: a converged replay may be the first chance to replace rows
      // deleted by an earlier apply whose worker died before this call.
      if (
        ["echo", "push_queued", "provider_applied", "converged"].includes(
          result.outcome,
        )
      ) {
        await store.refreshTaskReminders({
          companyId: connection.company_id,
          taskId: link.task_id,
          userId: connection.user_id,
        });
      }
      return;
    }
    case "removed": {
      const result = await store.markEventRemoved({
        connection,
        link,
        remote,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar event removed", result, [
        "event_removed",
      ]);
      return;
    }
    case "all_day": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "all_day",
        detail: "Provider event has no honest start instant",
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark all-day calendar refusal", result, [
        "refused",
      ]);
      return;
    }
    case "zone_refused": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "unknown_time_zone",
        detail: remote.inbound.providerZone,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar time-zone refusal", result, [
        "refused",
      ]);
      return;
    }
    case "title_refused": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "invalid_title",
        detail: remote.inbound.reason,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar title refusal", result, [
        "refused",
      ]);
      return;
    }
    case "time_refused": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "invalid_time",
        detail: remote.inbound.reason,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar time refusal", result, [
        "refused",
      ]);
      return;
    }
    case "description_refused": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "description_too_long",
        detail: remote.inbound.reason,
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar description refusal", result, [
        "refused",
      ]);
      return;
    }
    case "recurrence_refused": {
      const result = await store.markRefused({
        connection,
        link,
        remote,
        code: "recurrence",
        detail: "Provider event became a recurring series",
        workerId,
        ...(outbox ? { outbox } : {}),
      });
      expectMutationOutcome("mark calendar recurrence refusal", result, [
        "refused",
      ]);
      return;
    }
  }
}

function removedProviderObservation(
  link: CalendarLinkRow,
  version: string | null = link.provider_version,
): CalendarRemoteEvent {
  return {
    instanceId: link.provider_instance_id,
    version,
    inbound: { kind: "removed" },
    description: "",
    descriptionFormat: "text",
    hasAttendees: false,
    hasOnlineMeeting: false,
    organizerEmail: null,
    organizerIsConnectedAccount: false,
    webUrl: null,
  };
}

async function reconcileObservedOutbox(
  deps: CalendarWorkerDependencies,
  connection: CalendarConnectionRow,
  outbox: CalendarOutboxRow,
  link: CalendarLinkRow,
  remote: CalendarRemoteEvent,
): Promise<void> {
  await applyInbound(
    deps.store,
    connection,
    link,
    remote,
    deps.workerId!,
    outbox,
  );
  // Removal/refusal RPCs retire the leased intent themselves. A scheduled
  // observation instead re-decides the three-way state, after which retry
  // releases or supersedes the old generation without replaying its body.
  if (remote.inbound.kind !== "scheduled") return;
  const retried = await deps.store.retryOutbox({
    outbox,
    workerId: deps.workerId!,
    delaySeconds: 1,
    errorCode: "provider_precondition_reconciled",
    errorDetail: "Provider event was re-read and re-decided",
    requiresReauth: false,
    effectDefinitelyAbsent: false,
  });
  expectMutationOutcome("retry reconciled calendar outbox", retried, [
    "queued",
  ]);
}

async function reconcilePrecondition(
  deps: CalendarWorkerDependencies,
  connection: CalendarConnectionRow,
  outbox: CalendarOutboxRow,
  link: CalendarLinkRow,
  authorized: CalendarAuthorizedProvider,
): Promise<void> {
  let remote: CalendarRemoteEvent;
  try {
    remote = await authorized.provider.getEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      instanceId: link.provider_instance_id,
      calendarTimeZone: connection.selected_calendar_timezone,
      connectedAccountEmail: connection.provider_account_id,
    });
  } catch (error) {
    if (!(error instanceof CalendarProviderError) || error.kind !== "not_found") {
      throw error;
    }
    remote = removedProviderObservation(link);
  }
  await reconcileObservedOutbox(deps, connection, outbox, link, remote);
}

async function processScrubOutbox(
  deps: CalendarWorkerDependencies,
  connection: CalendarConnectionRow,
  outbox: CalendarOutboxRow,
  link: CalendarLinkRow,
  authorized: CalendarAuthorizedProvider,
): Promise<void> {
  let current: CalendarRemoteEvent;
  try {
    current = await authorized.provider.getEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      instanceId: link.provider_instance_id,
      calendarTimeZone: connection.selected_calendar_timezone,
      connectedAccountEmail: connection.provider_account_id,
    });
  } catch (error) {
    if (!(error instanceof CalendarProviderError) || error.kind !== "not_found") {
      throw error;
    }
    const committed = await deps.store.commitScrubbed({
      outbox,
      workerId: deps.workerId!,
      providerVersion: null,
      providerDeleted: true,
    });
    expectMutationOutcome("commit missing calendar event scrub", committed, [
      "committed",
      "followup_queued",
    ]);
    return;
  }

  if (current.inbound.kind === "removed") {
    const committed = await deps.store.commitScrubbed({
      outbox,
      workerId: deps.workerId!,
      providerVersion: null,
      providerDeleted: true,
    });
    expectMutationOutcome("commit removed calendar event scrub", committed, [
      "committed",
      "followup_queued",
    ]);
    return;
  }
  if (
    authorized.provider.name === "microsoft" &&
    (current.hasAttendees || current.hasOnlineMeeting)
  ) {
    // Graph existing-event mutations can send meeting updates, and its Teams
    // join/session blob lives inside the body. There is no safe provider write
    // that both removes copied customer text and proves participation survives.
    // Terminalize through the durable cleanup-failed lifecycle rather than
    // retrying forever or pretending the remote copy was removed.
    const abandoned = await deps.store.abandonCleanup({
      outbox,
      workerId: deps.workerId!,
      errorCode: "unsafe_provider_meeting",
      errorDetail:
        "Microsoft event has participants or an online meeting; remote cleanup was not attempted",
    });
    expectMutationOutcome("abandon unsafe Microsoft calendar cleanup", abandoned, [
      "cleanup_abandoned",
    ]);
    return;
  }
  if (!current.version) {
    throw new Error("calendar scrub requires a current provider version");
  }

  const started = await deps.store.markProviderEffectStarted({
    outbox,
    workerId: deps.workerId!,
  });
  expectMutationOutcome("mark calendar scrub effect started", started, [
    "marked",
  ]);

  // Deleting an attendee-free event owned by the connected account cannot
  // cancel a meeting for anyone else. Received/provider-augmented meetings are
  // instead neutralized in place so access revocation removes copied customer
  // content without sending a cancellation or altering participation.
  if (
    current.organizerIsConnectedAccount &&
    !current.hasAttendees &&
    !current.hasOnlineMeeting
  ) {
    await authorized.provider.deleteEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      instanceId: link.provider_instance_id,
      version: current.version,
      calendarTimeZone: connection.selected_calendar_timezone,
      connectedAccountEmail: connection.provider_account_id,
    });
    const committed = await deps.store.commitScrubbed({
      outbox,
      workerId: deps.workerId!,
      providerVersion: null,
      providerDeleted: true,
    });
    expectMutationOutcome("commit deleted calendar event scrub", committed, [
      "committed",
      "followup_queued",
    ]);
    return;
  }

  const scrubbed = await authorized.provider.scrubEvent({
    accessToken: authorized.accessToken,
    calendarId: connection.selected_calendar_id,
    instanceId: link.provider_instance_id,
    version: current.version,
    calendarTimeZone: connection.selected_calendar_timezone,
    connectedAccountEmail: connection.provider_account_id,
  });
  const committed = await deps.store.commitScrubbed({
    outbox,
    workerId: deps.workerId!,
    providerVersion: scrubbed.version,
    providerDeleted: false,
  });
  expectMutationOutcome("commit neutralized calendar event scrub", committed, [
    "committed",
    "followup_queued",
  ]);
}

async function processOutbox(
  deps: CalendarWorkerDependencies,
  outbox: CalendarOutboxRow,
): Promise<void> {
  const connection = await deps.store.getConnection(outbox.connection_id);
  if (!connection) {
    const cancelled = await deps.store.cancelOutbox({
      outbox,
      workerId: deps.workerId!,
      reason: "Calendar connection no longer exists",
    });
    expectMutationOutcome("cancel missing-connection calendar outbox", cancelled, [
      "cancelled",
    ]);
    return;
  }
  const task = await deps.store.getTask(outbox.task_id);
  if (!task) {
    const cancelled = await deps.store.cancelOutbox({
      outbox,
      workerId: deps.workerId!,
      reason: "Task no longer exists",
    });
    expectMutationOutcome("cancel missing-task calendar outbox", cancelled, [
      "cancelled",
    ]);
    return;
  }

  const link = outbox.link_id
    ? await deps.store.getLink(outbox.link_id)
    : null;
  const eligible = taskIsEligible(task, connection, deps.now!);
  const recoveringAmbiguousCreate =
    outbox.action === "create" && outbox.provider_effect_ambiguous;

  // Before the provider-effect boundary an ineligible create is safe to
  // cancel. After that boundary the event may already exist: replay its stable
  // create identity/body to recover the mapping, then let commit-created queue
  // an unlink from current task truth.
  if (!eligible && outbox.action === "create" && !recoveringAmbiguousCreate) {
    const cancelled = await deps.store.cancelOutbox({
      outbox,
      workerId: deps.workerId!,
      reason: "Task is no longer eligible for this member calendar",
    });
    expectMutationOutcome("cancel ineligible calendar create", cancelled, [
      "cancelled",
    ]);
    return;
  }
  if (outbox.action !== "create" && !link) {
    const cancelled = await deps.store.cancelOutbox({
      outbox,
      workerId: deps.workerId!,
      reason: "Calendar event mapping no longer exists",
    });
    expectMutationOutcome("cancel unmapped calendar outbox", cancelled, [
      "cancelled",
    ]);
    return;
  }

  const authorized = await deps.authorize(connection);

  if (outbox.action === "scrub") {
    await processScrubOutbox(deps, connection, outbox, link!, authorized);
    return;
  }

  if (
    outbox.action !== "create" &&
    (!eligible || outbox.action === "unlink")
  ) {
    let current: CalendarRemoteEvent;
    try {
      current = await authorized.provider.getEvent({
        accessToken: authorized.accessToken,
        calendarId: connection.selected_calendar_id,
        instanceId: link!.provider_instance_id,
        calendarTimeZone: connection.selected_calendar_timezone,
        connectedAccountEmail: connection.provider_account_id,
        preserveDescriptionFormatting:
          authorized.provider.name === "microsoft",
      });
    } catch (error) {
      if (!(error instanceof CalendarProviderError) || error.kind !== "not_found") {
        throw error;
      }
      const committed = await deps.store.commitSent({
        outbox,
        workerId: deps.workerId!,
        providerVersion: null,
        sent: null,
        description: null,
      });
      expectMutationOutcome("commit missing calendar unlink", committed, [
        "committed",
        "followup_checked",
      ]);
      return;
    }
    if (current.inbound.kind === "removed") {
      const committed = await deps.store.commitSent({
        outbox,
        workerId: deps.workerId!,
        providerVersion: current.version,
        sent: null,
        description: null,
      });
      expectMutationOutcome("commit removed calendar unlink", committed, [
        "committed",
        "followup_checked",
      ]);
      return;
    }
    if (!current.version) {
      throw new Error("calendar unlink requires a current provider version");
    }
    if (
      authorized.provider.name === "microsoft" &&
      (current.hasAttendees || current.hasOnlineMeeting)
    ) {
      // Annotating a Graph event can notify attendees and rewriting its body
      // can disable a Teams meeting. Ordinary unlink is local-only here;
      // access/offboarding removal uses the distinct scrub action above and
      // its explicit cleanup-failed disclosure.
      const committed = await deps.store.commitSent({
        outbox,
        workerId: deps.workerId!,
        providerVersion: current.version,
        sent: null,
        description: null,
      });
      expectMutationOutcome("commit unsafe Microsoft calendar unlink", committed, [
        "committed",
        "followup_checked",
      ]);
      return;
    }
    try {
      const started = await deps.store.markProviderEffectStarted({
        outbox,
        workerId: deps.workerId!,
      });
      expectMutationOutcome("mark calendar unlink effect started", started, [
        "marked",
      ]);
      const remote = await authorized.provider.annotateAndUnlink({
        accessToken: authorized.accessToken,
        calendarId: connection.selected_calendar_id,
        instanceId: link!.provider_instance_id,
        version: current.version,
        currentDescription: current.rawDescription ?? current.description,
        descriptionFormat: current.descriptionFormat,
        note: UNLINK_NOTE,
        calendarTimeZone: connection.selected_calendar_timezone,
        connectedAccountEmail: connection.provider_account_id,
      });
      const committed = await deps.store.commitSent({
        outbox,
        workerId: deps.workerId!,
        providerVersion: remote.version,
        sent: null,
        description: null,
      });
      expectMutationOutcome("commit calendar unlink", committed, [
        "committed",
        "followup_checked",
      ]);
    } catch (error) {
      if (error instanceof CalendarProviderError && error.kind === "precondition") {
        await reconcilePrecondition(deps, connection, outbox, link!, authorized);
        return;
      }
      throw error;
    }
    return;
  }

  let sent: CalendarScheduleSnapshot | null;
  if (recoveringAmbiguousCreate) {
    sent = outbox.requested_snapshot;
  } else {
    if (!eligible) {
      throw new Error("ineligible calendar write reached provider boundary");
    }
    sent = await taskSnapshot(
      task,
      link?.base_snapshot ?? null,
      connection.selected_calendar_timezone,
    );
  }
  if (!sent) {
    throw new Error("ambiguous calendar create lost its requested snapshot");
  }
  if (outbox.action === "create") {
    const started = await deps.store.markProviderEffectStarted({
      outbox,
      workerId: deps.workerId!,
    });
    expectMutationOutcome("mark calendar create effect started", started, [
      "marked",
    ]);
    const remote = await authorized.provider.createEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      // The durable row id survives retries and generation bumps. Provider
      // idempotency must not include attempts/generation or an accepted create
      // whose response was lost could be repeated under a new identity.
      idempotencyKey: outbox.id,
      schedule: sent,
      description: normalizeCalendarText(task.description),
      connectedAccountEmail: connection.provider_account_id,
    });
    const created = scheduledRemote(remote);
    const committed = await deps.store.commitCreated({
      outbox,
      workerId: deps.workerId!,
      remote,
      // On a retry, Google may recover an already-created event with GET. Its
      // snapshot can predate a newer outbox generation, so commit what the
      // provider actually holds; the atomic RPC compares current task truth
      // and queues the required follow-up update.
      sent: created,
      description: remote.description,
    });
    expectMutationOutcome("commit calendar event creation", committed, [
      "committed",
      "followup_queued",
    ]);
    return;
  }

  if (!link?.provider_version) {
    throw new Error("calendar update requires a stored provider version");
  }
  let current: CalendarRemoteEvent;
  try {
    current = await authorized.provider.getEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      instanceId: link.provider_instance_id,
      calendarTimeZone: connection.selected_calendar_timezone,
      connectedAccountEmail: connection.provider_account_id,
    });
  } catch (error) {
    if (!(error instanceof CalendarProviderError) || error.kind !== "not_found") {
      throw error;
    }
    current = removedProviderObservation(link);
  }
  if (current.inbound.kind !== "scheduled") {
    await reconcileObservedOutbox(deps, connection, outbox, link, current);
    return;
  }
  if (!current.version) {
    throw new Error("calendar update preflight requires a provider version");
  }
  if (
    current.hasAttendees ||
    (authorized.provider.name === "microsoft" && current.hasOnlineMeeting)
  ) {
    const refused = await deps.store.markRefused({
      connection,
      link,
      remote: current,
      code: "unsafe_meeting",
      detail: current.hasAttendees
        ? "Provider event has participants"
        : "Microsoft event is an online meeting",
      workerId: deps.workerId!,
      outbox,
    });
    expectMutationOutcome("refuse unsafe calendar update", refused, [
      "refused",
    ]);
    return;
  }
  if (current.version !== link.provider_version) {
    await reconcileObservedOutbox(deps, connection, outbox, link, current);
    return;
  }
  const base = link.base_snapshot;
  const changes = {
    timing:
      !base ||
      sent.start !== base.start ||
      sent.end !== base.end ||
      sent.timeZone !== base.timeZone,
    title: !base || sent.title !== base.title,
    description:
      !base || sent.descriptionHash !== base.descriptionHash,
  };
  if (!changes.timing && !changes.title && !changes.description) {
    const committed = await deps.store.commitSent({
      outbox,
      workerId: deps.workerId!,
      providerVersion: current.version,
      sent,
      description: normalizeCalendarText(task.description),
    });
    expectMutationOutcome("commit unchanged calendar update", committed, [
      "committed",
      "followup_checked",
    ]);
    return;
  }
  try {
    const started = await deps.store.markProviderEffectStarted({
      outbox,
      workerId: deps.workerId!,
    });
    expectMutationOutcome("mark calendar update effect started", started, [
      "marked",
    ]);
    const remote = await authorized.provider.patchEvent({
      accessToken: authorized.accessToken,
      calendarId: connection.selected_calendar_id,
      instanceId: link.provider_instance_id,
      version: current.version,
      schedule: sent,
      description: normalizeCalendarText(task.description),
      changes,
      connectedAccountEmail: connection.provider_account_id,
    });
    scheduledRemote(remote);
    const committed = await deps.store.commitSent({
      outbox,
      workerId: deps.workerId!,
      providerVersion: remote.version,
      sent,
      description: normalizeCalendarText(task.description),
    });
    expectMutationOutcome("commit calendar event update", committed, [
      "committed",
      "followup_checked",
    ]);
  } catch (error) {
    if (error instanceof CalendarProviderError && error.kind === "precondition") {
      await reconcilePrecondition(deps, connection, outbox, link, authorized);
      return;
    }
    if (error instanceof CalendarProviderError && error.kind === "not_found") {
      await reconcileObservedOutbox(
        deps,
        connection,
        outbox,
        link,
        removedProviderObservation(link),
      );
      return;
    }
    throw error;
  }
}

async function stopWatchBestEffort(
  authorized: CalendarAuthorizedProvider,
  subscriptionId: string,
  resourceId: string | null,
): Promise<void> {
  if (authorized.provider.name === "google" && !resourceId) return;
  try {
    await authorized.provider.stopWatch({
      accessToken: authorized.accessToken,
      subscriptionId,
      ...(resourceId ? { resourceId } : {}),
    });
  } catch {
    // Once its client-state hash is absent from Postgres, this remote watch is
    // no longer an authenticated capability and can safely expire on its own.
  }
}

async function processWebhookRevocation(
  deps: CalendarWorkerDependencies,
  subscription: CalendarWebhookSubscriptionRow,
): Promise<void> {
  const connection = await deps.store.getConnection(subscription.connection_id);
  if (!connection) {
    throw new Error("calendar revocation connection no longer exists");
  }
  const authorized = await deps.authorize(connection);
  await authorized.provider.stopWatch({
    accessToken: authorized.accessToken,
    subscriptionId: subscription.provider_subscription_id,
    ...(subscription.provider_resource_id
      ? { resourceId: subscription.provider_resource_id }
      : {}),
  });
  const committed = await deps.store.commitWebhookRevocation({
    subscription,
    workerId: deps.workerId!,
  });
  expectMutationOutcome("commit calendar webhook revocation", committed, [
    "revoked",
  ]);
}

async function processWebhookRenewal(
  deps: CalendarWorkerDependencies,
  subscription: CalendarWebhookSubscriptionRow,
): Promise<void> {
  const connection = await deps.store.getConnection(subscription.connection_id);
  if (!connection) throw new Error("calendar renewal connection no longer exists");
  if (!deps.webhookCallbackUrl) {
    throw new Error("calendar renewal callback URL is not configured");
  }

  const authorized = await deps.authorize(connection);
  const clientState = generateToken();
  const requestedExpiration = new Date(
    deps.now!.getTime() +
      (connection.provider === "google" ? 6 : 2) * 86_400_000,
  ).toISOString();

  // Both providers receive a replacement watch. Graph PATCH cannot rotate its
  // client state, while a replacement lets the database switch the remote id
  // and digest atomically before the old capability is stopped.
  const replacement = await authorized.provider.startWatch({
    accessToken: authorized.accessToken,
    calendarId: connection.selected_calendar_id,
    callbackUrl: deps.webhookCallbackUrl(connection.provider),
    subscriptionId: crypto.randomUUID(),
    clientState,
    expiration: requestedExpiration,
  });
  if (replacement.subscriptionId === subscription.provider_subscription_id) {
    throw new Error("calendar provider did not create a replacement watch");
  }
  const expiresAt = replacement.expiration ?? requestedExpiration;
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration) || expiration <= deps.now!.getTime()) {
    await stopWatchBestEffort(
      authorized,
      replacement.subscriptionId,
      replacement.resourceId,
    );
    throw new Error("calendar replacement watch has an invalid expiration");
  }

  const commit = await deps.store.commitWebhookRenewal({
    subscription,
    workerId: deps.workerId!,
    providerSubscriptionId: replacement.subscriptionId,
    providerResourceId: replacement.resourceId,
    clientStateHash: await hashToken(clientState),
    expiresAt,
  });

  if (commit.outcome !== "committed") {
    await stopWatchBestEffort(
      authorized,
      replacement.subscriptionId,
      replacement.resourceId,
    );
    if (
      commit.outcome === "lease_lost" ||
      commit.outcome === "superseded" ||
      commit.outcome === "connection_inactive" ||
      commit.outcome === "conflict"
    ) {
      return;
    }
    throw new CalendarMutationRejectedError(
      "commit calendar webhook renewal",
      commit.outcome,
    );
  }

  await stopWatchBestEffort(
    authorized,
    subscription.provider_subscription_id,
    subscription.provider_resource_id,
  );
}

async function processPull(
  deps: CalendarWorkerDependencies,
  connection: CalendarConnectionRow,
): Promise<void> {
  const authorized = await deps.authorize(connection);
  const rangeStart = new Date(
    deps.now!.getTime() - INITIAL_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();
  const rangeEnd = new Date(
    deps.now!.getTime() + INITIAL_LOOKAHEAD_DAYS * 86_400_000,
  ).toISOString();

  let cursor = connection.pull_full_sync
    ? undefined
    : (connection.sync_cursor ?? undefined);
  let pageToken: string | undefined;
  let finalCursor: string | null = connection.sync_cursor;
  let restarted = connection.pull_full_sync;
  const seenInstanceIds = new Set<string>();

  for (let pageNumber = 0; pageNumber < MAX_PROVIDER_PAGES; pageNumber += 1) {
    const renewedForPage = await deps.store.renewPullLease({
      connection,
      workerId: deps.workerId!,
      leaseSeconds: LEASE_SECONDS,
    });
    expectMutationOutcome("renew calendar pull lease before provider page", renewedForPage, [
      "renewed",
    ]);
    let page;
    try {
      page = await authorized.provider.listChanges({
        accessToken: authorized.accessToken,
        calendarId: connection.selected_calendar_id,
        calendarTimeZone: connection.selected_calendar_timezone,
        connectedAccountEmail: connection.provider_account_id,
        cursor,
        pageToken,
        // Google page tokens are valid only with the identical timeMin/timeMax
        // query that produced them. Microsoft ignores these once its opaque
        // nextLink is present, so retaining the initial window is safe there.
        ...(!cursor ? { rangeStart, rangeEnd } : {}),
      });
    } catch (error) {
      if (
        error instanceof CalendarProviderError &&
        error.kind === "full_resync" &&
        !restarted
      ) {
        cursor = undefined;
        pageToken = undefined;
        finalCursor = null;
        restarted = true;
        // Rows observed before the expired cursor was rejected are not part of
        // the replacement full-window proof. Keeping them here could make an
        // event absent from the fresh scan look present forever and commit the
        // new cursor without the required direct absence verification.
        seenInstanceIds.clear();
        pageNumber = -1;
        continue;
      }
      throw error;
    }

    for (const notice of page.events) {
      seenInstanceIds.add(notice.instanceId);
      const link = await deps.store.findSyncableLink(
        connection.company_id,
        connection.id,
        notice.instanceId,
      );
      // A general calendar event is not authority to manufacture a task. The
      // connector owns only events which already have a task mapping. Provider
      // delta/list calls intentionally return content-free notices; this check
      // therefore happens before any title, body, attendee, or timing GET.
      if (!link) continue;
      // A page can contain 2,500 notices and many mapped GETs. Renew before
      // each network read so a slow page cannot spend beyond the pull lease
      // and then repeat forever without ever reaching its cursor commit.
      const renewedForVerification = await deps.store.renewPullLease({
        connection,
        workerId: deps.workerId!,
        leaseSeconds: LEASE_SECONDS,
      });
      expectMutationOutcome(
        "renew calendar pull lease before mapped event read",
        renewedForVerification,
        ["renewed"],
      );
      let observation: CalendarRemoteEvent;
      try {
        observation = await authorized.provider.getEvent({
          accessToken: authorized.accessToken,
          calendarId: connection.selected_calendar_id,
          instanceId: notice.instanceId,
          calendarTimeZone: connection.selected_calendar_timezone,
          connectedAccountEmail: connection.provider_account_id,
        });
      } catch (error) {
        if (
          !(error instanceof CalendarProviderError) ||
          error.kind !== "not_found"
        ) {
          throw error;
        }
        // A tombstone may disappear from GET immediately; a non-tombstone may
        // be deleted between the page and this read. Both are the same durable
        // observation once the authenticated GET confirms absence.
        observation = {
          instanceId: notice.instanceId,
          version: notice.version ?? link.provider_version,
          inbound: { kind: "removed" },
          description: "",
          descriptionFormat: "text",
          hasAttendees: false,
          hasOnlineMeeting: false,
          organizerEmail: null,
          organizerIsConnectedAccount: false,
          webUrl: null,
        };
      }
      const renewedForMutation = await deps.store.renewPullLease({
        connection,
        workerId: deps.workerId!,
        leaseSeconds: LEASE_SECONDS,
      });
      expectMutationOutcome(
        "renew calendar pull lease before inbound mutation",
        renewedForMutation,
        ["renewed"],
      );
      await applyInbound(
        deps.store,
        connection,
        link,
        observation,
        deps.workerId!,
      );
    }

    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      continue;
    }
    finalCursor = page.nextCursor;
    if (restarted) {
      const mappedLinks = await deps.store.listSyncableLinks(
        connection.company_id,
        connection.id,
      );
      for (const link of mappedLinks) {
        if (seenInstanceIds.has(link.provider_instance_id)) continue;
        const renewedForVerification = await deps.store.renewPullLease({
          connection,
          workerId: deps.workerId!,
          leaseSeconds: LEASE_SECONDS,
        });
        expectMutationOutcome(
          "renew calendar pull lease before full-sync absence verification",
          renewedForVerification,
          ["renewed"],
        );
        let observation: CalendarRemoteEvent;
        try {
          observation = await authorized.provider.getEvent({
            accessToken: authorized.accessToken,
            calendarId: connection.selected_calendar_id,
            instanceId: link.provider_instance_id,
            calendarTimeZone: connection.selected_calendar_timezone,
            connectedAccountEmail: connection.provider_account_id,
          });
        } catch (error) {
          if (
            !(error instanceof CalendarProviderError) ||
            error.kind !== "not_found"
          ) {
            throw error;
          }
          observation = {
            instanceId: link.provider_instance_id,
            version: link.provider_version,
            inbound: { kind: "removed" },
            description: "",
            descriptionFormat: "text",
            hasAttendees: false,
            hasOnlineMeeting: false,
            organizerEmail: null,
            organizerIsConnectedAccount: false,
            webUrl: null,
          };
        }
        const renewedForMutation = await deps.store.renewPullLease({
          connection,
          workerId: deps.workerId!,
          leaseSeconds: LEASE_SECONDS,
        });
        expectMutationOutcome(
          "renew calendar pull lease before full-sync verification mutation",
          renewedForMutation,
          ["renewed"],
        );
        await applyInbound(
          deps.store,
          connection,
          link,
          observation,
          deps.workerId!,
        );
      }
    }
    const renewedForCommit = await deps.store.renewPullLease({
      connection,
      workerId: deps.workerId!,
      leaseSeconds: LEASE_SECONDS,
    });
    expectMutationOutcome("renew calendar pull lease before commit", renewedForCommit, [
      "renewed",
    ]);
    const committed = await deps.store.commitPull({
      connection,
      workerId: deps.workerId!,
      cursor: finalCursor,
    });
    expectMutationOutcome("commit calendar pull", committed, ["committed"]);
    return;
  }
  throw new Error("calendar provider exceeded the page safety limit");
}

/**
 * Drain one bounded batch from each durable side of calendar sync.
 *
 * Each row owns its failure: provider errors are translated back into the
 * lease RPC before the loop continues. Only a failure to persist that retry is
 * rethrown, because otherwise a healthy tenant could be starved by one revoked
 * account while still making the cron look green.
 */
export async function drainCalendarSync(
  input: CalendarWorkerDependencies,
): Promise<{
  reminderReplans: number;
  ownerDisclosures: number;
  revocations: number;
  renewals: number;
  outbound: number;
  pulls: number;
}> {
  const deps: CalendarWorkerDependencies = {
    ...input,
    now: input.now ?? new Date(),
    workerId: input.workerId ?? crypto.randomUUID(),
  };
  await deps.store.purgeOauthStates(1_000);
  await deps.store.queueStaleOwnerDisclosures(
    new Date(
      deps.now!.getTime() - CALENDAR_VERIFICATION_MAX_AGE_MS,
    ).toISOString(),
    CLAIM_LIMIT,
  );
  const ownerDisclosures = await deps.store.claimOwnerDisclosures(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
  );
  for (const disclosure of ownerDisclosures) {
    try {
      if (!deps.discloseOwner) {
        throw new Error("calendar owner disclosure delivery is not configured");
      }
      await deps.discloseOwner(disclosure);
      const committed = await deps.store.commitOwnerDisclosure({
        disclosure,
        workerId: deps.workerId!,
      });
      expectMutationOutcome("commit calendar owner disclosure", committed, [
        "delivered",
      ]);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryOwnerDisclosure({
        disclosure,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar owner disclosure", retried, [
          "queued",
        ]);
      }
    }
  }
  const reminderReplans = await deps.store.claimReminderReplans(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
  );
  for (const replan of reminderReplans) {
    try {
      await deps.store.refreshTaskReminders({
        companyId: replan.company_id,
        taskId: replan.task_id,
        userId: replan.requester_user_id,
      });
      const completed = await deps.store.completeReminderReplan({
        replan,
        workerId: deps.workerId!,
      });
      expectMutationOutcome("complete calendar reminder replan", completed, [
        "completed",
      ]);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryReminderReplan({
        replan,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error, replan.attempts),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar reminder replan", retried, [
          "queued",
        ]);
      }
    }
  }
  const revocations = await deps.store.claimWebhookRevocations(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
  );
  for (const subscription of revocations) {
    try {
      await processWebhookRevocation(deps, subscription);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryWebhookRevocation({
        subscription,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error, subscription.renewal_attempts),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar webhook revocation", retried, [
          "queued",
          "connection_inactive",
        ]);
      }
    }
  }
  const renewals = await deps.store.claimWebhookRenewals(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
    WEBHOOK_RENEWAL_WINDOW_SECONDS,
  );
  for (const subscription of renewals) {
    try {
      await processWebhookRenewal(deps, subscription);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryWebhookRenewal({
        subscription,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error, subscription.renewal_attempts),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
        requiresReauth: false,
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar webhook renewal", retried, [
          "queued",
          "exhausted",
          "reauth_required",
          "connection_inactive",
        ]);
      }
    }
  }

  const outbox = await deps.store.claimOutbox(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
  );
  for (const row of outbox) {
    try {
      await processOutbox(deps, row);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryOutbox({
        outbox: row,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error, row.attempts),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
        requiresReauth: false,
        effectDefinitelyAbsent:
          !row.provider_effect_ambiguous && effectDefinitelyAbsent(error),
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar outbox", retried, [
          "queued",
        ]);
      }
    }
  }

  const pulls = await deps.store.claimPulls(
    deps.workerId!,
    CLAIM_LIMIT,
    LEASE_SECONDS,
  );
  for (const connection of pulls) {
    try {
      await processPull(deps, connection);
    } catch (error) {
      if (error instanceof CalendarLeaseEndedError) continue;
      const retried = await deps.store.retryPull({
        connection,
        workerId: deps.workerId!,
        delaySeconds: retryDelaySeconds(error),
        errorCode: errorCode(error),
        errorDetail: errorDetail(error),
        requiresReauth: false,
      });
      if (
        retried.outcome !== "lease_lost" &&
        retried.outcome !== "superseded"
      ) {
        expectMutationOutcome("retry calendar pull", retried, ["queued"]);
      }
    }
  }
  return {
    reminderReplans: reminderReplans.length,
    ownerDisclosures: ownerDisclosures.length,
    revocations: revocations.length,
    renewals: renewals.length,
    outbound: outbox.length,
    pulls: pulls.length,
  };
}

function rpcError(name: string, error: { message: string } | null): void {
  if (error) throw new Error(`${name}: ${error.message}`);
}

export function createCalendarSyncStore(db: SupabaseClient): CalendarSyncStore {
  const one = async <T>(
    table: string,
    filters: Readonly<Record<string, string>>,
  ): Promise<T | null> => {
    let query = db.from(table).select("*");
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query.maybeSingle();
    rpcError(`read ${table}`, error);
    return data as T | null;
  };
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<CalendarMutationResult> => {
    const { data, error } = await db.rpc(name, args);
    rpcError(name, error);
    if (
      typeof data !== "object" ||
      data === null ||
      !("outcome" in data) ||
      typeof data.outcome !== "string"
    ) {
      throw new Error(`${name}: missing mutation outcome`);
    }
    return data as CalendarMutationResult;
  };
  return {
    async purgeOauthStates(limit) {
      const { data, error } = await db.rpc("api_purge_calendar_oauth_states", {
        p_limit: limit,
      });
      rpcError("api_purge_calendar_oauth_states", error);
      if (!Number.isSafeInteger(data) || (data as number) < 0) {
        throw new Error(
          "api_purge_calendar_oauth_states: missing non-negative count",
        );
      }
      return data as number;
    },
    async queueStaleOwnerDisclosures(staleBefore, limit) {
      const { data, error } = await db.rpc(
        "api_queue_stale_calendar_owner_disclosures",
        {
          p_stale_before: staleBefore,
          p_limit: limit,
        },
      );
      rpcError("api_queue_stale_calendar_owner_disclosures", error);
      if (!Number.isSafeInteger(data) || (data as number) < 0) {
        throw new Error(
          "api_queue_stale_calendar_owner_disclosures: missing non-negative count",
        );
      }
      return data as number;
    },
    async claimOwnerDisclosures(workerId, limit, leaseSeconds) {
      const { data, error } = await db.rpc(
        "api_claim_calendar_owner_disclosures",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        },
      );
      rpcError("api_claim_calendar_owner_disclosures", error);
      return (data ?? []) as CalendarOwnerDisclosureRow[];
    },
    commitOwnerDisclosure: (input) =>
      call("api_commit_calendar_owner_disclosure", {
        p_connection_id: input.disclosure.connection_id,
        p_worker_id: input.workerId,
        p_generation: input.disclosure.generation,
      }),
    retryOwnerDisclosure: (input) =>
      call("api_retry_calendar_owner_disclosure", {
        p_connection_id: input.disclosure.connection_id,
        p_worker_id: input.workerId,
        p_generation: input.disclosure.generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
      }),
    async claimReminderReplans(workerId, limit, leaseSeconds) {
      const { data, error } = await db.rpc(
        "api_claim_calendar_reminder_replans",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        },
      );
      rpcError("api_claim_calendar_reminder_replans", error);
      return (data ?? []) as CalendarReminderReplanRow[];
    },
    completeReminderReplan: ({ replan, workerId }) =>
      call("api_complete_calendar_reminder_replan", {
        p_replan_id: replan.id,
        p_worker_id: workerId,
        p_generation: replan.generation,
      }),
    retryReminderReplan: (input) =>
      call("api_retry_calendar_reminder_replan", {
        p_replan_id: input.replan.id,
        p_worker_id: input.workerId,
        p_generation: input.replan.generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
      }),
    async claimWebhookRenewals(workerId, limit, leaseSeconds, withinSeconds) {
      const { data, error } = await db.rpc(
        "api_claim_calendar_webhook_renewals",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
          p_within_seconds: withinSeconds,
        },
      );
      rpcError("api_claim_calendar_webhook_renewals", error);
      return (data ?? []) as CalendarWebhookSubscriptionRow[];
    },
    async claimWebhookRevocations(workerId, limit, leaseSeconds) {
      const { data, error } = await db.rpc(
        "api_claim_calendar_webhook_revocations",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        },
      );
      rpcError("api_claim_calendar_webhook_revocations", error);
      return (data ?? []) as CalendarWebhookSubscriptionRow[];
    },
    async claimOutbox(workerId, limit, leaseSeconds) {
      const { data, error } = await db.rpc("api_claim_calendar_outbox", {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      rpcError("api_claim_calendar_outbox", error);
      return (data ?? []) as CalendarOutboxRow[];
    },
    markProviderEffectStarted: ({ outbox, workerId }) =>
      call("api_mark_calendar_outbox_effect_started", {
        p_outbox_id: outbox.id,
        p_worker_id: workerId,
        p_generation: outbox.generation,
      }),
    async claimPulls(workerId, limit, leaseSeconds) {
      const { data, error } = await db.rpc("api_claim_due_calendar_pulls", {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      rpcError("api_claim_due_calendar_pulls", error);
      return (data ?? []) as CalendarConnectionRow[];
    },
    renewPullLease: (input) =>
      call("api_renew_calendar_pull_lease", {
        p_connection_id: input.connection.id,
        p_worker_id: input.workerId,
        p_generation: input.connection.pull_generation,
        p_lease_seconds: input.leaseSeconds,
      }),
    getConnection: (id) => one("calendar_connections", { id }),
    getTask: (id) => one("tasks", { id }),
    getLink: (id) => one("task_calendar_links", { id }),
    async findSyncableLink(companyId, connectionId, providerInstanceId) {
      const { data, error } = await db
        .from("task_calendar_links")
        .select("*")
        .eq("company_id", companyId)
        .eq("connection_id", connectionId)
        .eq("provider_instance_id", providerInstanceId)
        // Attention is recoverable state, not an unlink. A later valid provider
        // observation must reach the apply RPC so it can converge or re-flag.
        .neq("link_state", "unlinked")
        .maybeSingle();
      rpcError("read syncable calendar link", error);
      return data as CalendarLinkRow | null;
    },
    async listSyncableLinks(companyId, connectionId) {
      const links: CalendarLinkRow[] = [];
      let afterId: string | null = null;
      for (;;) {
        let query = db
          .from("task_calendar_links")
          .select("*")
          .eq("company_id", companyId)
          .eq("connection_id", connectionId)
          .neq("link_state", "unlinked")
          .order("id", { ascending: true })
          .limit(LINK_VERIFICATION_PAGE_SIZE);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        rpcError("list syncable calendar links", error);
        const page = (data ?? []) as CalendarLinkRow[];
        links.push(...page);
        if (page.length < LINK_VERIFICATION_PAGE_SIZE) return links;
        afterId = page.at(-1)!.id;
      }
    },
    async refreshTaskReminders(input) {
      await regenerateTaskReminders(db, input);
    },
    async claimCredentialRefresh(input) {
      const { data, error } = await db.rpc(
        "api_claim_calendar_credential_refresh",
        {
          p_company_id: input.connection.company_id,
          p_connection_id: input.connection.id,
          p_user_id: input.connection.user_id,
          p_worker_id: input.workerId,
          p_expected_generation: input.connection.credential_generation,
          p_lease_seconds: input.leaseSeconds,
        },
      );
      rpcError("api_claim_calendar_credential_refresh", error);
      if (
        typeof data !== "object" ||
        data === null ||
        !("outcome" in data) ||
        typeof data.outcome !== "string"
      ) {
        throw new Error(
          "api_claim_calendar_credential_refresh: missing mutation outcome",
        );
      }
      return data as CalendarCredentialClaimResult;
    },
    commitCredentialRefresh: (input) =>
      call("api_commit_calendar_credential_refresh", {
        p_connection_id: input.connectionId,
        p_worker_id: input.workerId,
        p_expected_generation: input.expectedGeneration,
        p_credential_ciphertext: input.credential.ciphertext,
        p_credential_iv: input.credential.iv,
        p_credential_key_version: input.credential.keyVersion,
      }) as Promise<CalendarCredentialMutationResult>,
    retryCredentialRefresh: (input) =>
      call("api_retry_calendar_credential_refresh", {
        p_connection_id: input.connectionId,
        p_worker_id: input.workerId,
        p_expected_generation: input.expectedGeneration,
        p_requires_reauth: input.requiresReauth,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
      }) as Promise<CalendarCredentialMutationResult>,
    commitCreated: ({ outbox, workerId, remote, sent, description }) =>
      call("api_commit_calendar_outbox_created", {
        p_outbox_id: outbox.id,
        p_worker_id: workerId,
        p_generation: outbox.generation,
        p_provider_event_id: remote.instanceId,
        p_provider_instance_id: remote.instanceId,
        p_provider_series_id: null,
        p_provider_version: remote.version,
        p_start_at: sent.start,
        p_end_at: sent.end,
        p_time_zone: sent.timeZone,
        p_title: sent.title,
        p_description: description,
      }),
    commitSent: ({
      outbox,
      workerId,
      providerVersion,
      sent,
      description,
    }) =>
      call("api_commit_calendar_outbox_sent", {
        p_outbox_id: outbox.id,
        p_worker_id: workerId,
        p_generation: outbox.generation,
        p_provider_version: providerVersion,
        p_start_at: sent?.start ?? null,
        p_end_at: sent?.end ?? null,
        p_time_zone: sent?.timeZone ?? null,
        p_title: sent?.title ?? null,
        p_description: description,
      }),
    commitScrubbed: ({
      outbox,
      workerId,
      providerVersion,
      providerDeleted,
    }) =>
      call("api_commit_calendar_outbox_scrubbed", {
        p_outbox_id: outbox.id,
        p_worker_id: workerId,
        p_generation: outbox.generation,
        p_provider_version: providerVersion,
        p_provider_deleted: providerDeleted,
      }),
    abandonCleanup: (input) =>
      call("api_abandon_calendar_cleanup", {
        p_outbox_id: input.outbox.id,
        p_worker_id: input.workerId,
        p_generation: input.outbox.generation,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
      }),
    applyProviderEvent: ({ connection, link, remote, workerId, outbox }) => {
      const schedule = scheduledRemote(remote);
      return call("api_apply_calendar_provider_snapshot", {
        p_company_id: connection.company_id,
        p_connection_id: connection.id,
        p_worker_id: workerId,
        p_pull_generation: outbox ? null : connection.pull_generation,
        p_task_id: link.task_id,
        p_provider_event_id: link.provider_event_id,
        p_provider_instance_id: link.provider_instance_id,
        p_provider_series_id: link.provider_series_id,
        p_provider_version: remote.version,
        p_start_at: schedule.start,
        p_end_at: schedule.end,
        p_time_zone: schedule.timeZone,
        p_title: schedule.title,
        p_description: remote.description,
        p_outbox_id: outbox?.id ?? null,
        p_outbox_generation: outbox?.generation ?? null,
        // Teams injects an opaque meeting/session blob into the Graph body.
        // The normalized plain-text projection must never replace the task's
        // user-authored description, while time/title remain syncable.
        p_preserve_description:
          connection.provider === "microsoft" && remote.hasOnlineMeeting,
      });
    },
    markEventRemoved: ({ connection, link, remote, workerId, outbox }) =>
      call("api_mark_calendar_event_removed", {
        p_company_id: connection.company_id,
        p_connection_id: connection.id,
        p_worker_id: workerId,
        p_pull_generation: outbox ? null : connection.pull_generation,
        p_task_id: link.task_id,
        p_provider_instance_id: link.provider_instance_id,
        p_provider_version: remote.version,
        p_outbox_id: outbox?.id ?? null,
        p_outbox_generation: outbox?.generation ?? null,
      }),
    markRefused: ({
      connection,
      link,
      remote,
      code,
      detail,
      workerId,
      outbox,
    }) =>
      call("api_mark_calendar_refusal", {
        p_company_id: connection.company_id,
        p_connection_id: connection.id,
        p_worker_id: workerId,
        p_pull_generation: outbox ? null : connection.pull_generation,
        p_task_id: link.task_id,
        p_provider_instance_id: link.provider_instance_id,
        p_provider_version: remote.version,
        p_refusal_code: code,
        p_refusal_detail: detail,
        // A refusal caused by an all-day value, an unknown zone, or malformed
        // timing has no trustworthy instant. Keeping the former due_at would
        // expose a stale schedule outside the held reminder/list surfaces.
        // An invalid title is the only refusal that leaves timing trustworthy.
        p_clear_due: [
          "all_day",
          "unknown_time_zone",
          "invalid_time",
          "recurrence",
        ].includes(code),
        p_outbox_id: outbox?.id ?? null,
        p_outbox_generation: outbox?.generation ?? null,
      }),
    retryOutbox: (input) =>
      call("api_retry_calendar_outbox", {
        p_outbox_id: input.outbox.id,
        p_worker_id: input.workerId,
        p_generation: input.outbox.generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
        p_requires_reauth: input.requiresReauth,
        p_effect_definitely_absent: input.effectDefinitelyAbsent,
      }),
    cancelOutbox: (input) =>
      call("api_cancel_calendar_outbox", {
        p_outbox_id: input.outbox.id,
        p_worker_id: input.workerId,
        p_generation: input.outbox.generation,
        p_reason: input.reason,
      }),
    commitPull: (input) =>
      call("api_commit_calendar_pull", {
        p_connection_id: input.connection.id,
        p_worker_id: input.workerId,
        p_generation: input.connection.pull_generation,
        p_sync_cursor: input.cursor,
      }),
    retryPull: (input) =>
      call("api_retry_calendar_pull", {
        p_connection_id: input.connection.id,
        p_worker_id: input.workerId,
        p_generation: input.connection.pull_generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
        p_requires_reauth: input.requiresReauth,
      }),
    commitWebhookRenewal: (input) =>
      call("api_commit_calendar_webhook_renewal", {
        p_subscription_row_id: input.subscription.id,
        p_worker_id: input.workerId,
        p_generation: input.subscription.renewal_generation,
        p_provider_subscription_id: input.providerSubscriptionId,
        p_provider_resource_id: input.providerResourceId,
        p_client_state_hash: input.clientStateHash,
        p_expires_at: input.expiresAt,
      }),
    retryWebhookRenewal: (input) =>
      call("api_retry_calendar_webhook_renewal", {
        p_subscription_row_id: input.subscription.id,
        p_worker_id: input.workerId,
        p_generation: input.subscription.renewal_generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
        p_requires_reauth: input.requiresReauth,
      }),
    commitWebhookRevocation: (input) =>
      call("api_commit_calendar_webhook_revocation", {
        p_subscription_row_id: input.subscription.id,
        p_worker_id: input.workerId,
        p_generation: input.subscription.renewal_generation,
      }),
    retryWebhookRevocation: (input) =>
      call("api_retry_calendar_webhook_revocation", {
        p_subscription_row_id: input.subscription.id,
        p_worker_id: input.workerId,
        p_generation: input.subscription.renewal_generation,
        p_delay_seconds: input.delaySeconds,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail,
      }),
  };
}

export function calendarAuthorizer(
  env: Env,
  store: CalendarSyncStore,
  workerId: string,
): CalendarWorkerDependencies["authorize"] {
  const cache = new Map<string, Promise<CalendarAuthorizedProvider>>();
  return (connection) => {
    const existing = cache.get(connection.id);
    if (existing) return existing;
    const result = authorizeCalendarConnection({
      env,
      store,
      connection,
      workerId,
      leaseSeconds: LEASE_SECONDS,
    });
    cache.set(connection.id, result);
    return result;
  };
}

export function calendarOwnerDisclosurePayload(
  reason: CalendarOwnerDisclosureRow["reason"],
  locale: "en" | "fr-CA",
  appOrigin: string,
) {
  const french = locale === "fr-CA";
  if (reason === "cleanup_failed") {
    return {
      title: french
        ? "Le nettoyage du calendrier doit être vérifié"
        : "Calendar cleanup needs review",
      body: french
        ? "Loonext a déconnecté ce calendrier, mais n'a pas pu confirmer la suppression des anciennes données Loonext chez le fournisseur. Vérifiez ce calendrier et ses accès."
        : "Loonext disconnected this calendar but could not confirm removal of old Loonext data at the provider. Review that calendar and its access.",
      url: `${appOrigin}/settings/profile`,
    };
  }
  return {
    title: french
      ? "Votre calendrier doit être vérifié"
      : "Your calendar needs attention",
    body: reason === "reauth_required"
      ? french
        ? "Reconnectez votre calendrier dans Loonext pour reprendre la synchronisation et les rappels en attente."
        : "Reconnect your calendar in Loonext to resume sync and held reminders."
      : french
        ? "La synchronisation du calendrier n'a pas été vérifiée récemment. Les rappels restent en attente jusqu'à une nouvelle vérification."
        : "Calendar sync has not been verified recently. Reminders stay held until it is verified again.",
    url: `${appOrigin}/settings/profile`,
  };
}

async function discloseCalendarOwner(
  env: Env,
  db: SupabaseClient,
  disclosure: CalendarOwnerDisclosureRow,
): Promise<void> {
  const failures: unknown[] = [];
  await deliverPush(env, db, {
    category: "operational",
    companyId: disclosure.company_id,
    userIds: [disclosure.user_id],
    content: { written: "us" },
    collapseKey:
      `calendar-connection:${disclosure.connection_id}:${disclosure.generation}`,
    failures,
    web: (locale) =>
      calendarOwnerDisclosurePayload(
        disclosure.reason,
        locale,
        env.APP_ORIGIN,
      ),
  });
  if (failures.length > 0) {
    throw new Error(
      `calendar owner disclosure failed on ${failures.length} delivery target(s)`,
    );
  }
}

/** Cloudflare cron entrypoint: bounded and safe to run every five minutes. */
export async function runCalendarSyncJob(env: Env): Promise<void> {
  const db = getDb(env);
  const store = createCalendarSyncStore(db);
  const workerId = crypto.randomUUID();
  await drainCalendarSync({
    store,
    authorize: calendarAuthorizer(env, store, workerId),
    webhookCallbackUrl: (provider) =>
      `${env.API_ORIGIN}/calendar/webhooks/${provider}`,
    discloseOwner: (disclosure) =>
      discloseCalendarOwner(env, db, disclosure),
    workerId,
  });
}
