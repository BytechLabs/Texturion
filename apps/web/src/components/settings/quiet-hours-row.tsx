"use client";

import { toast } from "sonner";

import {
  QUIET_HOURS_COPY,
  QUIET_HOURS_DEFAULT,
  quietHoursLine,
} from "@loonext/shared";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import type { NotificationPrefs } from "@/lib/api/types";

/**
 * #244 — a member's own do-not-disturb, for the nights they are not on call.
 *
 * Design notes, and the principles behind them:
 *
 * - **The reassurance comes BEFORE the choice, not after it.** The reason
 *   people do not set quiet hours is the fear of missing the emergency, so a
 *   control that offers silence without saying what still gets through does not
 *   get switched on — and the member goes back to turning notifications off
 *   entirely, which is the failure this exists to prevent.
 *   *Applying: Loss Aversion, read the right way round — name what they do NOT
 *   lose, because that is the thing standing between them and the setting.*
 *
 * - **Turning it on fills the window in.** 10pm to 7am is what almost everybody
 *   wants, and an empty pair of time fields is a decision nobody in a van
 *   stops to make. *Applying: Smart Defaults — never an empty form.*
 *
 * - **A switch and two times, not a per-day schedule.** Somebody who works
 *   Saturdays does not want a different Saturday window; they want the same
 *   nights off. *Applying: Zen of Clarity.*
 *
 * - **The scope is said out loud.** Preferences are per workspace, so a member
 *   of two crews has two windows — surprising enough to be worth one line.
 */
export function QuietHoursRow({
  prefs,
  onSave,
  saving,
}: {
  prefs: NotificationPrefs;
  onSave: (next: NotificationPrefs) => Promise<unknown>;
  saving: boolean;
}) {
  const t = useT();
  const on = Boolean(prefs.quiet_from && prefs.quiet_to);

  async function save(next: Partial<NotificationPrefs>) {
    try {
      await onSave({ ...prefs, ...next });
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.saveThatFailed"),
      );
    }
  }

  return (
    <div className="space-y-2 rounded-app-card border border-app-line bg-app-paper p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="quiet-hours" className="text-[14px]">
            {t(QUIET_HOURS_COPY.heading)}
          </Label>
          <p className="text-[13px] text-app-muted-2">
            {t(QUIET_HOURS_COPY.reassurance)}
          </p>
        </div>
        <Switch
          id="quiet-hours"
          checked={on}
          disabled={saving}
          onCheckedChange={(next) =>
            save(
              next
                ? {
                    quiet_from: QUIET_HOURS_DEFAULT.from,
                    quiet_to: QUIET_HOURS_DEFAULT.to,
                    // The browser's zone, captured now. A member who moves can
                    // re-save; guessing the workspace's would silence the
                    // wrong hours for anybody who does not live there.
                    quiet_timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
                  }
                : { quiet_from: null, quiet_to: null, quiet_timezone: null },
            )
          }
        />
      </div>

      {on ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="time"
            aria-label={t("settingsMore.quietFromAria")}
            value={prefs.quiet_from ?? ""}
            disabled={saving}
            onChange={(event) => save({ quiet_from: event.target.value })}
            className="h-9 rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] tabular-nums text-app-ink"
          />
          <span className="text-[13px] text-app-muted-2">
            {t("settingsMore.quietTo")}
          </span>
          <input
            type="time"
            aria-label={t("settingsMore.quietUntilAria")}
            value={prefs.quiet_to ?? ""}
            disabled={saving}
            onChange={(event) => save({ quiet_to: event.target.value })}
            className="h-9 rounded-app-input border border-app-line bg-app-paper px-2 text-[13px] tabular-nums text-app-ink"
          />
          <span className="text-[12px] text-app-muted-2">
            {t(QUIET_HOURS_COPY.scope)}
          </span>
        </div>
      ) : (
        <p className="pt-1 text-[13px] text-app-muted-2">
          {t(QUIET_HOURS_COPY.off)}
        </p>
      )}

      {on && prefs.quiet_from && prefs.quiet_to ? (
        <p className="sr-only">
          {quietHoursLine(prefs.quiet_from, prefs.quiet_to, t)}
        </p>
      ) : null}
    </div>
  );
}
