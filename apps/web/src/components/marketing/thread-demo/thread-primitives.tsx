/**
 * Thread-demo primitives, the marketing-owned recreation of the app's thread
 * visual language, restaged for v4 "FIRST RESPONSE" under Law 2: the product
 * is FRAMED, never repainted. Everything here renders with the APP'S OWN
 * tokens (`--app-*` / shadcn tokens, live only inside a `.app-scope` region,
 * which <PanelFrame> provides), so a demo thread keeps the app's petrol
 * primary, the app's bubbles, the app's amber notes, and flips to the app's
 * real dark mode inside `phoneDark` frames. Marketing cobalt NEVER appears
 * in here.
 *
 * The app's real MessageBubble / SystemLine / StatusPill depend on TanStack
 * Query, member hooks, and signed-URL fetches; they cannot render on a static
 * marketing route. These primitives reproduce the exact grammar
 * (thread/message-bubble.tsx, thread/system-line.tsx, inbox/status-pill.tsx)
 * with zero app runtime: inbound = white card + hairline, left; outbound =
 * the petrol app-bubble-out fill, right; note = the amber tint card with the
 * lock; events = centered quiet system lines.
 *
 * Nothing here is interactive: no tab stops, no false affordances (§7).
 */

import { Check, CheckCheck, ImageIcon, Lock, Play } from "lucide-react";

import { formatCallDuration } from "@/lib/format/call";
import { cn } from "@/lib/utils";

import type {
  CallBeat,
  DeliveryState,
  EventBeat,
  InboundBeat,
  NoteBeat,
  OutboundBeat,
} from "./script";

/** Initials from a display name, same rule as the app's member-avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Assignee/sender avatar: the app's flat single-tone treatment (petrol tint
 *  ground, petrol-deep initials, never gradients). */
export function DemoAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "app-ava-petrol inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Status pill, the app's real tint grammar (inbox/status-pill.tsx): New =
 *  petrol tint, Open = sky, Waiting = amber, Closed = plain secondary. */
const PILL_STYLES = {
  new: "bg-primary/10 text-teal-800 dark:bg-primary/15 dark:text-primary",
  open: "bg-info/10 text-sky-700 dark:bg-info/15 dark:text-info",
  waiting: "bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning",
  closed: "bg-secondary text-stone-600 dark:text-muted-foreground",
} as const;

const PILL_LABELS = {
  new: "New",
  open: "Open",
  waiting: "Waiting",
  closed: "Closed",
} as const;

export function DemoStatusPill({
  status,
  className,
}: {
  status: keyof typeof PILL_STYLES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        PILL_STYLES[status],
        className,
      )}
    >
      {PILL_LABELS[status]}
    </span>
  );
}

/** A neutral MMS thumbnail, drawn in DOM with app tokens (no raster ever). */
function PhotoThumb({ label, outbound }: { label: string; outbound?: boolean }) {
  return (
    <div
      className={cn(
        "flex size-28 flex-col items-center justify-center gap-1 rounded-app-ctrl border text-center",
        "border-app-line bg-app-inset text-app-muted",
        outbound && "self-end",
      )}
      role="img"
      aria-label={`Photo: ${label}`}
    >
      <ImageIcon className="size-5" strokeWidth={1.75} aria-hidden />
      <span className="px-2 text-[10px] leading-tight">{label}</span>
    </div>
  );
}

/** Delivery-state line, the app's grammar: Sending… → Sent ✓ → Delivered ✓✓. */
function DeliveryLine({ time, state }: { time: string; state: DeliveryState }) {
  return (
    <span className="text-[12px] text-app-muted-2">
      <span className="tabular-nums">{time}</span>
      <span aria-hidden> · </span>
      {state === "sending" && <span>Sending…</span>}
      {state === "sent" && (
        <span>
          Sent <Check aria-hidden className="inline size-3" strokeWidth={1.75} />
        </span>
      )}
      {state === "delivered" && (
        <span>
          Delivered{" "}
          <CheckCheck aria-hidden className="inline size-3" strokeWidth={1.75} />
        </span>
      )}
    </span>
  );
}

/** Inbound customer bubble: the app's white card + hairline, left, with the
 *  top-left corner squared to 5px (message-bubble.tsx). */
export function InboundBubble({ beat }: { beat: InboundBeat }) {
  return (
    <div className="flex w-full flex-col items-start gap-1">
      {beat.photo && <PhotoThumb label={beat.photo.label} />}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub border border-app-line bg-app-paper px-3.5 py-2.5 text-[14px] leading-[1.5] text-app-ink [border-top-left-radius:5px] md:max-w-[80%]">
        {beat.body}
      </div>
      <span className="text-[12px] tabular-nums text-app-muted-2">
        {beat.time}
      </span>
    </div>
  );
}

/** Outbound business bubble: the app's own petrol fill with its theme-paired
 *  foreground (app-bubble-out), right, with a delivery state. */
export function OutboundBubble({
  beat,
  state,
}: {
  beat: OutboundBeat;
  /** Live delivery state (drives the Sending… → Delivered animation). */
  state: DeliveryState;
}) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      {beat.photo && <PhotoThumb label={beat.photo.label} outbound />}
      <div className="app-bubble-out max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub px-3.5 py-2.5 text-[14px] leading-[1.5] [border-top-right-radius:5px] md:max-w-[80%]">
        {beat.body}
      </div>
      <DeliveryLine time={beat.time} state={state} />
    </div>
  );
}

/** Internal note: the app's amber tint card + amber lock label, locked and
 *  never sent to the customer. */
export function NoteBubble({ beat }: { beat: NoteBeat }) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub border border-app-amber-line bg-app-amber-bg px-3.5 py-2.5 text-[14px] leading-[1.5] text-app-amber-ink [border-bottom-right-radius:5px] md:max-w-[80%]">
        {/* #320: the label read `text-app-amber`, the MARK colour — 11px
            semibold at 2.66:1 on this fill. The ink is the text colour, and
            the parent was already using it. The Lock keeps the mark. */}
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber-ink">
          <Lock
            className="size-3 text-app-amber"
            strokeWidth={1.75}
            aria-hidden
          />
          Internal note · {beat.by}
        </span>
        {beat.body}
      </div>
      <span className="text-[12px] tabular-nums text-app-muted-2">
        {beat.time}
      </span>
    </div>
  );
}

/** Centered system/event line, the app's quiet timeline voice. */
export function EventLine({ beat }: { beat: EventBeat }) {
  return (
    <p className="py-1 text-center text-xs text-muted-foreground">
      {beat.text}
    </p>
  );
}

/**
 * The sentence a call gets in the timeline. Every arm is lifted from the
 * app's own `eventSentence` (components/thread/system-line.tsx) so the demo
 * cannot drift into wording the product would never print, which is the exact
 * failure #491 was filed for in the other direction.
 */
export function callSentence(beat: CallBeat): string {
  if (beat.direction === "outbound") {
    if (beat.outcome === "missed") return "Called, no answer";
    return beat.seconds
      ? `You called · ${formatCallDuration(beat.seconds)}`
      : "You called";
  }
  if (beat.voicemail) {
    return beat.voicemail.seconds
      ? `Left a voicemail · ${formatCallDuration(beat.voicemail.seconds)}`
      : "Left a voicemail";
  }
  if (beat.outcome === "voicemail") return "Call went to voicemail";
  if (beat.outcome === "missed") return "Missed call";
  return beat.seconds
    ? `Call answered · ${formatCallDuration(beat.seconds)}`
    : "Call answered";
}

/** The missed-call text-back line, verbatim from the app's `missed_call` arm. */
export const MISSED_CALL_TEXT_BACK_LINE =
  "This customer called and no one picked up, so we texted them back";

/**
 * The voicemail player AT REST, depicted. The app's real <VoicemailPlayer> is
 * a button that fetches a signed URL; this is the same pill in the same
 * tokens rendered as a span, because the demo adds zero tab stops (§7) and
 * there is no recording behind it. Same rule the composer's Send follows.
 */
function VoicemailPill({ seconds }: { seconds: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-app-line bg-app-paper px-2.5 py-1 text-[12px] font-medium text-app-ink">
      <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
      Play voicemail ({formatCallDuration(seconds)})
    </span>
  );
}

/**
 * A call in the thread: the app's quiet centered line, plus the D43 voicemail
 * block (player then transcript) when the caller left a message, plus the
 * automatic text-back line when it fired. Structure and tokens match
 * SystemLine's voicemail branch exactly.
 */
export function CallLine({ beat }: { beat: CallBeat }) {
  const sentence = callSentence(beat);

  if (!beat.voicemail) {
    return (
      <div className="py-1 text-center">
        <p className="text-xs text-muted-foreground">{sentence}</p>
        {beat.textBack && (
          <p className="text-xs text-muted-foreground">
            {MISSED_CALL_TEXT_BACK_LINE}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 py-1 text-center">
      <p className="text-xs text-muted-foreground">{sentence}</p>
      <div className="flex justify-center">
        <VoicemailPill seconds={beat.voicemail.seconds} />
      </div>
      {/* The words, right where the message is (#367 voicemail transcripts):
          without them the line only says a voicemail exists, which still
          leaves the reader having to stop and play it. */}
      <p className="mx-auto max-w-[36rem] text-[12.5px] leading-[1.45] text-app-muted">
        {beat.voicemail.transcript}
      </p>
      {beat.textBack && (
        <p className="text-xs text-muted-foreground">
          {MISSED_CALL_TEXT_BACK_LINE}
        </p>
      )}
    </div>
  );
}
