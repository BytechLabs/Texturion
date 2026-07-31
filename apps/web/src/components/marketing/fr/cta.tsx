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
    primary: cn(
      "bg-[color:var(--fr-olive)] text-[color:var(--fr-on-olive)]",
      "hover:bg-[color:var(--fr-olive-deep)]",
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
