"use client";

import { CalendarSync, ChevronDown, Rss } from "lucide-react";

import { CalendarConnectionsCard } from "@/components/settings/calendar-connections-card";
import { CalendarFeedCard } from "@/components/settings/calendar-feed-card";
import { SettingsCard } from "@/components/settings/section";
import { useT } from "@/i18n/provider";
import { useCalendarConnections } from "@/lib/api/calendar";

/**
 * #744 — one Calendar section, with the choice up front.
 *
 * ## Evaluation
 *
 * Settings used to show "Two-way calendar sync" and "Your schedule in your
 * calendar" as two unrelated cards, with nothing saying which to use.
 *
 * ## Constraints
 *
 * *Chunking* — two options, each a heading plus one sentence on what it does
 * and when to pick it. The detail of each lives inside its own option.
 *
 * *Zen of Clarity* — once a calendar is connected the read-only link is an
 * alternative, not a second thing to set up, so it collapses.
 */
export function CalendarSection() {
  const t = useT();
  const view = useCalendarConnections();
  const connected = (view.data?.connections ?? []).some(
    (connection) => connection.status === "active",
  );

  return (
    <SettingsCard
      id="calendar"
      title={t("calendarFeed.sectionTitle")}
      description={t("calendarFeed.sectionDescription")}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-medium">
              <CalendarSync className="size-4 shrink-0" aria-hidden />
              {t("calendarFeed.twoWayOptionTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("calendarFeed.twoWayOptionPitch")}
            </p>
          </div>
          <CalendarConnectionsCard />
        </div>

        <div className="border-t border-border-subtle pt-6">
          {connected ? (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-primary">
                <ChevronDown
                  className="size-4 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden
                />
                {t("calendarFeed.subscribeAlternative")}
              </summary>
              <div className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  {t("calendarFeed.subscribeOptionPitch")}
                </p>
                <CalendarFeedCard />
              </div>
            </details>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 font-medium">
                  <Rss className="size-4 shrink-0" aria-hidden />
                  {t("calendarFeed.subscribeOptionTitle")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("calendarFeed.subscribeOptionPitch")}
                </p>
              </div>
              <CalendarFeedCard />
            </div>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
