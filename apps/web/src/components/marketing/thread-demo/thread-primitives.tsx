/**
 * Thread-demo primitives (Track B), a marketing-owned reimplementation of the
 * app's thread visual language (DESIGN.md G5) with zero app runtime.
 *
 * The app's real MessageBubble / SystemLine / StatusPill depend on TanStack
 * Query, member hooks, and signed-URL fetches; they cannot render on a static
 * marketing route. These primitives reproduce the exact tokens, inbound white
 * card + stone border, outbound teal-50/teal-900, amber dashed internal note
 * with a lock, centered 12px system lines, delivery states with Check /
 * CheckCheck, so the two visual sets are identical (BLUEPRINT §1.3), while
 * staying self-contained enough to hydrate as a sub-15KB island.
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

/** Assignee/sender avatar, petrol-tinted circle with initials (G4). */
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
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Status pill, the G4 tints, matched to components/inbox/status-pill.tsx. */
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

/** A neutral MMS thumbnail placeholder, no raster, drawn in DOM (BLUEPRINT §1.3). */
function PhotoThumb({ label, outbound }: { label: string; outbound?: boolean }) {
  return (
    <div
      className={cn(
        "flex size-28 flex-col items-center justify-center gap-1 rounded-lg border text-center",
        "border-border bg-gradient-to-br from-stone-100 to-stone-200 text-stone-500",
        "dark:from-stone-800 dark:to-stone-900 dark:text-stone-400",
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

/** Delivery-state line (G5): Sending… → Sent ✓ → Delivered ✓✓. */
function DeliveryLine({ time, state }: { time: string; state: DeliveryState }) {
  return (
    <span className="text-[12px] text-muted-foreground">
      <span>{time}</span>
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

/** Inbound customer bubble, white card, 1px stone border, left. */
export function InboundBubble({ beat }: { beat: InboundBeat }) {
  return (
    <div className="flex w-full flex-col items-start gap-1">
      {beat.photo && <PhotoThumb label={beat.photo.label} />}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] border border-border bg-card px-3 py-2 text-[15px] leading-normal text-card-foreground md:max-w-[80%]">
        {beat.body}
      </div>
      <span className="text-[12px] text-muted-foreground">{beat.time}</span>
    </div>
  );
}

/** Outbound business bubble, teal-50/teal-900, right, with a delivery state. */
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
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] bg-teal-50 px-3 py-2 text-[15px] leading-normal text-teal-900 dark:bg-teal-950 dark:text-teal-100 md:max-w-[80%]">
        {beat.body}
      </div>
      <DeliveryLine time={beat.time} state={state} />
    </div>
  );
}

/** Internal note, amber-50 dashed card, lock + "Internal note" (G5). */
export function NoteBubble({ beat }: { beat: NoteBeat }) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[15px] leading-normal text-stone-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100 md:max-w-[80%]">
        <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-warning">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
          Internal note · {beat.by}
        </span>
        {beat.body}
      </div>
      <span className="text-[12px] text-muted-foreground">{beat.time}</span>
    </div>
  );
}

/** Centered system/event line (G5): "Priya assigned this to Dale". */
export function EventLine({ beat }: { beat: EventBeat }) {
  return (
    // Full muted-foreground (stone-500, 4.79:1 on the white card), NOT /80: the
    // opacity dilution dropped it to 3.28:1 and failed the color-contrast audit.
    <p className="py-1 text-center text-xs text-muted-foreground">{beat.text}</p>
  );
}
