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
  defer = false,
  intrinsic,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
  bleed?: boolean;
  /**
   * Skip this section's layout/paint work while it is off-screen
   * (`content-visibility: auto`, iteration-4 mobile-perf fix). Turn on for
   * every below-the-fold section, NOT the hero or the first below-hero
   * section, which are in/near the initial viewport. Removes no nodes/visuals;
   * the section is still fully server-rendered (LCP/SEO/no-JS safe), the browser
   * just defers the work until it nears the viewport.
   */
  defer?: boolean;
  /**
   * Reserved height estimate for a deferred section (`contain-intrinsic-size`),
   * so the scrollbar and anchor offsets are right before it renders. A rough
   * per-section value is enough, the browser remembers the real size after the
   * section is first seen (`auto` keyword). Defaults to a generous 720px.
   */
  intrinsic?: number;
  as?: React.ElementType;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        "py-16 sm:py-24",
        // Anchor targets clear the sticky nav when jumped to.
        id && "scroll-mt-20",
        defer && "cv-defer",
        className,
      )}
      style={
        defer && intrinsic
          ? ({ "--cv-intrinsic": `${intrinsic}px` } as React.CSSProperties)
          : undefined
      }
    >
      {bleed ? children : <Container className={containerClassName}>{children}</Container>}
    </Tag>
  );
}
