"use client";

import {
  AlarmClock,
  AlarmClockOff,
  BellRing,
  CalendarClock,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  type DeferralKind,
  followUpPresets,
  isSnoozeTargetValid,
  SNOOZE_NOTE_MAX,
  snoozePresets,
  snoozeReturnShape,
} from "@loonext/shared";

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

/**
 * #293 — "needs attention, but on Thursday", in the overflow menu.
 *
 * Design notes, and the principles behind them:
 *
 * - **Zen of Clarity.** This lives inside the existing overflow submenu rather
 *   than becoming a fifth control in a header that #2 was explicitly about
 *   decluttering. Deferring is a secondary action; it does not earn bar space.
 * - **Chunking.** At most four presets are ever shown, and the ladder shrinks
 *   as the day goes: at 4pm there is no "This afternoon" to offer, so it is not
 *   offered — a disabled button is a worse answer than a shorter list.
 * - **Smart Defaults.** "Pick a date…" opens pre-filled with the next preset,
 *   never an empty field. Nobody should have to type a date to defer a thread.
 * - **No ethical friction.** A snooze is reversible in one tap and cancels
 *   itself the moment the customer replies, so it gets a plain confirm, not a
 *   confirmation dialog. Friction is for the irreversible.
 *
 * Every instant is resolved in the DEVICE's clock, which is the user's clock
 * (#292) — the shared module decides which instants, so the phone apps offer
 * the same ladder to the minute.
 *
 * The custom-date dialog is NOT rendered here, and that is load-bearing: a
 * Radix Dialog mounted inside DropdownMenuContent is unmounted the instant the
 * menu closes, so choosing "Pick a date…" would close the menu and take the
 * dialog with it — a control that silently does nothing. The parent owns the
 * dialog and renders `SnoozeDialog` outside the menu.
 */
export function SnoozeMenuItems({
  snoozedUntil,
  snoozeKind,
  onSnooze,
  onUnsnooze,
  onPickCustom,
}: {
  /** The caller's own return time, or null when the thread is not deferred. */
  snoozedUntil: string | null;
  /** How it comes back. Null when the thread is not deferred. */
  snoozeKind: DeferralKind | null;
  onSnooze: (until: string, kind: DeferralKind) => void;
  onUnsnooze: () => void;
  /** Open the parent-owned custom-date dialog for this kind. */
  onPickCustom: (kind: DeferralKind) => void;
}) {
  // Resolved on every render rather than memoized. The ladder only changes when
  // the clock crosses a preset's hour, and on that render the NEW ladder is the
  // correct one — a memo would keep offering "This afternoon" at 3:05pm.
  if (snoozedUntil) {
    return (
      <DropdownMenuItem onSelect={onUnsnooze}>
        <AlarmClockOff className="size-4" strokeWidth={1.75} />
        {snoozeKind === "follow_up" ? "Cancel the reminder" : "Bring back now"}
      </DropdownMenuItem>
    );
  }

  return (
    <>
      <DeferralSubmenu
        kind="snooze"
        label="Snooze until…"
        icon={<AlarmClock className="size-4" strokeWidth={1.75} />}
        presets={snoozePresets()}
        onSnooze={onSnooze}
        onPickCustom={onPickCustom}
      />
      {/* #293: a SECOND ladder, not a second label on the first. "This
          afternoon" is a sensible time to pick a thread back up and a
          meaningless time to chase a quote — one ladder for both would put
          three useless options in front of whichever job you were doing. */}
      <DeferralSubmenu
        kind="follow_up"
        label="Remind me to chase…"
        icon={<BellRing className="size-4" strokeWidth={1.75} />}
        presets={followUpPresets()}
        onSnooze={onSnooze}
        onPickCustom={onPickCustom}
      />
    </>
  );
}

function DeferralSubmenu({
  kind,
  label,
  icon,
  presets,
  onSnooze,
  onPickCustom,
}: {
  kind: DeferralKind;
  label: string;
  icon: React.ReactNode;
  presets: { id: string; label: string; at: number }[];
  onSnooze: (until: string, kind: DeferralKind) => void;
  onPickCustom: (kind: DeferralKind) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {icon}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {presets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            onSelect={() =>
              onSnooze(new Date(preset.at).toISOString(), kind)
            }
          >
            <span>{preset.label}</span>
            <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">
              {formatPresetHint(preset.at)}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => onPickCustom(kind)}>
          <CalendarClock className="size-4" strokeWidth={1.75} />
          Pick a date…
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

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
            {kind === "follow_up" ? "Remind me to chase" : "Snooze until"}
          </DialogTitle>
          <DialogDescription>
            {kind === "follow_up"
              ? // The cancellation is the reassuring half, and the half nobody
                // believes until it is written down.
                "It comes back then as something to chase — unless they reply first, in which case there is nothing to chase and the reminder disappears."
              : "It comes back to your inbox then — and immediately if the customer replies before that."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={value}
            aria-label="Return date and time"
            onChange={(event) => setValue(event.target.value)}
          />
          <Input
            value={note}
            // The column's CHECK, stated once in shared. Stopping here turns a
            // Postgres error into a field that simply stops taking characters.
            maxLength={SNOOZE_NOTE_MAX}
            placeholder="Why? (optional)"
            aria-label="Why you are snoozing this"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
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
            {kind === "follow_up" ? "Remind me" : "Snooze"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "3:00 PM" / "Mon 8:00 AM" — enough to know what you are choosing. */
function formatPresetHint(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return snoozeReturnShape(date) === "today"
    ? time
    : `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/**
 * "Back this afternoon" / "Back Thu 8:00 AM" / "Back 12 Aug".
 *
 * The shared module decides the SHAPE; the formatting is the browser's, so a
 * phone in French says août rather than whatever a hand-rolled month table
 * would have said.
 */
export function snoozeReturnLabel(until: string, now: Date = new Date()): string {
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) return "Snoozed";
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  switch (snoozeReturnShape(date, now)) {
    case "today":
      return `Back at ${time}`;
    case "tomorrow":
      return `Back tomorrow, ${time}`;
    case "weekday":
      return `Back ${date.toLocaleDateString(undefined, { weekday: "long" })}, ${time}`;
    case "date":
      return `Back ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
}

/** Shared toast copy, so the thread and the inbox say the same thing. */
export function toastSnoozed(until: string, kind: DeferralKind = "snooze"): void {
  const when = snoozeReturnLabel(until);
  toast.success(
    kind === "follow_up"
      ? when.replace(/^Back/, "I'll remind you — back")
      : when.replace(/^Back/, "Snoozed — back"),
  );
}

/** ISO instant / epoch ms → the local wall-clock string datetime-local wants. */
function toLocalInput(at: number): string {
  const d = new Date(at);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
