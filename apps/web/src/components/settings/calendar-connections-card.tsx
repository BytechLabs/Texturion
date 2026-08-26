"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarSync,
  CheckCircle2,
  CloudOff,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import {
  type CalendarAttentionItem,
  type CalendarAttentionResolution,
  type CalendarConnection,
  type CalendarProvider,
  useAuthorizeCalendarConnection,
  useCalendarAttention,
  useCalendarConnections,
  useDisconnectCalendarConnection,
  useResolveCalendarAttention,
} from "@/lib/api/calendar";
import {
  formatAbsoluteDateTime,
  formatRelativeTime,
  instantFromZonedWallClock,
} from "@/lib/format/time";

const PROVIDERS = ["google", "microsoft"] as const;

function providerName(t: Translate, provider: CalendarProvider): string {
  return provider === "google"
    ? t("calendarFeed.googleProvider")
    : t("calendarFeed.microsoftProvider");
}

function connectLabel(t: Translate, provider: CalendarProvider): string {
  return provider === "google"
    ? t("calendarFeed.connectGoogle")
    : t("calendarFeed.connectMicrosoft");
}

function relative(iso: string, t: Translate): string {
  return formatRelativeTime(iso, new Date(), t, t.locale);
}

function ScheduleSnapshot({
  label,
  snapshot,
  t,
}: {
  label: string;
  snapshot: NonNullable<CalendarAttentionItem["ours"]>;
  t: Translate;
}) {
  return (
    <div className="rounded-md bg-muted/60 p-3">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("calendarFeed.scheduleStart")}
          </dt>
          <dd className="font-medium">
            <time dateTime={snapshot.start}>
              {formatAbsoluteDateTime(
                snapshot.start,
                snapshot.time_zone,
                t.locale,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("calendarFeed.scheduleEnd")}
          </dt>
          <dd className="font-medium">
            <time dateTime={snapshot.end}>
              {formatAbsoluteDateTime(
                snapshot.end,
                snapshot.time_zone,
                t.locale,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("calendarFeed.scheduleTimeZone")}
          </dt>
          <dd className="break-words font-medium">{snapshot.time_zone}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("calendarFeed.scheduleTitle")}
          </dt>
          <dd className="break-words font-medium">{snapshot.title}</dd>
        </div>
      </dl>
    </div>
  );
}

function attentionHeading(t: Translate, item: CalendarAttentionItem): string {
  if (item.state === "conflict") return t("calendarFeed.conflictTitle");
  if (item.state === "event_removed") return t("calendarFeed.removedTitle");
  switch (item.refusal?.code) {
    case "all_day":
      return t("calendarFeed.refusedAllDayTitle");
    case "invalid_time":
      return t("calendarFeed.refusedTimeTitle");
    case "invalid_title":
      return t("calendarFeed.refusedTitleTitle");
    case "unknown_time_zone":
      return t("calendarFeed.refusedZoneTitle");
    case "description_too_long":
      return t("calendarFeed.refusedDescriptionTitle");
    case "outside_sync_window":
      return t("calendarFeed.refusedWindowTitle");
    case "unsafe_meeting":
      return t("calendarFeed.refusedMeetingTitle");
    case "recurrence":
      return t("calendarFeed.refusedRecurrenceTitle");
    default:
      return t("calendarFeed.refusedUnknownTitle");
  }
}

function attentionDescription(
  t: Translate,
  item: CalendarAttentionItem,
): string {
  if (item.state === "conflict") {
    if (item.provider_condition === "event_removed") {
      return t("calendarFeed.conflictProviderRemoved");
    }
    if (item.provider_condition === "refused") {
      return t("calendarFeed.conflictProviderRefused");
    }
    return t("calendarFeed.conflictDescription");
  }
  if (item.state === "event_removed") {
    return t("calendarFeed.removedDescription");
  }
  switch (item.refusal?.code) {
    case "all_day":
      return t("calendarFeed.refusedAllDayDescription");
    case "invalid_time":
      return t("calendarFeed.refusedTimeDescription");
    case "invalid_title":
      return t("calendarFeed.refusedTitleDescription");
    case "unknown_time_zone":
      return t("calendarFeed.refusedZoneDescription");
    case "description_too_long":
      return t("calendarFeed.refusedDescriptionDescription");
    case "outside_sync_window":
      return t("calendarFeed.refusedWindowDescription");
    case "unsafe_meeting":
      return t("calendarFeed.refusedMeetingDescription");
    case "recurrence":
      return t("calendarFeed.refusedRecurrenceDescription");
    default:
      return t("calendarFeed.refusedUnknownDescription");
  }
}

function ConnectionStatus({ connection }: { connection: CalendarConnection }) {
  const t = useT();

  if (connection.status === "active") {
    return (
      <Badge className="border-transparent bg-success/10 text-success">
        <CheckCircle2 aria-hidden />
        {t("calendarFeed.connected")}
      </Badge>
    );
  }

  if (connection.status === "reauth_required") {
    return (
      <Badge className="border-transparent bg-warning/10 text-amber-800 dark:text-warning">
        <RefreshCw aria-hidden />
        {t("calendarFeed.reauthRequired")}
      </Badge>
    );
  }

  if (connection.status === "disconnected") {
    return (
      <Badge variant="secondary">
        <CloudOff aria-hidden />
        {t("calendarFeed.disconnected")}
      </Badge>
    );
  }

  // A new server state must not leak an enum into the interface. Until this
  // client learns the state, the only honest promise is that it needs review.
  return (
    <Badge variant="destructive">
      <AlertTriangle aria-hidden />
      {t("calendarFeed.needsAttention")}
    </Badge>
  );
}

/**
 * #245 — writable Google/Microsoft calendars, immediately beside the existing
 * read-only feed.
 *
 * The disclosure is intentionally visible at rest. Connecting revokes a live
 * credential and changes which copy can be dragged, so burying that fact in an
 * OAuth consent screen would tell somebody only after the consequential click.
 */
export function CalendarConnectionsCard() {
  const t = useT();
  const view = useCalendarConnections();
  const attention = useCalendarAttention();
  const authorize = useAuthorizeCalendarConnection();
  const disconnect = useDisconnectCalendarConnection();
  const resolveAttention = useResolveCalendarAttention();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<string | null>(
    null,
  );
  const [movingId, setMovingId] = useState<string | null>(null);
  const [newDueAt, setNewDueAt] = useState("");
  const [deferredIds, setDeferredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handledOauthOutcome = useRef<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("calendar");
    if (
      outcome !== "connected" &&
      outcome !== "failed" &&
      outcome !== "replacement_requires_disconnect" &&
      outcome !== "disconnect_in_progress"
    ) return;
    if (handledOauthOutcome.current === url.href) return;
    handledOauthOutcome.current = url.href;

    if (outcome === "connected") {
      toast.success(t("calendarFeed.connectedToast"));
    } else if (outcome === "replacement_requires_disconnect") {
      toast.error(t("calendarFeed.replacementRequiresDisconnect"));
    } else if (outcome === "disconnect_in_progress") {
      toast.error(t("calendarFeed.disconnectInProgress"));
    } else {
      toast.error(t("calendarFeed.authorizationFailed"));
    }

    url.searchParams.delete("calendar");
    const query = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
    );
  }, [t]);

  const connections = view.data?.connections ?? [];
  const disclosures = view.data?.disclosures ?? [];
  const hasActiveConnection = connections.some(
    (connection) => connection.status === "active",
  );
  const cleanupInProgress = connections.some(
    (connection) => connection.status === "disconnected",
  );
  const connectedProviders = new Set(
    connections.map((connection) => connection.provider),
  );

  function startAuthorization(provider: CalendarProvider) {
    authorize.mutate(
      { provider },
      {
        onSuccess: ({ url }) => window.location.assign(url),
        onError: () => toast.error(t("calendarFeed.authorizationFailed")),
      },
    );
  }

  function disconnectConnection(id: string) {
    disconnect.mutate(id, {
      onSuccess: () => {
        setConfirmingDisconnect(null);
        toast.success(t("calendarFeed.disconnectedToast"));
      },
      onError: () => toast.error(t("calendarFeed.disconnectFailed")),
    });
  }

  function resolve(
    id: string,
    resolution: CalendarAttentionResolution,
  ) {
    resolveAttention.mutate(
      { id, resolution },
      {
        onSuccess: () => {
          if (resolution.action === "not_sure") {
            setDeferredIds((current) => new Set(current).add(id));
          }
          setMovingId(null);
          setNewDueAt("");
          toast.success(t("calendarFeed.resolutionSaved"));
        },
        onError: () => toast.error(t("calendarFeed.resolutionFailed")),
      },
    );
  }

  function saveMovedDate(item: CalendarAttentionItem) {
    const timeZone =
      item.ours?.time_zone ?? item.theirs?.time_zone ?? item.connection.time_zone;
    if (!newDueAt || !timeZone) {
      toast.error(t("calendarFeed.movedDateRequired"));
      return;
    }
    const instant = instantFromZonedWallClock(newDueAt, timeZone);
    if (!instant.ok) {
      toast.error(
        instant.reason === "ambiguous"
          ? t("calendarFeed.movedDateAmbiguous")
          : instant.reason === "nonexistent"
            ? t("calendarFeed.movedDateNonexistent")
            : t("calendarFeed.movedDateRequired"),
      );
      return;
    }
    resolve(item.id, { action: "moved", new_due_at: instant.iso });
  }

  const attentionItems = (attention.data?.attention ?? []).filter(
    (item) => !deferredIds.has(item.id),
  );

  return (
    <SettingsCard
      title={t("calendarFeed.twoWayTitle")}
      description={t("calendarFeed.twoWayDescription")}
    >
      <div className="space-y-5">
        <p
          id="calendar-connection-disclosure"
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {t("calendarFeed.twoWayDisclosure")}
        </p>

        {view.isLoading ? (
          <div role="status">
            <span className="sr-only">
              {t("calendarFeed.connectionsLoading")}
            </span>
            <div className="space-y-3" aria-hidden>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-9 w-72 max-w-full" />
            </div>
          </div>
        ) : view.isError ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">
              {t("calendarFeed.connectionsLoadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void view.refetch()}
            >
              {t("calendarFeed.retryConnections")}
            </Button>
          </div>
        ) : (
          <>
            {disclosures.length > 0 && (
              <ul className="space-y-2">
                {disclosures.map((disclosure) => (
                  <li
                    key={`${disclosure.connection_id}:${disclosure.reason}`}
                    role="status"
                    className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-amber-800 dark:text-warning"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    {disclosure.reason === "cleanup_failed"
                      ? t("calendarFeed.connectionCleanupFailed")
                      : disclosure.reason === "sync_stale"
                        ? t("calendarFeed.connectionStale")
                        : t("calendarFeed.connectionError")}
                  </li>
                ))}
              </ul>
            )}
            {connections.length > 0 && (
              <ul className="divide-y divide-border-subtle rounded-lg border">
                {connections.map((connection) => {
                  const reconnect = connection.status === "reauth_required";
                  const cleaningUp = connection.status === "disconnected";
                  const retrying =
                    connection.status === "active" &&
                    connection.last_error_key !== null;
                  const disconnecting =
                    disconnect.isPending && disconnect.variables === connection.id;
                  return (
                    <li key={connection.id} className="space-y-4 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <h3 className="font-medium">
                            {providerName(t, connection.provider)}
                          </h3>
                          <p className="truncate text-sm text-muted-foreground">
                            {connection.account_label}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t("calendarFeed.calendarNamed", {
                              calendar: connection.calendar_label,
                            })}
                          </p>
                        </div>
                        <ConnectionStatus connection={connection} />
                      </div>

                      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="sr-only">
                            {t("calendarFeed.verificationLabel")}
                          </dt>
                          <dd>
                            {connection.last_verified_at
                              ? t("calendarFeed.lastVerified", {
                                  when: relative(connection.last_verified_at, t),
                                })
                              : t("calendarFeed.neverVerified")}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">
                            {t("calendarFeed.synchronizationLabel")}
                          </dt>
                          <dd>
                            {connection.last_sync_at
                              ? t("calendarFeed.lastSynced", {
                                  when: relative(connection.last_sync_at, t),
                                })
                              : t("calendarFeed.neverSynced")}
                          </dd>
                        </div>
                      </dl>

                      {(retrying || reconnect || cleaningUp) && (
                        <p
                          role="status"
                          className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-amber-800 dark:text-warning"
                        >
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0"
                            aria-hidden
                          />
                          {cleaningUp
                            ? t("calendarFeed.connectionDisconnecting")
                            : retrying
                              ? t("calendarFeed.connectionRetrying")
                              : t("calendarFeed.connectionError")}
                        </p>
                      )}

                      {connection.conflict_count > 0 && (
                        <a
                          href="#calendar-attention"
                          className="block text-sm font-medium text-amber-800 underline-offset-4 hover:underline dark:text-warning"
                        >
                          {connection.conflict_count === 1
                            ? t("calendarFeed.conflictsOne")
                            : t("calendarFeed.conflictsMany", {
                                count: connection.conflict_count,
                              })}
                        </a>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {reconnect && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={authorize.isPending}
                            aria-describedby="calendar-connection-disclosure"
                            onClick={() => startAuthorization(connection.provider)}
                          >
                            <RefreshCw aria-hidden />
                            {authorize.isPending &&
                            authorize.variables?.provider === connection.provider
                              ? t("calendarFeed.connecting")
                              : t("calendarFeed.reauthorize")}
                          </Button>
                        )}

                        {!cleaningUp &&
                          (confirmingDisconnect === connection.id ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={disconnecting}
                              onClick={() => disconnectConnection(connection.id)}
                            >
                              <Unplug aria-hidden />
                              {t("calendarFeed.disconnectConfirm")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingDisconnect(connection.id)}
                            >
                              {t("calendarFeed.disconnect")}
                            </Button>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!cleanupInProgress && (
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.filter(
                  (provider) => !connectedProviders.has(provider),
                ).map((provider) => {
                const configured = view.data?.configured[provider] === true;
                const descriptionId = `calendar-${provider}-unavailable`;
                return (
                  <div key={provider} className="max-w-xs space-y-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!configured || authorize.isPending}
                      aria-describedby={
                        configured
                          ? "calendar-connection-disclosure"
                          : descriptionId
                      }
                      onClick={() => startAuthorization(provider)}
                    >
                      <CalendarSync aria-hidden />
                      {authorize.isPending &&
                      authorize.variables?.provider === provider
                        ? t("calendarFeed.connecting")
                        : connectLabel(t, provider)}
                    </Button>
                    {!configured && (
                      <p
                        id={descriptionId}
                        className="text-xs text-muted-foreground"
                      >
                        {t("calendarFeed.providerUnavailable", {
                          provider: providerName(t, provider),
                        })}
                      </p>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            {!hasActiveConnection && (
              <a
                href="#calendar-read-only-feed"
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("calendarFeed.readOnlyFallback")}
              </a>
            )}

            {attention.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("calendarFeed.attentionLoading")}
              </p>
            ) : attention.isError ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">
                  {t("calendarFeed.attentionLoadFailed")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void attention.refetch()}
                >
                  {t("calendarFeed.attentionRetry")}
                </Button>
              </div>
            ) : attentionItems.length > 0 ? (
              <section
                id="calendar-attention"
                aria-labelledby="calendar-attention-title"
                className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
              >
                <div className="space-y-1">
                  <h3 id="calendar-attention-title" className="font-medium">
                    {t("calendarFeed.attentionTitle")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("calendarFeed.attentionDescription")}
                  </p>
                </div>

                <ul className="space-y-3">
                  {attentionItems.map((item) => {
                    const provider = providerName(t, item.connection.provider);
                    const pending =
                      resolveAttention.isPending &&
                      resolveAttention.variables?.id === item.id;
                    return (
                      <li
                        key={item.id}
                        className="space-y-3 rounded-md border bg-background p-4"
                      >
                        <div className="space-y-1">
                          <p className="font-medium">{item.task.title}</p>
                          <p className="text-sm font-medium text-amber-800 dark:text-warning">
                            {attentionHeading(t, item)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {attentionDescription(t, item)}
                          </p>
                        </div>

                        {item.state === "conflict" && item.ours && item.theirs && (
                          <div className="space-y-3">
                            <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                              <h4 className="text-xs font-medium">
                                {t("calendarFeed.differencesTitle")}
                              </h4>
                              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                                {item.differences.start && (
                                  <li>{t("calendarFeed.startDifference")}</li>
                                )}
                                {item.differences.end && (
                                  <li>{t("calendarFeed.endDifference")}</li>
                                )}
                                {item.differences.time_zone && (
                                  <li>{t("calendarFeed.timeZoneDifference")}</li>
                                )}
                                {item.differences.title && (
                                  <li>{t("calendarFeed.titleDifference")}</li>
                                )}
                                {item.differences.description && (
                                  <li>{t("calendarFeed.descriptionChanged")}</li>
                                )}
                              </ul>
                            </div>

                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {item.display_timestamps.ours_changed_at && (
                                <li>
                                  {item.ours_changed_by?.name
                                    ? t("calendarFeed.loonextChangedByAt", {
                                        name: item.ours_changed_by.name,
                                        when: formatAbsoluteDateTime(
                                          item.display_timestamps.ours_changed_at,
                                          undefined,
                                          t.locale,
                                        ),
                                      })
                                    : t("calendarFeed.loonextChangedAt", {
                                        when: formatAbsoluteDateTime(
                                          item.display_timestamps.ours_changed_at,
                                          undefined,
                                          t.locale,
                                        ),
                                      })}
                                </li>
                              )}
                              {item.display_timestamps.provider_observed_at && (
                                <li>
                                  {t("calendarFeed.providerObservedAt", {
                                    provider,
                                    when: formatAbsoluteDateTime(
                                      item.display_timestamps.provider_observed_at,
                                      undefined,
                                      t.locale,
                                    ),
                                  })}
                                </li>
                              )}
                              <li>
                                {t("calendarFeed.conflictDetectedAt", {
                                  when: formatAbsoluteDateTime(
                                    item.display_timestamps.attention_at,
                                    undefined,
                                    t.locale,
                                  ),
                                })}
                              </li>
                            </ul>

                            <div className="grid gap-2 sm:grid-cols-2">
                              <ScheduleSnapshot
                                label={t("calendarFeed.loonextSchedule")}
                                snapshot={item.ours}
                                t={t}
                              />
                              <ScheduleSnapshot
                                label={t("calendarFeed.providerSchedule", {
                                  provider,
                                })}
                                snapshot={item.theirs}
                                t={t}
                              />
                            </div>
                          </div>
                        )}

                        {movingId === item.id && (
                          <div className="space-y-2">
                            <label
                              htmlFor={`calendar-new-date-${item.id}`}
                              className="text-sm font-medium"
                            >
                              {t("calendarFeed.newDateLabel")}
                            </label>
                            <Input
                              id={`calendar-new-date-${item.id}`}
                              type="datetime-local"
                              value={newDueAt}
                              onChange={(event) => setNewDueAt(event.target.value)}
                            />
                            {(item.ours?.time_zone ??
                              item.theirs?.time_zone ??
                              item.connection.time_zone) && (
                              <p className="text-xs text-muted-foreground">
                                {t("calendarFeed.newDateTimeZone", {
                                  zone:
                                    item.ours?.time_zone ??
                                    item.theirs?.time_zone ??
                                    item.connection.time_zone,
                                })}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {item.state === "conflict" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={pending}
                                onClick={() => resolve(item.id, { action: "use_app" })}
                              >
                                {t("calendarFeed.useLoonext")}
                              </Button>
                              {item.provider_condition === "conflict" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() =>
                                    resolve(item.id, { action: "use_calendar" })
                                  }
                                >
                                  {t("calendarFeed.useCalendar")}
                                </Button>
                              )}
                            </>
                          )}

                          {item.state === "event_removed" && (
                            <>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={pending}
                                onClick={() =>
                                  resolve(item.id, { action: "cancelled" })
                                }
                              >
                                {t("calendarFeed.cancelJob")}
                              </Button>
                              {movingId === item.id ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => saveMovedDate(item)}
                                >
                                  {t("calendarFeed.saveMovedDate")}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => {
                                    setMovingId(item.id);
                                    setNewDueAt("");
                                  }}
                                >
                                  {t("calendarFeed.movedJob")}
                                </Button>
                              )}
                            </>
                          )}

                          {item.state !== "refused" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => resolve(item.id, { action: "not_sure" })}
                            >
                              {t("calendarFeed.notSure")}
                            </Button>
                          )}

                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/tasks?task=${item.task.id}`}>
                              {t("calendarFeed.openTask")}
                            </Link>
                          </Button>
                        </div>

                        {pending && (
                          <p role="status" className="text-xs text-muted-foreground">
                            {t("calendarFeed.resolving")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </SettingsCard>
  );
}
