"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  DEFAULT_LOCALE,
  type DeferralKind,
  followUpPresets,
  isSnoozeTargetValid,
  SNOOZE_NOTE_MAX,
  snoozePresets,
  snoozeReturnShape,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { makeTranslate, useT, type Translate } from "@/i18n/provider";
import { formatTimestamp } from "@/lib/format/time";

/** English, for a caller with no provider around it. */
const EN = makeTranslate(DEFAULT_LOCALE);

/**
 * The custom-date dialog. Rendered by the PARENT, outside the dropdown — see
 * SnoozeMenuItems for why that is not a style choice.
 */
export function SnoozeDialog({
  open,
  kind,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** Which ladder the reader came from — it changes what this promises. */
  kind: DeferralKind;
  onOpenChange: (open: boolean) => void;
  onConfirm: (untilIso: string, note?: string) => void;
}) {
  const t = useT();
  // Smart Defaults: the field starts on the next preset, so "pick a date" is an
  // adjustment rather than a blank form. Read at open time, not at mount, so a
  // dialog opened tomorrow does not still offer yesterday.
  const initial = () =>
    (kind === "follow_up" ? followUpPresets() : snoozePresets())[0]?.at ??
    Date.now() + 3_600_000;
  const [value, setValue] = useState(() => toLocalInput(initial()));
  // The reason, optional, and only here. A preset is one tap and stays one tap;
  // somebody who has opened a date picker is already deliberating, and "waiting
  // on the supplier" three days later is the difference between a list you can
  // read and a list of names.
  const [note, setNote] = useState("");

  const parsed = value === "" ? Number.NaN : new Date(value).getTime();
  const valid = !Number.isNaN(parsed) && isSnoozeTargetValid(parsed);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setValue(toLocalInput(initial()));
          setNote("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === "follow_up"
              ? t("thread.remindMeToChaseTitle")
              : t("thread.snoozeUntilTitle")}
          </DialogTitle>
          <DialogDescription>
            {kind === "follow_up"
              ? // The cancellation is the reassuring half, and the half nobody
                // believes until it is written down.
                t("thread.followUpDescription")
              : t("thread.snoozeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={value}
            aria-label={t("thread.returnDateAria")}
            onChange={(event) => setValue(event.target.value)}
          />
          <Input
            value={note}
            // The column's CHECK, stated once in shared. Stopping here turns a
            // Postgres error into a field that simply stops taking characters.
            maxLength={SNOOZE_NOTE_MAX}
            placeholder={t("thread.whyPlaceholder")}
            aria-label={t("thread.whySnoozingAria")}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onOpenChange(false);
              onConfirm(
                new Date(parsed).toISOString(),
                note.trim() === "" ? undefined : note.trim(),
              );
            }}
          >
            {kind === "follow_up" ? t("thread.remindMe") : t("thread.snooze")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "3:00 PM" / "Mon 8:00 AM" — enough to know what you are choosing. */
export function formatPresetHint(at: number, t: Translate): string {
  return formatTimestamp(new Date(at).toISOString(), { style: "long", t });
}

/**
 * The four sentences a return time can lead with.
 *
 * A LEAD is a whole sentence in the catalogue, not a word spliced onto the
 * front of one. The version this replaces was
 * `snoozeReturnLabel(until).replace("Back", "Chase")` — a rule about English
 * grammar written as a regex, which does nothing at all once the label is
 * French and fails silently when it does: the chip goes on saying "back" where
 * it means "chase", and nothing in the type system notices.
 */
const DEFERRAL_LEAD_KEYS = {
  back: "thread.snoozeLeadBack",
  chase: "thread.snoozeLeadChase",
  snoozedToast: "thread.snoozeLeadSnoozedToast",
  remindToast: "thread.snoozeLeadRemindToast",
} as const;

export type DeferralLead = keyof typeof DEFERRAL_LEAD_KEYS;

/**
 * "Back at 3:00 PM" / "Chase Thursday, 8:00 AM" / "Back 12 Aug".
 *
 * The shared module decides the SHAPE; the day and month names are the
 * browser's `Intl`, so a phone in French says août rather than whatever a
 * hand-rolled month table would have said.
 */
export function deferralReturnLabel(
  until: string,
  lead: DeferralLead = "back",
  t: Translate = EN,
  now: Date = new Date(),
): string {
  const date = new Date(until);
  // Never a blank chip: the row is in this view BECAUSE it is deferred, so a
  // timestamp we cannot read still has to say that much (#293).
  if (Number.isNaN(date.getTime())) return t("thread.snoozedFallback");
  const time = date.toLocaleTimeString(t.locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const when = ((): string => {
    switch (snoozeReturnShape(date, now)) {
      case "today":
        return t("thread.snoozeWhenAt", { time });
      case "tomorrow":
        return t("thread.snoozeWhenTomorrow", { time });
      case "weekday":
        return t("thread.snoozeWhenWeekday", {
          weekday: date.toLocaleDateString(t.locale, { weekday: "long" }),
          time,
        });
      case "date":
        return t("thread.snoozeWhenDate", {
          date: date.toLocaleDateString(t.locale, {
            day: "numeric",
            month: "short",
          }),
        });
    }
  })();
  return t(DEFERRAL_LEAD_KEYS[lead], { when });
}

/** Shared toast copy, so the thread and the inbox say the same thing. */
export function toastSnoozed(
  until: string,
  kind: DeferralKind = "snooze",
  t: Translate = EN,
): void {
  toast.success(
    deferralReturnLabel(
      until,
      kind === "follow_up" ? "remindToast" : "snoozedToast",
      t,
    ),
  );
}

/** ISO instant / epoch ms → the local wall-clock string datetime-local wants. */
function toLocalInput(at: number): string {
  const d = new Date(at);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
