import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one mega-menu / mobile-sheet icon chip (v4 amendment 15: "Nav gets
 * tasteful icons/visuals"). Every menu item carries a single lucide line
 * glyph in a small Frost chip, cobalt at one weight and one size across the
 * whole nav, no illustration clutter and no color noise. This is the single
 * source of truth for that chip so Product, Who it's for, Compare, and the
 * mobile sheet all read as one set.
 *
 * Restraint contract: Frost ground, Signal Cobalt glyph, strokeWidth 1.75,
 * 18px glyph in a 36px chip. Purely decorative, so it is aria-hidden; the
 * row label is the accessible name.
 */
export function MenuIconChip({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--fr-frost)] text-[color:var(--fr-cobalt)]",
        className,
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
    </span>
  );
}
