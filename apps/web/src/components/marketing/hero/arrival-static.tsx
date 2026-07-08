import { ConvergedField } from "@/components/marketing/fr";
import { cn } from "@/lib/utils";

/**
 * The static converged Arrival Field (P5-SPEC §"Static fallback SVG"): a
 * composed still, not an absence. This is what SSR ships, what no-JS keeps,
 * what reduced-motion / save-data / low-memory visitors keep, and what the
 * final CTA band and subpage marks reuse (via <ConvergedField> directly).
 *
 * The composition itself lives in the foundation kit (fr/converged-field.tsx,
 * variant "full": three cobalt streamlines, four green docked bubbles with
 * mono timestamps, ONE Flare bubble still waiting at 60% along the middle
 * path). This wrapper only sizes it to the hero's canvas box.
 */
export function ArrivalStatic({ className }: { className?: string }) {
  return (
    <ConvergedField
      variant="full"
      className={cn("h-full w-full", className)}
    />
  );
}
