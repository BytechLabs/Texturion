"use client";

import { Mic, Square } from "lucide-react";

import { AiOrb, AiStatus } from "@/components/ui/ai-orb";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * #507 Phase 1 — the two visible pieces of dictating a post-call wrap-up.
 *
 * The state lives in the composer, because the words this produces go into the
 * composer's own textarea to be read and edited: this is a suggestion the
 * member posts, not a second way to write a note. Same arrangement as
 * ReplySuggestionChips.
 *
 * THE ONE LINE THAT CANNOT DRIFT. Every string here is about the member's own
 * voice, after a call has ended. Nothing in this product listens to a call or
 * records a customer (D117), and copy that blurred that would be false — which
 * is why "Your voice, after the call" is on screen while the mic is open,
 * rather than buried in a settings page nobody opens.
 */

/** `0:07`, `1:42` — a recording clock, not a duration ("7s" reads as a file). */
export function formatWrapUpClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * The control inside the note pill, beside the paperclip.
 *
 * PRESS TO START, PRESS TO STOP — not press-and-hold, which is what a phone
 * does. A hold cannot be operated from a keyboard at all (Space and Enter fire
 * a click, never a sustained press), so a hold here would put the feature out
 * of reach of anybody not using a mouse, and a mouse that slips off the button
 * mid-sentence would silently end the recording. The deliberateness a hold buys
 * on a phone is bought here by the recording strip, which is impossible to miss
 * and one click from cancelling.
 *
 * *Applying: the Safety Principle — a conventional record/stop toggle, in the
 * cluster where "add something to this note" already lives.*
 */
export function WrapUpButton({
  recording,
  transcribing,
  onStart,
  onStop,
}: {
  recording: boolean;
  /** The words are on their way back — the mic is already closed. */
  transcribing: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const label = recording
    ? "Stop and write it down"
    : transcribing
      ? "Writing your wrap-up down"
      : "Dictate a wrap-up";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={recording}
          disabled={transcribing}
          onClick={recording ? onStop : onStart}
          className={cn(
            "rounded-full",
            recording ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {transcribing ? (
            <AiOrb state="thinking" size={18} />
          ) : recording ? (
            <Square className="size-4 fill-current" strokeWidth={1.75} />
          ) : (
            <Mic className="size-5" strokeWidth={1.75} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {recording
          ? "Stop and write it down"
          : transcribing
            ? "Writing your wrap-up down…"
            : "Say what happened after a call. Your voice, not the call — Lou writes your words down for you to check."}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The strip above the pill: what is happening, how long it has been happening,
 * and the way out.
 *
 * It occupies the same reading track and the same slot as Lou's reply drafts,
 * so the composer never grows a region it did not have before — it swaps what
 * is in one.
 */
export function WrapUpStrip({
  recording,
  transcribing,
  seconds,
  maxSeconds,
  error,
  onCancel,
}: {
  recording: boolean;
  transcribing: boolean;
  seconds: number;
  maxSeconds: number;
  /** A finished sentence explaining why the last attempt produced no words. */
  error: string | null;
  onCancel: () => void;
}) {
  if (!recording && !transcribing && error === null) return null;
  return (
    <div className="mx-auto max-w-[42rem] px-1 pb-2">
      {recording && (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 animate-pulse rounded-full bg-destructive"
          />
          {/* aria-live so a screen reader hears that the mic actually opened;
              `off` on the clock itself, which would otherwise announce a new
              number every second for two minutes. */}
          <span className="text-[11px] font-medium text-foreground" aria-live="polite">
            Recording your wrap-up
          </span>
          <span
            className="text-[11px] tabular-nums text-muted-foreground"
            aria-live="off"
          >
            {formatWrapUpClock(seconds)} / {formatWrapUpClock(maxSeconds)}
          </span>
          <button
            type="button"
            onClick={onCancel}
            // tap-target: an 11px pill is the smallest thing on this strip and
            // the one somebody reaches for in a hurry (G11 ≥44px on mobile,
            // hit area only — no layout shift).
            className="tap-target ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      {transcribing && <AiStatus state="thinking" label="Writing it down…" />}
      {/* The distinction the whole feature rests on, stated where it is being
          relied upon rather than only in Settings (D117).

          SCOPED TO THIS FEATURE ON PURPOSE. An earlier draft said "Loonext
          never listens to a call and never records a customer", which is FALSE:
          voicemail records a caller's voice at the beep and keeps it a year
          (legal/privacy). Making a product-wide absolute claim in order to
          reassure somebody about one feature is the kind of thing that is
          quietly untrue until the day it matters. This says what is true of
          the thing they are doing right now. */}
      {(recording || transcribing) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Your voice, after the call has ended — never the call itself.
        </p>
      )}
      {/* Inline, not a toast: a toast leaves after four seconds and this is the
          sentence that says which of "try again" and "go fix a permission" is
          the thing to do. The composer behind it is untouched and still has the
          keyboard. */}
      {error !== null && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
