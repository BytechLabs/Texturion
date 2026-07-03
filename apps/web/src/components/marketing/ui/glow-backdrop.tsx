import { cn } from "@/lib/utils";

/**
 * The ONE petrol radial glow per page (BLUEPRINT §1.2), as a decorative,
 * aria-hidden layer painted BEHIND content, never over LCP text, never
 * animated, exactly one per page. Pure CSS gradient (marketing-glow utility in
 * globals.css): a petrol core low-left + a warm amber lift upper-right over the
 * stone-50 base, so the hero sits in warm morning light. No image, no blur()
 * filter on the LCP region.
 *
 * Absolutely positioned; the parent must be `relative`. Server component.
 */
export function GlowBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 marketing-glow",
        className,
      )}
    />
  );
}
