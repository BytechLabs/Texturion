"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import type { AutomaticTextSettings } from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useT, type MessageKey } from "@/i18n/provider";
import { useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";
import {
  automaticTextDefaultCaption,
  automaticTextPatch,
  choicesWithCurrent,
  formatAutomaticTextDuration,
  readAutomaticTextSettings,
  type BooleanField,
  type NumberField,
} from "@/lib/settings/automatic-texts";

/**
 * Settings > Automatic texts.
 *
 * Three groups of three or four rows, in the order a customer's day goes:
 * what happens if they reply first, the rating question, how long things wait.
 * Rows inside a group sit tight; the cards are a section apart. Every row says
 * its own default, so nobody has to guess what "unchanged" means. Numbers are
 * picked from a short list, never typed. Each control saves on its own and the
 * screen shows what the server answered, so a refused change snaps back.
 * *Applying: Smart Defaults, Chunking and Relationship Strength.*
 */

interface Saver {
  disabled: boolean;
  save: (patch: Partial<AutomaticTextSettings>) => void;
}

function SwitchRow({
  field,
  label,
  note,
  value,
  saver,
}: {
  field: BooleanField;
  label: MessageKey;
  /** An extra sentence for a row that needs more than the on/off line. */
  note?: MessageKey;
  value: boolean;
  saver: Saver;
}) {
  const t = useT();
  const id = useId();
  const captionId = `${id}-caption`;
  const held = field.startsWith("hold_");
  const caption = [
    note ? t(note) : null,
    held
      ? t(value ? "settingsMore.autoTextsHeldOn" : "settingsMore.autoTextsHeldOff")
      : null,
    automaticTextDefaultCaption(t, field),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex min-h-[44px] items-start justify-between gap-4 py-2">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {t(label)}
        </Label>
        <p id={captionId} className="text-sm text-muted-foreground">
          {caption}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={captionId}
        checked={value}
        disabled={saver.disabled}
        onCheckedChange={(next) => saver.save(automaticTextPatch(field, next))}
      />
    </div>
  );
}

function PickerRow({
  field,
  label,
  value,
  saver,
}: {
  field: NumberField;
  label: MessageKey;
  value: number;
  saver: Saver;
}) {
  const t = useT();
  const id = useId();
  const captionId = `${id}-caption`;
  return (
    <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <div className="min-w-0 flex-1 basis-60 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {t(label)}
        </Label>
        <p id={captionId} className="text-sm text-muted-foreground">
          {automaticTextDefaultCaption(t, field)}
        </p>
      </div>
      <div className="w-full sm:w-44">
        <NativeSelect
          id={id}
          aria-describedby={captionId}
          className="h-11"
          value={value}
          disabled={saver.disabled}
          onChange={(event) =>
            saver.save(automaticTextPatch(field, Number(event.target.value)))
          }
        >
          {choicesWithCurrent(field, value).map((choice) => (
            <option key={choice} value={choice}>
              {formatAutomaticTextDuration(t, field, choice)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

export function AutomaticTextsGroups({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const t = useT();
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);
  const settings = readAutomaticTextSettings(company);

  const saver: Saver = {
    disabled: !canEdit || update.isPending,
    save: (patch) => {
      setError(null);
      update.mutate(patch, {
        onError: (cause) => {
          const message =
            cause instanceof ApiError
              ? cause.message
              : t("settingsMore.autoTextsSaveFailed");
          setError(message);
          toast.error(message);
        },
      });
    },
  };

  return (
    <div className="space-y-6">
      <SettingsCard
        title={t("settingsMore.autoTextsGroupReply")}
        description={t("settingsMore.autoTextsGroupReplyIntro")}
      >
        <div className="divide-y divide-border-subtle">
          <SwitchRow
            field="hold_scheduled_on_reply"
            label="settingsMore.autoTextsHoldScheduled"
            value={settings.hold_scheduled_on_reply}
            saver={saver}
          />
          <SwitchRow
            field="hold_reminders_on_reply"
            label="settingsMore.autoTextsHoldReminders"
            value={settings.hold_reminders_on_reply}
            saver={saver}
          />
          <SwitchRow
            field="hold_rating_ask_on_reply"
            label="settingsMore.autoTextsHoldRating"
            value={settings.hold_rating_ask_on_reply}
            saver={saver}
          />
          <SwitchRow
            field="hold_reminders_unverified_calendar"
            label="settingsMore.autoTextsHoldCalendar"
            note="settingsMore.autoTextsHoldCalendarNote"
            value={settings.hold_reminders_unverified_calendar}
            saver={saver}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t("settingsMore.autoTextsGroupRating")}>
        <div className="divide-y divide-border-subtle">
          <SwitchRow
            field="rating_ask_enabled"
            label="settingsMore.autoTextsRatingEnabled"
            value={settings.rating_ask_enabled}
            saver={saver}
          />
          <PickerRow
            field="rating_ask_delay_hours"
            label="settingsMore.autoTextsRatingDelay"
            value={settings.rating_ask_delay_hours}
            saver={saver}
          />
          <PickerRow
            field="rating_ask_expiry_hours"
            label="settingsMore.autoTextsRatingExpiry"
            value={settings.rating_ask_expiry_hours}
            saver={saver}
          />
          <PickerRow
            field="rating_ask_cooldown_days"
            label="settingsMore.autoTextsRatingCooldown"
            value={settings.rating_ask_cooldown_days}
            saver={saver}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t("settingsMore.autoTextsGroupWait")}>
        <div className="divide-y divide-border-subtle">
          <PickerRow
            field="scheduled_text_expiry_hours"
            label="settingsMore.autoTextsScheduledExpiry"
            value={settings.scheduled_text_expiry_hours}
            saver={saver}
          />
          <PickerRow
            field="reminder_expiry_hours"
            label="settingsMore.autoTextsReminderExpiry"
            value={settings.reminder_expiry_hours}
            saver={saver}
          />
          <PickerRow
            field="auto_reply_cooldown_minutes"
            label="settingsMore.autoTextsReplyCooldown"
            value={settings.auto_reply_cooldown_minutes}
            saver={saver}
          />
        </div>
      </SettingsCard>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          {t("settingsMore.autoTextsOwnersOnly")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settingsMore.autoTextsFixedRules")}
      </p>
    </div>
  );
}
