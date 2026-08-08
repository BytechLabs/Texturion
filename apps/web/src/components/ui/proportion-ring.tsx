/**
 * #540 — a proportion, drawn.
 *
 * The dashboard's measures were numbers in boxes. "34 of 41 answered" is a fact a
 * reader has to do arithmetic on before it means anything; the same fact as a ring
 * is read at a glance and remembered as a shape. That is the whole reason this
 * exists, and it is the "closing ring" idiom on purpose — a shape somebody wants
 * to complete is a better daily habit than a percentage they have to interpret.
 *
 * ## Deliberately not a chart library
 *
 * Two arcs of SVG and no dependency. A charting package for one ring would be
 * kilobytes on the landing screen for a shape that is four lines of geometry, and
 * this has to render inside a card that is 200px wide on a phone.
 *
 * ## Accessibility is the part a ring usually gets wrong
 *
 * A ring on its own is a picture with no text, which is nothing at all to a screen
 * reader and nothing to somebody who cannot tell the two colours apart. So:
 *
 *   - the value is announced as a `img` role with a label a person would say out
 *     loud ("34 of 41 answered"), not as "62 percent";
 *   - the number sits INSIDE the ring as real text, so the meaning survives with
 *     the colours turned off, in high contrast, and in a screenshot;
 *   - `currentColor` for the arc, so it inherits whatever the caller decided the
 *     tone should be rather than hard-coding a palette entry here — a colour is a
 *     fill or a label, never both (D100).
 */

export function ProportionRing({
  value,
  total,
  label,
  centre,
  className,
  size = 44,
}: {
  /** How much of `total` is done. Clamped into range — a caller reporting 12 of 10 gets a full ring, not a second lap. */
  value: number;
  total: number;
  /** What a screen reader says. A sentence, not a percentage. */
  label: string;
  /** Short text inside the ring — usually the count, never more than three or four characters. */
  centre?: string;
  className?: string;
  size?: number;
}) {
  const safeTotal = Math.max(0, total);
  const safeValue = Math.min(Math.max(0, value), safeTotal);
  const fraction = safeTotal === 0 ? 0 : safeValue / safeTotal;

  // Geometry: a circle stroked from the top, clockwise. `strokeDasharray` set to
  // the circumference lets `strokeDashoffset` express the fraction directly.
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={className}
      role="img"
      aria-label={label}
      style={{ width: size, height: size, position: "relative" }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* The track. Deliberately faint: it is the amount still to do, and a
            strong ring for the part NOT done reads as a warning about work that
            may be perfectly fine. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={stroke}
        />
        {fraction > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            // From the top rather than from three o'clock, which is where every
            // reader expects a progress ring to start.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {centre !== undefined && (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums"
        >
          {centre}
        </span>
      )}
    </div>
  );
}
