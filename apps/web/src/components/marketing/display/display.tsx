/**
 * <Display>, the expressive marketing headline system (DESIGN-DIRECTION §3,
 * v3 "Quiet daylight").
 *
 * Headlines are COMPOSED, not typed. A plain `<h1 className="display-hero">Every
 * text caught</h1>` is a bare font swap; a composed headline layers the calm v3
 * devices: a quieter emphasis tone, a clean petrol underline on the promise
 * word, and one petrol accent word. This component gives those devices a small,
 * reusable grammar so every headline on the site is authored the same way. (v3
 * retired the amber highlighter swipe and the hand-marker draw: §2 rations
 * porch-amber to the unread dot, and the identity is minimal, not hand-drawn.)
 *
 * Server component (pure DOM/CSS; the underline draw is CSS-only, reduced-motion
 * safe). Set on the (marketing) subtree only, it reads --font-display etc.
 *
 * Usage:
 *   <Display as="h1" size="hero">
 *     Every text{" "}
 *     <Display.Mark>caught</Display.Mark>, not{" "}
 *     <Display.Emph>missed</Display.Emph>.
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
 * The composable emphasis word (v3). Every display utility renders Besley 700
 * now, so weight contrast is dead; the v3 emphasis is a genuine tonal step (the
 * word recedes to the quieter ink, see .dsp-emph). `italic` swaps that tone for
 * a restrained synthetic slant where the composition wants it instead.
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
 * The clean petrol UNDERLINE under the promise word (v3 §2: petrol is the one
 * accent; the retired amber swipe is gone). On reveal the rule draws on once
 * (reduced-motion shows it fully drawn). Set `draw={false}` for headlines that
 * should never animate (e.g. the LCP hero if you want zero motion there);
 * default draws on reveal via [data-draw].
 */
function Mark({
  children,
  draw = true,
  className,
}: {
  children: ReactNode;
  /** Draw-on animation on reveal (reduced-motion always shows drawn). */
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
