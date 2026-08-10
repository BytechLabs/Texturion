"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { REMINDER_RULES_CAP, reminderOffsetLabel } from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useReminderRules,
  useSaveReminderRules,
  type ReminderRule,
} from "@/lib/api/appointment-reminders";
import { cn } from "@/lib/utils";

/**
 * #237 — the text that stops a no-show.
 *
 * Design notes, and the principles behind them:
 *
 * - **OFF is the honest starting state, and it says so.** No workspace gets
 *   reminders until somebody here turns them on. The empty card is therefore
 *   not a failure to configure — it is the current, correct answer — so it
 *   reads as an offer ("Set up the usual two") rather than as an empty form
 *   waiting to be filled. *Applying: Smart Defaults, without applying them.*
 * - **Two offsets, and the cap is visible.** The day before, so the customer
 *   can still move it, and a couple of hours out, so somebody is home. A crew
 *   that texts five times is a crew whose customers stop reading, and the
 *   ceiling is shown rather than enforced by a refusal at save time.
 * - **The wording is one textarea per rule, not a builder.** These are two
 *   sentences a trade writes once. A template picker, merge-field chips and a
 *   preview pane would be more product than the decision has.
 * - **Ethical friction on the destructive edge only.** Removing a rule is one
 *   click — it is undoable by adding it back, and nothing has been sent. The
 *   friction is that nothing saves until Save: an owner editing the wording of
 *   a text that goes to every customer should be able to change their mind by
 *   navigating away.
 *
 * The offsets are fixed choices rather than a free number field. "Every N
 * minutes before" is a question nobody in a van wants to answer, and the two
 * that matter are already the industry's.
 */

/** The offsets an owner may pick between, in the order they fire. */
const OFFSET_CHOICES = [2880, 1440, 240, 120, 60] as const;

export function ReminderRulesCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const query = useReminderRules();
  const save = useSaveReminderRules();
  const [draft, setDraft] = useState<ReminderRule[] | null>(null);

  // Seeded once the server answers, and re-seeded whenever it does. Keeping a
  // draft rather than editing the query cache means navigating away discards
  // an unsaved edit, which is the whole of this card's friction model.
  useEffect(() => {
    if (query.data) setDraft(query.data.rules);
  }, [query.data]);

  if (query.isPending || draft === null) {
    return (
      <SettingsCard
        title={t("settingsMore.remindersTitle")}
        description={t("settingsMore.remindersDescription")}
      >
        <Skeleton className="h-24 w-full" />
      </SettingsCard>
    );
  }

  const suggested = query.data?.suggested ?? [];
  const cap = query.data?.cap ?? REMINDER_RULES_CAP;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(query.data?.rules ?? []);

  function update(index: number, patch: Partial<ReminderRule>) {
    setDraft((current) =>
      (current ?? []).map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  async function commit(rules: ReminderRule[]) {
    try {
      await save.mutateAsync(rules);
      toast.success(
        rules.length === 0
          ? t("settingsMore.remindersAllOff")
          : t("settingsMore.remindersSaved"),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.saveFailedGenericRetry"),
      );
    }
  }

  return (
    <SettingsCard
      title={t("settingsMore.remindersTitle")}
      description={t("settingsMore.remindersDescription")}
    >
      {draft.length === 0 ? (
        <div className="space-y-3">
          {/* The honest empty state: off is a state, not a gap. */}
          <p className="text-[13px] text-app-muted">
            {t("settingsMore.remindersOffBody")}
          </p>
          {canEdit && suggested.length > 0 && (
            <Button
              size="sm"
              onClick={() =>
                setDraft(
                  suggested.map((rule) => ({ ...rule, enabled: true })),
                )
              }
            >
              {t("settingsMore.remindersSetUpUsual")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {draft.map((rule, index) => (
            <div
              key={index}
              className="space-y-2 rounded-app-ctrl border border-app-line p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`offset-${index}`}>
                    {t("settingsMore.remindersOffsetLabel")}
                  </Label>
                  <select
                    id={`offset-${index}`}
                    value={rule.offset_minutes}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update(index, {
                        offset_minutes: Number(event.target.value),
                      })
                    }
                    className="h-8 rounded-app-ctrl border border-app-line bg-app-paper px-2 text-[13px] text-app-ink disabled:opacity-45"
                  >
                    {OFFSET_CHOICES.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {reminderOffsetLabel(minutes)}
                      </option>
                    ))}
                  </select>
                  <Switch
                    checked={rule.enabled}
                    disabled={!canEdit}
                    aria-label={t("settingsMore.remindersToggleAria", {
                      when: reminderOffsetLabel(rule.offset_minutes),
                    })}
                    onCheckedChange={(enabled) => update(index, { enabled })}
                  />
                </div>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t("settingsMore.remindersRemoveAria", {
                      when: reminderOffsetLabel(
                        rule.offset_minutes,
                      ).toLowerCase(),
                    })}
                    onClick={() =>
                      setDraft((current) =>
                        (current ?? []).filter((_, i) => i !== index),
                      )
                    }
                    className="tap-target rounded-app-ctrl px-2 py-1 text-[12px] text-app-muted transition-colors duration-150 hover:bg-app-line-soft hover:text-app-ink"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </div>
              <Textarea
                value={rule.body}
                disabled={!canEdit}
                rows={3}
                aria-label={t("settingsMore.remindersBodyAria", {
                  when: reminderOffsetLabel(rule.offset_minutes).toLowerCase(),
                })}
                onChange={(event) => update(index, { body: event.target.value })}
                className={cn(!rule.enabled && "opacity-60")}
              />
            </div>
          ))}

          {canEdit && draft.length < cap && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft((current) => [
                  ...(current ?? []),
                  {
                    offset_minutes:
                      OFFSET_CHOICES.find(
                        (minutes) =>
                          !(current ?? []).some(
                            (rule) => rule.offset_minutes === minutes,
                          ),
                      ) ?? 120,
                    body: suggested[1]?.body ?? "",
                    enabled: true,
                  },
                ])
              }
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {t("settingsMore.remindersAddAnother")}
            </Button>
          )}

          {/* The ceiling, shown rather than enforced by a refusal at save. */}
          {draft.length >= cap && (
            <p className="text-[12px] text-app-muted-2">
              {t("settingsMore.remindersCap")}
            </p>
          )}

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!dirty || save.isPending}
                onClick={() => void commit(draft)}
              >
                {t("settingsMore.remindersSaveAction")}
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(query.data?.rules ?? [])}
                >
                  {t("settingsMore.discard")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
