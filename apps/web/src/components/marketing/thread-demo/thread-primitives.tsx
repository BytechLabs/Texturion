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

import { Check, CheckCheck, ImageIcon, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

import type {
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
        "border-app-line bg-app-stone-1 text-app-muted",
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
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub border border-app-line bg-app-white px-3.5 py-2.5 text-[14px] leading-[1.5] text-app-ink [border-top-left-radius:5px] md:max-w-[80%]">
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
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
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
