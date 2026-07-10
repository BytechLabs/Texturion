import { cn } from "@/lib/utils";

/**
 * FR MONO FIGURE (DESIGN-DIRECTION v4 §3, the mono law): every countable
 * truth wears Spline Sans Mono with tabular figures. If a number could
 * appear on an invoice, it is mono. This is the pulled-out figure treatment
 * (prices as art, calculator output, stat chips); numbers inside FAQ prose
 * stay in the body face (the prose exception).
 *
 * Sizes:
 *   "data"    0.875rem chip/table figure.
 *   "stat"    1.5rem stat-chip figure.
 *   "display" the §3 display numeral (3rem to 6rem clamp) for prices as art
 *             and the calculator output.
 *
 * `tone="flare"` exists ONLY for whitelist item §3.4.3 (the missed-text
 * calculator output figure, 48px+ bold): it forces display scale and 700
 * weight so Flare never appears under 24px bold.
 *
 * Usage:
 *   <MonoFigure value="$29" suffix="/mo · the whole crew" size="display" />
 *   <MonoFigure value="$79" size="stat" />
 */
export function MonoFigure({
  value,
  suffix,
  size = "stat",
  tone = "ink",
  className,
}: {
  /** The figure itself (mono): "$29", "$79", "(416) 555-0182". */
  value: string;
  /** Optional quiet unit/label after the figure, body face, ink-55. */
  suffix?: string;
  size?: "data" | "stat" | "display";
  /** "flare" is §3.4.3 (calculator output) ONLY; it forces display+bold. */
  tone?: "ink" | "cobalt" | "green" | "flare";
  className?: string;
}) {
  const isFlare = tone === "flare";
  const tones = {
    ink: "text-[color:var(--fr-ink)]",
    cobalt: "text-[color:var(--fr-cobalt)]",
    green: "text-[color:var(--fr-green)]",
    flare: "text-[color:var(--fr-flare)]",
  } as const;
  const sizes = {
    data: "fr-mono-data",
    stat: "fr-mono-data text-2xl",
    display: "fr-figure",
  } as const;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span
        className={cn(
          sizes[isFlare ? "display" : size],
          tones[tone],
          isFlare && "font-bold",
        )}
      >
        {value}
      </span>
      {suffix ? (
        <span className="font-body-mkt text-base text-[color:var(--fr-ink-55)]">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
