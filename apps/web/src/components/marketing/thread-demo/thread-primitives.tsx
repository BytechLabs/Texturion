/**
 * Thread-demo primitives (Track B), a marketing-owned reimplementation of the
 * app's thread visual language (DESIGN.md G5) with zero app runtime.
 *
 * The app's real MessageBubble / SystemLine / StatusPill depend on TanStack
 * Query, member hooks, and signed-URL fetches; they cannot render on a static
 * marketing route. These primitives reproduce the thread grammar in the v3
 * "Quiet daylight" palette so they read as one surface with the restyled kit
 * (night/kit.tsx): inbound #F0F4F2 bubble with --day-ink text, outbound petrol
 * bubble with white text, a white dashed internal note in --ink-55 with a lock,
 * centered --ink-55 system lines, and delivery states with Check / CheckCheck,
 * while staying self-contained enough to hydrate as a sub-15KB island. Light
 * only (DESIGN-DIRECTION): no dark variants, the marketing surface never flips.
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
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[color:var(--petrol-12)] text-[9px] font-medium text-[color:var(--petrol)]",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Status pill, the v3 quiet tints matched to night/kit.tsx: New/Open live in
 *  the petrol family, Waiting/Closed in the neutral family. No loud fills. */
const PILL_STYLES = {
  new: "bg-[color:var(--petrol-12)] text-[color:var(--petrol)]",
  open: "bg-[color:var(--petrol-12)] text-[color:var(--petrol)]",
  waiting: "bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-55)]",
  closed: "bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-55)]",
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
        "border-[color:var(--hairline)] bg-[#F0F4F2] text-[color:var(--ink-55)]",
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
    <span className="text-[12px] text-[color:var(--ink-55)]">
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

/** Inbound customer bubble: #F0F4F2 fill, --day-ink text, left (v3 §5). */
export function InboundBubble({ beat }: { beat: InboundBeat }) {
  return (
    <div className="flex w-full flex-col items-start gap-1">
      {beat.photo && <PhotoThumb label={beat.photo.label} />}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] bg-[#F0F4F2] px-3 py-2 text-[15px] leading-normal text-[color:var(--day-ink)] md:max-w-[80%]">
        {beat.body}
      </div>
      <span className="text-[12px] text-[color:var(--ink-55)]">{beat.time}</span>
    </div>
  );
}

/** Outbound business bubble: petrol fill, white text, right, with a delivery
 *  state (v3 §5). */
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
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] bg-[color:var(--petrol)] px-3 py-2 text-[15px] leading-normal text-white md:max-w-[80%]">
        {beat.body}
      </div>
      <DeliveryLine time={beat.time} state={state} />
    </div>
  );
}

/** Internal note: white dashed card, lock + "Internal note", --ink-55 — the
 *  customer-invisible register, matched to kit's NoteRow (G5). */
export function NoteBubble({ beat }: { beat: NoteBeat }) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] border border-dashed border-[color:var(--hairline)] bg-white px-3 py-2 text-[15px] leading-normal text-[color:var(--day-ink)] md:max-w-[80%]">
        <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[color:var(--ink-55)]">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
          Internal note · {beat.by}
        </span>
        {beat.body}
      </div>
      <span className="text-[12px] text-[color:var(--ink-55)]">{beat.time}</span>
    </div>
  );
}

/** Centered system/event line (G5): "Priya assigned this to Dale". */
export function EventLine({ beat }: { beat: EventBeat }) {
  // --ink-55 (#587068, 4.9:1 on the white/paper card), the sanctioned v3 meta
  // voice; never diluted with opacity (that dropped the old value below AA).
  return (
    <p className="py-1 text-center text-xs text-[color:var(--ink-55)]">{beat.text}</p>
  );
}
