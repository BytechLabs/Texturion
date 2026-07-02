import type { ConversationStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Status pills (G4): 11px, sentence case, tinted bg + text. New = petrol
 * tint, Open = sky, Waiting = amber, Closed = plain stone-100.
 *
 * Light-mode text uses deeper shades of each tint hue than the semantic
 * tokens (teal-800, sky-700, amber-800, stone-600): G11 requires 4.5:1 on
 * the tinted backgrounds and the token shades (teal-700 4.50 over stone-50,
 * sky-600 3.5, amber-600 2.9, stone-500 4.4) sit at or below the line at
 * 11px. Dark mode keeps the tokens — the 500-shades on dark tints measure
 * 5.2–7.4:1.
 */
const PILL_STYLES: Record<ConversationStatus, string> = {
  new: "bg-primary/10 text-teal-800 dark:bg-primary/15 dark:text-primary",
  open: "bg-info/10 text-sky-700 dark:bg-info/15 dark:text-info",
  waiting: "bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning",
  closed: "bg-secondary text-stone-600 dark:text-muted-foreground",
};

const PILL_LABELS: Record<ConversationStatus, string> = {
  new: "New",
  open: "Open",
  waiting: "Waiting",
  closed: "Closed",
};

export function statusLabel(status: ConversationStatus): string {
  return PILL_LABELS[status];
}

export function StatusPill({
  status,
  className,
}: {
  status: ConversationStatus;
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

/** Spam chip shown on rows inside the spam view (red-700: 4.5:1+ per G11). */
export function SpamPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-red-700 dark:text-destructive",
        className,
      )}
    >
      Spam
    </span>
  );
}
