import { cn } from "@/lib/utils";

import { Container } from "./container";

/**
 * Vertical rhythm for a marketing band (BLUEPRINT §1.4): 96px top/bottom
 * desktop, 64px mobile. Server component.
 *
 * - `bleed` drops the built-in Container so a section can paint a full-width
 *   background (washes, the dark band) and manage its own inner Container.
 * - `id` lets nav/footer anchor links land here (site.ts HOME_ANCHORS).
 */
export function Section({
  children,
  className,
  containerClassName,
  id,
  bleed = false,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
  bleed?: boolean;
  as?: React.ElementType;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        "py-16 sm:py-24",
        // Anchor targets clear the sticky nav when jumped to.
        id && "scroll-mt-20",
        className,
      )}
    >
      {bleed ? children : <Container className={containerClassName}>{children}</Container>}
    </Tag>
  );
}
