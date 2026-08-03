"use client";

import { CalendarClock, Clock } from "lucide-react";
import { useState } from "react";

import {
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
import type { DestinationClock } from "@/lib/api/types";

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
  const zone = clock?.timezone ?? deviceZone();
  // Resolved on every render rather than memoized, matching the snooze ladder:
  // the presets only change when the clock crosses 8am there, and on that
  // render the NEW pair is the correct one.
  const presets = schedulePresets(new Date(), zone);

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {clock
          ? `Their clock — ${scheduledClockProvenance(clock.source)}`
          : "Your workspace's time"}
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
        Pick a time…
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
  const zone = clock?.timezone ?? deviceZone();
  // Smart Defaults: starts on the next preset, so this is an adjustment rather
  // than a blank form. Read at OPEN time, not at mount, so a dialog opened
  // tomorrow does not still offer yesterday.
  const initial = () =>
    schedulePresets(new Date(), zone)[0]?.at ?? new Date(Date.now() + 3_600_000);
  const [value, setValue] = useState(() => toLocalInput(initial()));

  const parsed = value === "" ? Number.NaN : new Date(value).getTime();
  const horizon = Date.now() + SCHEDULED_HORIZON_DAYS * 86_400_000;
  // Both bounds mirror the API's, so the field goes quiet rather than letting
  // somebody submit into a rejection they could have been shown.
  const valid =
    !Number.isNaN(parsed) && parsed > Date.now() && parsed <= horizon;

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
          <DialogTitle>Send later</DialogTitle>
          <DialogDescription>
            {/* Which clock this FIELD is in, stated plainly. The presets above
                are the customer's morning; this box is the sender's own wall
                clock, because that is the only zone a datetime-local input can
                round-trip without silently shifting by hours. */}
            This is your own time
            {clock && clock.source !== "company"
              ? `, and they are ${hoursApart(clock.timezone)}`
              : ""}
            . You can change or cancel it any time before it goes.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="datetime-local"
          value={value}
          aria-label="Send date and time"
          onChange={(event) => setValue(event.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onOpenChange(false);
              onConfirm(new Date(parsed).toISOString());
            }}
          >
            Schedule
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>That lands late where they are</DialogTitle>
          <DialogDescription>
            {localHour === null
              ? "That time is inside this customer's quiet hours."
              : `That is around ${formatHour(localHour)} for this customer.`}{" "}
            You can send it anyway, or pick a time in their morning.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Pick another time
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Schedule it anyway
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
