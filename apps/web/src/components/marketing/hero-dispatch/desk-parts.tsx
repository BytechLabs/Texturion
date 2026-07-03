/**
 * Dispatch-desk presentational parts (iteration 5, HERO-CONCEPT §1).
 *
 * Server-safe (no hooks) building blocks shared by BOTH the static State-B
 * fallback (SSR / no-JS / reduced-motion) and the interactive island, so the
 * two render paths are provably identical DOM. Built from the app's real thread
 * vocabulary (the marketing thread-primitives, DESIGN.md G5) — the ledger row,
 * the amber internal note, the teal reply with a Delivered check — so the desk
 * IS the product, not a mockup (§6 honesty).
 */

import { ImageIcon, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { SignalCheck } from "@/components/marketing/ledger/signal-check";

import {
  ASSIGNEES,
  DEFAULT_ASSIGNEE,
  DISPATCH,
  type Assignee,
} from "./dispatch-data";

/** Petrol-tinted avatar with initials — the app's G4 member-avatar. */
export function DeskAvatar({
  a,
  className,
}: {
  a: Assignee;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary",
        className,
      )}
    >
      {a.initials}
    </span>
  );
}

/** A neutral MMS photo chip — drawn in DOM, no raster (§1.3). */
export function PhotoChip({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={`Photo: ${label}`}
      className="flex w-fit items-center gap-1.5 rounded-lg border border-border bg-gradient-to-br from-stone-100 to-stone-200 px-2 py-1.5 text-[11px] text-stone-500 dark:from-stone-800 dark:to-stone-900 dark:text-stone-400"
    >
      <ImageIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
      {label}
    </div>
  );
}

/**
 * The RAW customer bubble — the "mess" (§5.2 raw speed). A plain gray
 * Messages-style bubble, slightly restless, holding the panicked text + a photo
 * chip. State A only.
 */
export function RawBubble() {
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[92%] rounded-[16px] rounded-bl-[5px] bg-stone-200 px-3.5 py-2 text-[14px] leading-snug text-stone-800 dark:bg-stone-800 dark:text-stone-100">
        {DISPATCH.rawBubble}
      </div>
      <PhotoChip label={DISPATCH.photoLabel} />
    </div>
  );
}

/**
 * The ASSIGN control — three avatar chips the visitor taps to file (§1 State A).
 * `interactive` renders real buttons (island); otherwise inert spans (SSR shows
 * the finished state, so no controls). `onPick` files on tap/Enter/Space.
 */
export function AssignChips({
  onPick,
  pulseFirst,
}: {
  onPick?: (a: Assignee) => void;
  /** Pulse-ring the primary chip once on hydration (discoverability, §4). */
  pulseFirst?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="jt-meta text-muted-foreground">Assign</span>
      {ASSIGNEES.map((a) => (
        <button
          key={a.name}
          type="button"
          data-assignee={a.name}
          onClick={() => onPick?.(a)}
          className={cn(
            "tap-target relative inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-[13px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1",
            pulseFirst && a.name === DEFAULT_ASSIGNEE.name && "jt-pulse",
          )}
        >
          <DeskAvatar a={a} className="size-5 text-[9px]" />
          {a.name}
        </button>
      ))}
    </div>
  );
}

/** STATUS pills (New → Open → Waiting → Done), defaulting to New (§1 State A). */
export function StatusPills({ active = "New" }: { active?: string }) {
  const pills = ["New", "Open", "Waiting", "Done"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="jt-meta text-muted-foreground">Status</span>
      {pills.map((p) => (
        <span
          key={p}
          className={cn(
            "rounded-full px-2 py-0.5 text-[12px] font-medium",
            p === active
              ? "bg-primary/10 text-teal-800 dark:text-primary"
              : "bg-secondary text-stone-500 dark:text-muted-foreground",
          )}
        >
          {p}
        </span>
      ))}
    </div>
  );
}

/**
 * The RESOLVED conversation — State B (§1, §5.2 filed speed). The raw bubble is
 * re-rendered as a clean inbound white card, an amber internal note, and Dale's
 * teal reply with a Delivered ✓ (the self-drawing SignalCheck). `drawn` gates
 * the check-draw animation to the moment of filing.
 */
export function ResolvedConversation({
  assignee,
  drawn = false,
}: {
  assignee: Assignee;
  /** Play the Delivered check-draw (island, on file); false = static drawn. */
  drawn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Inbound white card — the customer's text, now filed. */}
      <div className="flex flex-col items-start gap-1">
        <div className="max-w-[88%] rounded-[10px] border border-border bg-card px-3 py-2 text-[14px] leading-normal text-card-foreground">
          {DISPATCH.rawBubble}
        </div>
        <PhotoChip label={DISPATCH.photoLabel} />
      </div>

      {/* Amber internal note (the honesty color, §3.1). */}
      <div className="max-w-[88%] self-end rounded-[10px] border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-normal text-stone-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
        <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-warning">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
          Internal note · Priya
        </span>
        {DISPATCH.seededNote}
      </div>

      {/* Dale's teal reply with Delivered ✓. */}
      <div className="flex max-w-[88%] flex-col items-end gap-1 self-end">
        <div className="rounded-[10px] bg-teal-50 px-3 py-2 text-[14px] leading-normal text-teal-900 dark:bg-teal-950 dark:text-teal-100">
          {DISPATCH.reply}
        </div>
        <span className="jt-meta flex items-center gap-1 text-muted-foreground">
          {DISPATCH.replyTime}
          <span aria-hidden>·</span>
          Delivered
          <SignalCheck className="size-3.5" drawn={drawn} />
        </span>
      </div>

      <p className="jt-meta pt-1 text-muted-foreground">
        Assigned to {assignee.name}
      </p>
    </div>
  );
}
