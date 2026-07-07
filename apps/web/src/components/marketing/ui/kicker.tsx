/**
 * <Kicker>, the one v3 "Quiet daylight" section kicker (DESIGN-DIRECTION §3).
 *
 * The single sanctioned eyebrow: Public Sans 600, 0.8125rem, --ink-55, sentence
 * case, no letterspacing tricks. It replaces the pre-v3 "mono meta label with a
 * short petrol rule" eyebrow that §3 explicitly forbids ("Not mono, not a
 * clock" — Martian Mono is figures only). Used sparingly, only where a section
 * truly needs a label above its display heading.
 *
 * Server component (pure DOM/CSS).
 */

import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Kicker({
  as: Tag = "p",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "font-body-mkt text-[0.8125rem] font-semibold text-[color:var(--ink-55)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
