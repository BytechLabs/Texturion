"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { useT } from "@/i18n/provider";
import type { Translate } from "@/i18n/provider";
import { useCalendarAttention, useResolveCalendarAttention } from "@/lib/api/calendar";
import type { CalendarAttentionItem, CalendarAttentionResolution, CalendarProvider } from "@/lib/api/calendar";
import { formatAbsoluteDateTime, instantFromZonedWallClock } from "@/lib/format/time";

export function calendarProviderName(t: Translate, provider: CalendarProvider): string {
  return provider === "google"
    ? t("calendarFeed.googleProvider")
    : t("calendarFeed.microsoftProvider");
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
    case "all_day": {
      return t("calendarFeed.refusedAllDayTitle");
    }
    case "invalid_time": {
      return t("calendarFeed.refusedTimeTitle");
    }
    case "invalid_title": {
      return t("calendarFeed.refusedTitleTitle");
    }
    case "unknown_time_zone": {
      return t("calendarFeed.refusedZoneTitle");
    }
    case "description_too_long": {
      return t("calendarFeed.refusedDescriptionTitle");
    }
    case "outside_sync_window": {
      return t("calendarFeed.refusedWindowTitle");
    }
    case "unsafe_meeting": {
      return t("calendarFeed.refusedMeetingTitle");
    }
    case "recurrence": {
      return t("calendarFeed.refusedRecurrenceTitle");
    }
    default: {
      return t("calendarFeed.refusedUnknownTitle");
    }
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
    case "all_day": {
      return t("calendarFeed.refusedAllDayDescription");
    }
    case "invalid_time": {
      return t("calendarFeed.refusedTimeDescription");
    }
    case "invalid_title": {
      return t("calendarFeed.refusedTitleDescription");
    }
    case "unknown_time_zone": {
      return t("calendarFeed.refusedZoneDescription");
    }
    case "description_too_long": {
      return t("calendarFeed.refusedDescriptionDescription");
    }
    case "outside_sync_window": {
      return t("calendarFeed.refusedWindowDescription");
    }
    case "unsafe_meeting": {
      return t("calendarFeed.refusedMeetingDescription");
    }
    case "recurrence": {
      return t("calendarFeed.refusedRecurrenceDescription");
    }
    default: {
      return t("calendarFeed.refusedUnknownDescription");
    }
  }
}

/** #722: the server names what is on offer; a response without the list keeps the old behaviour. */
export function offersCalendarAction(
  allowedActions: readonly string[] | undefined,
  action: string,
): boolean {
  return allowedActions?.includes(action) ?? true;
}

export function CalendarAttentionPanel({
  sectionId = "calendar-attention",
  className = "",
  showLoading = true,
}: {
  sectionId?: string;
  className?: string;
  showLoading?: boolean;
}) {
  const t = useT();
  const attention = useCalendarAttention();
  const resolveAttention = useResolveCalendarAttention();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [newDueAt, setNewDueAt] = useState("");
  const [deferredIds, setDeferredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
          : (instant.reason === "nonexistent"
            ? t("calendarFeed.movedDateNonexistent")
            : t("calendarFeed.movedDateRequired")),
      );
      return;
    }
    resolve(item.id, { action: "moved", new_due_at: instant.iso });
  }

  const attentionItems = (attention.data?.attention ?? []).filter(
    (item) => !deferredIds.has(item.id),
  );

  if (attention.isLoading) {
    return showLoading ? (
      <p role="status" className="text-sm text-muted-foreground">
        {t("calendarFeed.attentionLoading")}
      </p>
    ) : null;
  }
  if (attention.isError) {
    return (
      <LoadError
        className={className}
        message={t("calendarFeed.attentionLoadFailed")}
        onRetry={() => void attention.refetch()}
        variant="inline"
      />
    );
  }
  if (attentionItems.length === 0) return null;

  return (
    <section
      id={sectionId}
      aria-labelledby={`${sectionId}-title`}
      className={`space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4 ${className}`}
    >
      <div className="space-y-1">
        <h3 id={`${sectionId}-title`} className="font-medium">
          {t("calendarFeed.attentionTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("calendarFeed.attentionDescription")}
        </p>
      </div>

      <ul className="space-y-3">
        {attentionItems.map((item) => {
          const provider = calendarProviderName(t, item.connection.provider);
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
                {item.state === "conflict" && offersCalendarAction(item.allowed_actions, "resolve_conflict") && (
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

                {item.state === "event_removed" &&
                  offersCalendarAction(item.allowed_actions, "resolve_event_removed") && (
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

                {item.state !== "refused" &&
                  offersCalendarAction(
                    item.allowed_actions,
                    item.state === "conflict"
                      ? "resolve_conflict"
                      : "resolve_event_removed",
                  ) && (
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
  );
}
