"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/provider";
import {
  WEEKDAY_LABEL,
  type DayFormState,
} from "@/lib/settings/business-hours-form";

/**
 * The seven-row week, extracted so the workspace's hours and a single line's
 * hours (#307) are edited by ONE control rather than two that drift.
 *
 * This was inline in the away-reply settings page. Copying it for the
 * per-number dialog would have produced a second grid with its own idea of
 * what "closed" looks like, and the two would have diverged the first time
 * either was touched — the #437 failure, in miniature.
 *
 * Deliberately stateless: the caller owns `days` and decides what saving
 * means, because the workspace saves through the company route and a line
 * saves through its own. The grid only knows how to show a week.
 */
export function WeeklyHoursGrid({
  days,
  disabled,
  idPrefix,
  onChange,
}: {
  days: DayFormState[];
  disabled: boolean;
  /** Unique per instance: two grids on one page would otherwise share ids. */
  idPrefix: string;
  onChange: (weekday: string, patch: Partial<DayFormState>) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {days.map((day) => (
        <div
          key={day.weekday}
          className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0"
        >
          <div className="flex min-w-[9.5rem] items-center gap-2.5">
            <Switch
              id={`${idPrefix}-${day.weekday}`}
              checked={day.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => onChange(day.weekday, { enabled })}
            />
            <Label htmlFor={`${idPrefix}-${day.weekday}`} className="text-sm">
              {WEEKDAY_LABEL[day.weekday]}
            </Label>
          </div>
          {day.enabled ? (
            <div className="flex items-center gap-2 text-sm">
              <Input
                type="time"
                aria-label={t("settingsMore.hoursOpenAria", {
                  day: WEEKDAY_LABEL[day.weekday],
                })}
                value={day.open}
                disabled={disabled}
                onChange={(e) => onChange(day.weekday, { open: e.target.value })}
                className="w-[7.5rem]"
              />
              <span className="text-muted-foreground">
                {t("settingsMore.quietTo")}
              </span>
              <Input
                type="time"
                aria-label={t("settingsMore.hoursCloseAria", {
                  day: WEEKDAY_LABEL[day.weekday],
                })}
                value={day.close}
                disabled={disabled}
                onChange={(e) =>
                  onChange(day.weekday, { close: e.target.value })
                }
                className="w-[7.5rem]"
              />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("settingsMore.hoursClosed")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
