"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/settings/timezone-select";
import { WeeklyHoursGrid } from "@/components/settings/weekly-hours-grid";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useNumberIdentity, useSetNumberIdentity } from "@/lib/api/numbers";
import type { BusinessHours, NumberIdentity } from "@/lib/api/types";
import {
  isDirty,
  toBusinessHours,
  toFormState,
  type DayFormState,
} from "@/lib/settings/business-hours-form";

/**
 * #307 — "When this line is open".
 *
 * A Vancouver line and a Toronto line in one workspace shared one clock, so
 * the away reply was wrong for one of them and no setting could fix it.
 *
 * Design notes, and the principles behind them:
 *
 * - **A dialog of its own, not five more rows in "How this line answers".**
 *   That one is already five fields; a timezone picker and a seven-row week
 *   would double it, and the two questions are asked at different times. Each
 *   dialog stays one question about one line. *Applying: Zen of Clarity.*
 *
 * - **Inheritance is stated for the WEEK, not per day.** `business_hours` is
 *   one column, so a line either keeps its own week or follows the workspace's.
 *   A per-day "inherited" badge would be false precision — it would imply you
 *   can take Tuesday from the workspace and keep Monday, which the storage
 *   cannot express and the resolver would not honour.
 *
 * - **The grid is the SAME component the workspace hours use.** A second copy
 *   would have drifted the first time either was touched. *Applying:
 *   consistency over local convenience.*
 *
 * - **The way back is worded as its outcome** — "Use the workspace's", matching
 *   the identity dialog exactly, because it is the same promise. *Applying:
 *   the Safety Principle — one learned pattern, not two.*
 */
export function NumberHoursDialog({
  numberId,
  open,
  onOpenChange,
}: {
  numberId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const identity = useNumberIdentity(numberId, open);
  const save = useSetNumberIdentity(numberId);

  const [zone, setZone] = useState("");
  const [days, setDays] = useState<DayFormState[]>([]);
  const [initialDays, setInitialDays] = useState<DayFormState[]>([]);

  // Re-seed whenever the server's answer changes, including after a clear:
  // the grid must show what this line now keeps, which for a cleared week is
  // the workspace's rather than what was typed.
  useEffect(() => {
    if (!identity.data) return;
    setZone(identity.data.timezone.value);
    const seeded = toFormState(
      (identity.data.business_hours.value ?? {}) as BusinessHours,
    );
    setDays(seeded);
    setInitialDays(seeded);
  }, [identity.data]);

  function patchDay(weekday: string, patch: Partial<DayFormState>) {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  }

  async function submit() {
    if (!identity.data) return;
    try {
      await save.mutateAsync(patchFrom(identity.data, zone, days, initialDays));
      onOpenChange(false);
      toast.success(t("settingsMore.numberHoursSaved"));
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.saveFailedGeneric"),
      );
    }
  }

  async function restore(field: "timezone" | "business_hours") {
    try {
      await save.mutateAsync({ [field]: null });
      toast.success(t("settingsMore.backToWorkspace"));
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.changeFailedGeneric"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("settingsMore.numberHoursTitle")}</DialogTitle>
          <DialogDescription>
            {t("settingsMore.numberHoursDescription")}
          </DialogDescription>
        </DialogHeader>

        {identity.isPending ? (
          <p className="text-sm text-muted-foreground">
            {t("settingsMore.loading")}
          </p>
        ) : identity.data ? (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label>{t("settingsMore.timezoneLabel")}</Label>
                {identity.data.timezone.inherited ? (
                  <span className="text-[12px] text-app-muted-2">
                    {t("settingsMore.sameAsWorkspace")}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={save.isPending}
                    onClick={() => void restore("timezone")}
                  >
                    {t("settingsMore.useWorkspaces")}
                  </Button>
                )}
              </div>
              <TimezoneSelect
                value={zone}
                onChange={setZone}
                disabled={save.isPending}
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label>{t("settingsMore.numberOpenHoursLabel")}</Label>
                {identity.data.business_hours.inherited ? (
                  <span className="text-[12px] text-app-muted-2">
                    {t("settingsMore.sameAsWorkspace")}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={save.isPending}
                    onClick={() => void restore("business_hours")}
                  >
                    {t("settingsMore.useWorkspaces")}
                  </Button>
                )}
              </div>
              <WeeklyHoursGrid
                days={days}
                disabled={save.isPending}
                idPrefix={`number-hours-${numberId}`}
                onChange={patchDay}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settingsMore.numberNotLoaded")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={save.isPending || !identity.data}
            onClick={() => void submit()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Only what actually changed.
 *
 * Same rule as the identity dialog, and the same failure if it is broken:
 * sending the resolved week back would turn an inherited clock into an
 * override just by opening this, and the line would stop following the
 * workspace without anybody choosing that. Nothing would look wrong until
 * somebody changed the workspace hours and one number ignored it.
 */
export function patchFrom(
  identity: NumberIdentity,
  zone: string,
  days: DayFormState[],
  initialDays: DayFormState[],
) {
  const patch: { timezone?: string; business_hours?: BusinessHours } = {};
  if (zone !== identity.timezone.value) patch.timezone = zone;
  if (isDirty(days, initialDays)) patch.business_hours = toBusinessHours(days);
  return patch;
}
