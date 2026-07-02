/**
 * <GradientMesh> — a subtle petrol→transparent gradient mesh (VISUALS §1D, §4.1).
 *
 * The soft light field that sits behind a key section so it isn't a flat gray
 * box. CSS gradients ONLY — no image, no blur() filter (a large blur is a paint
 * cost; soft-stop gradients instead, per VISUALS §5 / BLUEPRINT §1.2). aria-hidden
 * decorative layer, never over LCP text, never animated.
 *
 * This is the reusable, placeable sibling of the home page's single
 * <GlowBackdrop> (the ONE per-page hero glow). Use GradientMesh for supporting
 * section washes; keep the hard "one glow per page" budget on GlowBackdrop.
 *
 * Themeable: light mode paints warm petrol + amber lifts over stone; dark mode
 * (`variant="dark"` or auto via the `.dark` class) paints teal-500 lifts over ink
 * — the app's real dark tokens, so a dark band reads as the product at night.
 * Server component.
 */

import { cn } from "@/lib/utils";

type MeshTone = "petrol" | "warm" | "dual";
type MeshPlacement =
  | "hero"
  | "center"
  | "top"
  | "bottom-left"
  | "bottom-right";

/**
 * Gradient recipes keyed by placement. Each is a stack of soft-stop radials; the
 * dark-mode override lifts a single teal core (the §1.2 dark exception — the
 * phone's screen light). Alphas stay in the VISUALS §1.2 budget (≈0.10–0.14
 * petrol core; ≈0.06 amber lift) so nothing shouts.
 */
const LIGHT: Record<MeshPlacement, string> = {
  hero:
    "radial-gradient(58% 52% at 16% 84%, rgba(15,118,110,0.13) 0%, rgba(15,118,110,0) 70%)," +
    "radial-gradient(48% 48% at 86% 12%, rgba(251,191,36,0.06) 0%, rgba(251,191,36,0) 72%)",
  center:
    "radial-gradient(55% 60% at 50% 40%, rgba(15,118,110,0.10) 0%, rgba(15,118,110,0) 72%)",
  top: "radial-gradient(70% 60% at 50% 0%, rgba(15,118,110,0.09) 0%, rgba(15,118,110,0) 70%)",
  "bottom-left":
    "radial-gradient(55% 55% at 12% 92%, rgba(15,118,110,0.12) 0%, rgba(15,118,110,0) 70%)",
  "bottom-right":
    "radial-gradient(55% 55% at 88% 92%, rgba(15,118,110,0.12) 0%, rgba(15,118,110,0) 70%)",
};

const WARM: Record<MeshPlacement, string> = {
  hero: "radial-gradient(60% 55% at 82% 18%, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0) 72%)",
  center:
    "radial-gradient(55% 60% at 50% 45%, rgba(251,191,36,0.06) 0%, rgba(251,191,36,0) 72%)",
  top: "radial-gradient(70% 60% at 50% 0%, rgba(251,191,36,0.06) 0%, rgba(251,191,36,0) 70%)",
  "bottom-left":
    "radial-gradient(55% 55% at 12% 92%, rgba(251,191,36,0.07) 0%, rgba(251,191,36,0) 70%)",
  "bottom-right":
    "radial-gradient(55% 55% at 88% 92%, rgba(251,191,36,0.07) 0%, rgba(251,191,36,0) 70%)",
};

/** Dark override — a single teal-500 core (the §1.2 dark exception). */
const DARK: Record<MeshPlacement, string> = {
  hero: "radial-gradient(55% 55% at 20% 80%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 70%)",
  center:
    "radial-gradient(55% 60% at 50% 42%, rgba(45,212,191,0.12) 0%, rgba(45,212,191,0) 72%)",
  top: "radial-gradient(70% 60% at 50% 0%, rgba(45,212,191,0.12) 0%, rgba(45,212,191,0) 70%)",
  "bottom-left":
    "radial-gradient(55% 55% at 14% 90%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 70%)",
  "bottom-right":
    "radial-gradient(55% 55% at 86% 90%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 70%)",
};

function compose(tone: MeshTone, placement: MeshPlacement): string {
  const petrol = LIGHT[placement];
  const warm = WARM[placement];
  if (tone === "petrol") return petrol;
  if (tone === "warm") return warm;
  return `${petrol},${warm}`;
}

export interface GradientMeshProps {
  tone?: MeshTone;
  placement?: MeshPlacement;
  /**
   * `"auto"` (default) follows the `.dark` class; `"dark"` forces the ink
   * treatment (for a section that is always dark, e.g. the truck band).
   */
  variant?: "auto" | "dark";
  className?: string;
}

export function GradientMesh({
  tone = "dual",
  placement = "center",
  variant = "auto",
  className,
}: GradientMeshProps) {
  const light = compose(tone, placement);
  const dark = DARK[placement];

  if (variant === "dark") {
    return (
      <div
        aria-hidden="true"
        data-mesh={placement}
        className={cn("pointer-events-none absolute inset-0 -z-10", className)}
        style={{ backgroundImage: dark }}
      />
    );
  }

  // Auto: paint light stack, swap to the teal core under `.dark` via a sibling
  // that only shows in dark mode (keeps both in one CSS layer, no JS).
  return (
    <>
      <div
        aria-hidden="true"
        data-mesh={placement}
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 dark:hidden",
          className,
        )}
        style={{ backgroundImage: light }}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 hidden dark:block",
          className,
        )}
        style={{ backgroundImage: dark }}
      />
    </>
  );
}
