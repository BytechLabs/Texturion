import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * #540 — the shell the four dashboard measures share: one header, one frame.
 *
 * ## Why this exists
 *
 * The four measures sit in one row. Before this they were four hand-copied
 * copies of the same twelve-class `<h2>` and the same bordered `<div>`, which is
 * how the row drifted apart twice already: two cards once carried their title
 * INSIDE the frame while two carried it above, leaving their card tops thirty
 * pixels apart in a single row. The phones fixed exactly this with a shared
 * `MeasureHeader`; web never got the equivalent, so the same drift stayed
 * possible here.
 *
 * ## The alignment this fixes
 *
 * `<section>` is the grid item, so it is stretched to the tallest card in the
 * row — but the bordered `<div>` inside it was height-auto, so the FRAMES ended
 * wherever their content happened to end. Response time carries two more rows
 * than Satisfaction beside it, so the two cards' bottoms sat visibly apart. The
 * body is `flex-1` here, which is what makes the frames end level.
 *
 * The slack that stretching creates is absorbed in the MIDDLE rather than at
 * the bottom: a card's trailing summary or disclosure row takes `mt-auto`, so
 * those rows line up across the row too. A divider with empty space under it
 * reads as a panel that failed to finish loading; the same space above it reads
 * as breathing room.
 *
 * *Applying: Relationship Strength — one group of four, presented as one.*
 *
 * ## Register
 *
 * `action` is the trailing slot in the header — a window switcher on the two
 * cards that take one, a static "last 30 days" on the one that does not. It
 * sits in the header rather than in the frame because it names what the card
 * IS, and a control that changes the question belongs beside the question.
 */
export function MeasureCard({
  title,
  action,
  padded = false,
  children,
}: {
  title: ReactNode;
  /** Trailing header slot — a window control, a window label, or nothing. */
  action?: ReactNode;
  /**
   * Whether the frame pads its own content. The two cards built from
   * full-bleed rows pad each row instead, so a divider reaches both edges.
   */
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col">
      <h2 className="flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        <span className="flex items-baseline gap-2">{title}</span>
        {action}
      </h2>
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden rounded-app-card border border-app-line bg-app-paper",
          padded && "p-4",
        )}
      >
        {children}
      </div>
    </section>
  );
}
