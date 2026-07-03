/**
 * <Display>, the expressive marketing headline system (DESIGN-DIRECTION §3).
 *
 * Headlines are COMPOSED, not typed. A plain `<h1 className="display-hero">Every
 * text caught</h1>` is a bare font swap; a real "Caught" headline layers the
 * marketing devices: a lighter emphasis cut, a marker-yellow highlight swipe on
 * the promise word, a hand-marker underline or circle, one petrol accent word,
 * and scale/weight contrast. This component gives those devices a small, reusable
 * grammar so every headline on the site is authored the same way.
 *
 * Server component (pure DOM/CSS; the marker draw is CSS-only, reduced-motion
 * safe). Set on the (marketing) subtree only, it reads --font-display etc.
 *
 * Usage:
 *   <Display as="h1" size="hero">
 *     Every text{" "}
 *     <Display.Emph italic>caught</Display.Emph>, not{" "}
 *     <Display.Mark>missed</Display.Mark>.
 *   </Display>
 *
 *   <Display as="h2" size="h2">
 *     Your texts run on <Display.Accent>one phone</Display.Accent>.
 *   </Display>
 */

import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type DisplaySize = "hero" | "h2" | "numeral";

const SIZE_CLASS: Record<DisplaySize, string> = {
  // The hero reserves its Basteleur multi-line height at the call site
  // (CaughtHero: min-h-[4.1em] sm:min-h-[2.1em]) to keep the font-swap CLS ~0;
  // no shared reserve utility (the height is copy/breakpoint-specific).
  hero: "display-hero",
  h2: "display-h2",
  numeral: "display-numeral",
};

interface DisplayProps {
  /** The heading element (h1/h2/h3) or a plain span. Defaults to h2. */
  as?: ElementType;
  /** The type scale + role. Defaults to "h2". */
  size?: DisplaySize;
  className?: string;
  children: ReactNode;
}

/**
 * The composable emphasis word, the lighter Basteleur MOONLIGHT cut, an optical
 * weight-contrast against the Bold headline (Basteleur has no true italic, so
 * weight contrast is the distinctive emphasis; `italic` adds a restrained
 * synthetic slant only where the composition wants it).
 */
function Emph({
  children,
  italic = false,
  className,
}: {
  children: ReactNode;
  italic?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(italic ? "dsp-emph-italic" : "dsp-emph", className)}>
      {children}
    </span>
  );
}

/** The one petrol accent word in a headline (§3 "one petrol accent"). */
function Accent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("dsp-accent", className)}>{children}</span>;
}

/**
 * The marker-yellow HIGHLIGHT SWIPE behind the promise word (§3 RATIONED marker,
 * used once per headline). A wobbly hand-laid band sits behind the glyphs; on
 * reveal it paints on once (reduced-motion shows it fully painted). Set
 * `draw={false}` for headlines that should never animate (e.g. the LCP hero if
 * you want zero motion there); default paints on reveal via [data-draw].
 */
function Mark({
  children,
  draw = true,
  className,
}: {
  children: ReactNode;
  /** Paint-on animation on reveal (reduced-motion always shows painted). */
  draw?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("dsp-marker", className)}>
      <span aria-hidden className="dsp-marker-swipe" data-draw={draw ? "true" : undefined} />
      <span className="relative">{children}</span>
    </span>
  );
}

export function Display({
  as: Tag = "h2",
  size = "h2",
  className,
  children,
}: DisplayProps) {
  return (
    <Tag className={cn("font-display", SIZE_CLASS[size], className)}>
      {children}
    </Tag>
  );
}

Display.Emph = Emph;
Display.Accent = Accent;
Display.Mark = Mark;
