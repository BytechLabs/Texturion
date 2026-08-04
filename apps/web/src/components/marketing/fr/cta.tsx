import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * FR CTA BUTTON (DESIGN-DIRECTION v4 §4 Buttons).
 *
 * Variants:
 *   "primary"    Cobalt pill, white Hanken 600 text, padding
 *                0.875rem 1.75rem, hover deepens to #1F33B8, focus ring
 *                2px cobalt at 2px offset.
 *   "secondary"  Ink ghost: 1.5px Dispatch Ink border on transparent, same
 *                geometry.
 *   "on-cobalt"  The inversion for the one cobalt band: white pill, ink
 *                text, white focus ring.
 *
 * Copy deck: the primary label is `Get your number`, the secondary is
 * `See pricing`; buttons are verbs.
 *
 * Usage:
 *   <CtaButton href="/signup">Get your number</CtaButton>
 *   <CtaButton href="/pricing" variant="secondary">See pricing</CtaButton>
 */
export function CtaButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ariaLabel,
}: {
  href: string;
  variant?: "primary" | "secondary" | "on-cobalt";
  /** "lg" bumps tap height for pinned mobile CTAs (48px+). */
  size?: "md" | "lg";
  className?: string;
  children: React.ReactNode;
  /** Accessible name when the visible verb needs page context. */
  ariaLabel?: string;
}) {
  const base = cn(
    "font-body-mkt inline-flex items-center justify-center rounded-full text-center font-semibold whitespace-nowrap",
    "transition-colors duration-200 ease-out",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    size === "lg" ? "px-8 py-4 text-base" : "px-7 py-3.5 text-[0.9375rem]",
  );
  const variants = {
    // #494: the ONE lime moment on a marketing page. Everything around it is
    // neutral, which is what lets a single fill carry the brand — an accent
    // used on every surface stops being an accent and becomes a cast, which is
    // what the olive palette had become.
    primary: cn(
      "bg-[color:var(--fr-brand)] text-[color:var(--fr-on-brand)]",
      "hover:bg-[color:var(--fr-brand-hover)]",
      // #238 — the ring is INK, not the button's own lime.
      //
      // Ringing the button in its own fill read as tidy and measured 1.78:1 on
      // the ground and 1.94:1 on a card: lime is the one colour on the page
      // chosen to be loud against ink, which is exactly what makes it quiet
      // against paper. The ring is drawn at 2px OFFSET, so it never touches the
      // lime — it sits on the page, and the page is what it has to be seen
      // against (1.4.11 Non-text Contrast, AA).
      //
      // D100 is the rule that already covers this: a colour is a fill or a
      // label, never both. A fill asked to do a stroke's job is the same
      // mistake in a third role. Ink is also what the other forty-five focus
      // sites on this site already use, so this converges on the system instead
      // of adding a case to it — and it inverts to paper in dark mode for free,
      // because --fr-olive is ink on light and near-paper on dark.
      "focus-visible:outline-[color:var(--fr-olive)]",
    ),
    secondary: cn(
      "border-[1.5px] border-[color:var(--fr-ink)] bg-transparent text-[color:var(--fr-ink)]",
      "hover:bg-[color:var(--fr-frost)]",
      "focus-visible:outline-[color:var(--fr-olive)]",
    ),
    // On the accent band the button INVERTS: its fill is the band's label
    // colour and its label is the band. That swap is automatic in both modes —
    // paper pill / olive text on light, ink pill / lime text on dark — where a
    // literal `bg-white` would have stayed white on a lime band.
    "on-cobalt": cn(
      "bg-[color:var(--fr-on-olive)] text-[color:var(--fr-olive)]",
      "hover:bg-[color:var(--fr-frost)]",
      "focus-visible:outline-[color:var(--fr-on-olive)]",
    ),
  } as const;

  const cls = cn(base, variants[variant], className);

  return href.startsWith("/") ? (
    <Link href={href} className={cls} aria-label={ariaLabel}>
      {children}
    </Link>
  ) : (
    <a href={href} className={cls} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
