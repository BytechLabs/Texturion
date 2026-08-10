"use client";

import { CalendarClock, Clock } from "lucide-react";
import { useState } from "react";

import {
  CLOCK_CHOICE_DEFAULT,
  CLOCK_CHOICE_LABELS,
  type ClockChoice,
  instantForWallClock,
  sameClock,
  SCHEDULED_HORIZON_DAYS,
  schedulePresets,
  scheduledClockProvenance,
} from "@loonext/shared";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import { useT } from "@/i18n/provider";
import type { DestinationClock } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #233 — "send this Monday at 8", from the composer.
 *
 * Design notes, and the principles behind them:
 *
 * - **Zen of Clarity.** This is a chevron on the existing Send pill, not a
 *   second button. The composer's own comment calls Send "the single petrol
 *   control in this region", and that is a real invariant: two primaries side
 *   by side would make the common action slower to find in order to make the
 *   rare one faster.
 * - **Chunking.** Two presets and a way out. #233 names exactly these, and the
 *   count is the point — a preset list long enough to read is slower than the
 *   picker it was supposed to replace.
 * - **Smart Defaults.** "Pick a time…" opens pre-filled with the next preset.
 *   Nobody should have to type a date to delay a text by twelve hours.
 * - **No ethical friction on the way in.** Scheduling is undoable until it
 *   fires, so it gets a plain confirm. The friction lives on the ONE
 *   irreversible edge: a time inside the customer's quiet hours, where the API
 *   returns 409 and the composer asks. *Applying: Ethical Friction, reserved
 *   for the irreversible.*
 *
 * WHOSE 8AM. The presets are computed in the DESTINATION's zone, and the menu
 * says which rung answered rather than presenting an inference as a fact. On
 * the weakest rung this is the shop's own clock, and the line says so — the
 * same wording the thread's "their time" hint uses, because a product that
 * describes one fact two ways has two vocabularies rather than one.
 *
 * The custom dialog is NOT rendered here. A Radix Dialog mounted inside
 * DropdownMenuContent unmounts the instant the menu closes, so the parent owns
 * it — the same trap `snooze-menu.tsx` documents, and the reason this file is
 * split the same way.
 */
export function SendLaterMenuItems({
  clock,
  onSchedule,
  onPickCustom,
}: {
  /** The destination's resolved clock. Null when we have no contact. */
  clock: DestinationClock | null;
  onSchedule: (sendAtIso: string) => void;
  onPickCustom: () => void;
}) {
  const t = useT();
  const zone = clock?.timezone ?? deviceZone();
  // Resolved on every render rather than memoized, matching the snooze ladder:
  // the presets only change when the clock crosses 8am there, and on that
  // render the NEW pair is the correct one.
  const presets = schedulePresets(new Date(), zone);

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {clock
          ? t("thread.theirClock", {
              source: scheduledClockProvenance(clock.source),
            })
          : t("thread.yourWorkspaceTime")}
      </DropdownMenuLabel>
      {presets.map((preset) =>
        preset.at ? (
          <DropdownMenuItem
            key={preset.id}
            onSelect={() => onSchedule((preset.at as Date).toISOString())}
          >
            <Clock className="size-4" strokeWidth={1.75} />
            <span>{preset.label}</span>
            <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">
              {formatPresetHint(preset.at, zone)}
            </span>
          </DropdownMenuItem>
        ) : null,
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onPickCustom}>
        <CalendarClock className="size-4" strokeWidth={1.75} />
        {t("thread.pickATime")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * The custom-time dialog. Rendered by the PARENT, outside the dropdown — see
 * `SendLaterMenuItems` for why that is not a style choice.
 */
export function SendLaterDialog({
  open,
  clock,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  clock: DestinationClock | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sendAtIso: string) => void;
}) {
  const t = useT();
  const zone = clock?.timezone ?? deviceZone();
  const here = deviceZone();
  // #539: WHICH CLOCK THE TYPED TIME IS IN — the switch the issue asks for
  // ("why cant i choose? let me switch?").
  //
  // Only offered when it would change the answer. If the customer's clock reads
  // the same as the reader's, a Their/Your toggle is two buttons that do exactly
  // the same thing, which is worse than no toggle at all.
  const [choice, setChoice] = useState<ClockChoice>(CLOCK_CHOICE_DEFAULT);
  const canSwitch =
    clock !== null && !sameClock(nowIn(zone), nowIn(here));

  // Smart Defaults: starts on the next preset, so this is an adjustment rather
  // than a blank form. Read at OPEN time, not at mount, so a dialog opened
  // tomorrow does not still offer yesterday.
  const initial = () =>
    schedulePresets(new Date(), zone)[0]?.at ?? new Date(Date.now() + 3_600_000);
  const [value, setValue] = useState(() => toLocalInput(initial()));

  // The instant the typed wall clock means, in whichever clock is selected.
  //
  // The FIELD always holds the device's wall time — a datetime-local cannot do
  // otherwise — so "their time" is a reinterpretation of the same digits, not a
  // different field. Handing the digits to the shared resolver is what makes that
  // correct on the two days a year the clocks move.
  const resolved =
    choice === "theirs" && canSwitch
      ? instantForWallClock(parseLocalInput(value), zone)
      : value === ""
        ? null
        : new Date(value);
  const parsed = resolved === null ? Number.NaN : resolved.getTime();
  const horizon = Date.now() + SCHEDULED_HORIZON_DAYS * 86_400_000;
  // Both bounds mirror the API's, so the field goes quiet rather than letting
  // somebody submit into a rejection they could have been shown.
  const valid =
    !Number.isNaN(parsed) && parsed > Date.now() && parsed <= horizon;
  // The same instant on the OTHER clock, so nobody has to do the arithmetic the
  // issue complained about ("what about my timzeone equivalent?").
  const equivalent =
    valid && canSwitch
      ? choice === "theirs"
        ? t("thread.thatsYourTime", { when: clockAt(new Date(parsed), here) })
        : t("thread.thatsTheirTime", { when: clockAt(new Date(parsed), zone) })
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(toLocalInput(initial()));
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("thread.sendLater")}</DialogTitle>
          <DialogDescription>
            {/* #539: the field is the sender's own wall clock unless they say
                otherwise, and now they CAN say otherwise. Before this the
                sentence explained the constraint and left the reader to do the
                arithmetic; the switch below removes the arithmetic entirely. */}
            {canSwitch
              ? t("thread.pickWhichClock", { delta: hoursApart(zone) })
              : t("thread.yourOwnTime")}
          </DialogDescription>
        </DialogHeader>
        {canSwitch && (
          // Two buttons, not a zone picker. The question a sender has is "did I
          // mean 8am here or 8am there" — offering 400 IANA zones to answer it
          // would be a worse version of the same confusion.
          // *Applying: the Safety Principle — a segmented control in a
          // conventional place, matching the 7/30/90 pickers elsewhere.*
          <div
            role="group"
            aria-label={t("thread.whichClockAria")}
            className="flex gap-1 rounded-full bg-app-inset p-0.5"
          >
            {(["yours", "theirs"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={choice === option}
                onClick={() => setChoice(option)}
                className={cn(
                  "flex-1 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
                  choice === option
                    ? "bg-app-paper text-app-ink shadow-xs"
                    : "text-app-muted hover:text-app-ink",
                )}
              >
                {CLOCK_CHOICE_LABELS[option]}
              </button>
            ))}
          </div>
        )}
        <Input
          type="datetime-local"
          value={value}
          aria-label={
            canSwitch
              ? t("thread.sendDateTimeClockAria", {
                  clock: CLOCK_CHOICE_LABELS[choice].toLowerCase(),
                })
              : t("thread.sendDateTimeAria")
          }
          onChange={(event) => setValue(event.target.value)}
        />
        {/* The same instant on the other clock. This is the "my timezone
            equivalent" the issue asked for, and it is a rendered time rather than
            an hours-apart number — which is wrong every day in the half-hour
            zones and wrong twice a year everywhere else. */}
        {equivalent && (
          <p role="status" className="text-[12.5px] text-app-muted">
            {equivalent}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onOpenChange(false);
              onConfirm(new Date(parsed).toISOString());
            }}
          >
            {t("thread.schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The quiet-hours confirmation.
 *
 * The one place this feature earns a dialog. #225 ask 2 is that a human is
 * WARNED and never blocked, so this states the hour there and offers to go
 * ahead — it does not refuse.
 */
export function QuietHoursConfirm({
  open,
  localHour,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  localHour: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("thread.landsLateTitle")}</DialogTitle>
          <DialogDescription>
            {localHour === null
              ? t("thread.quietHoursNoHour")
              : t("thread.quietHoursAround", {
                  hour: formatHour(localHour),
                })}{" "}
            {t("thread.quietHoursTail")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("thread.pickAnotherTime")}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {t("thread.scheduleItAnyway")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Tue 8:00 AM" in the DESTINATION's zone — enough to know what you picked. */
function formatPresetHint(at: Date, timeZone: string): string {
  return at.toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/** The browser's own zone, when we have no contact to resolve one from. */
function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * "3 hours behind you" — the one sentence that makes a sender's-clock field
 * safe to use for a customer in another zone.
 *
 * Measured rather than assumed from an offset table, so it is right across a
 * DST boundary where the two zones change on different dates.
 */
export function hoursApart(timeZone: string): string {
  const now = new Date();
  const there = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const here = now.getHours();
  // Wrapped into (-12, 12] so "23 hours ahead" reads as "an hour behind".
  let delta = there - here;
  if (delta > 12) delta -= 24;
  if (delta < -12) delta += 24;

  if (delta === 0) return "on the same clock";
  const magnitude = Math.abs(delta) === 1 ? "an hour" : `${Math.abs(delta)} hours`;
  return `${magnitude} ${delta > 0 ? "ahead of" : "behind"} you`;
}

/**
 * An instant as the wall-clock string `datetime-local` wants — in the DEVICE's
 * zone, which is the only zone that round-trips.
 *
 * This looked wrong at first and is not. `<input type="datetime-local">` yields
 * a bare wall clock with no zone, and `new Date(thatString)` parses it as the
 * BROWSER's local time. Rendering the customer's 8am into the field as "08:00"
 * and reading it back would therefore mean 8am HERE — a silent several-hour
 * error, invisible in every test where the two zones happen to match, and
 * exactly the bug this feature would be blamed for.
 *
 * So the field is the sender's own clock and the dialog says so, while the
 * PRESETS remain the customer's morning and are hinted in their zone. One
 * ambiguous field showing two zones would be worse than either.
 */
export function toLocalInput(at: Date): string {
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * The reverse: the digits in a `datetime-local` field, as a bare wall clock.
 *
 * #539: deliberately NOT `new Date(value)`, which would resolve those digits in
 * the DEVICE's zone. The point of the switch is to resolve the same digits in the
 * customer's zone instead, so they have to leave this function as numbers and let
 * the shared resolver decide the instant.
 *
 * An empty or malformed field yields NaNs, which the resolver rejects and the
 * caller reads as "not valid yet" — the same state a blank field was already in.
 */
export function parseLocalInput(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  const n = (index: number): number =>
    match ? Number(match[index]) : Number.NaN;
  return {
    year: n(1),
    month: n(2),
    day: n(3),
    hour: n(4),
    minute: n(5),
  };
}

/** "8:00 AM" at an instant, in a zone. Used for the other-clock line. */
function clockAt(at: Date, timeZone: string): string {
  try {
    return at.toLocaleString(undefined, {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return at.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

/**
 * What a zone's clock reads RIGHT NOW, used only to decide whether the switch is
 * worth showing.
 *
 * If the customer's clock reads the same as the reader's, a Their/Your toggle is
 * two buttons that do the same thing — worse than no toggle, because it implies a
 * difference that is not there.
 */
function nowIn(timeZone: string): string {
  return clockAt(new Date(), timeZone);
}
