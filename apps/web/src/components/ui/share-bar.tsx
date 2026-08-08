/**
 * #540 — a whole, split into its parts.
 *
 * The companion to `ProportionRing`, and the distinction between them is not
 * decorative. A ring says "how much of one thing is done" — one part against one
 * whole. This says "what the whole is MADE of", which is a different question and
 * the one the quotes panel actually asks: of everything quoted, how much came
 * back yes, how much is still sitting with the customer, and how much went quiet.
 *
 * Drawing that as a ring would force the three answers into one arc and lose the
 * middle one, which is the only one somebody can still act on.
 *
 * ## Deliberately not a chart library
 *
 * Three divs in a flex row. A stacked bar is a stacked bar; a charting package
 * for it would be kilobytes on the landing screen to compute three percentages.
 *
 * ## Accessibility, which a bar gets wrong the same way a ring does
 *
 * A bar with no words is a picture of nothing to a screen reader and nothing to
 * anybody who cannot separate the tones. So the caller passes a sentence, the
 * segments are announced through it, and the figures stay on the card as real
 * text — this never carries a number that is not also written somewhere.
 *
 * Each segment's tone comes from the CALLER as a class, not from a palette
 * chosen here: a colour is a fill or a label, never both (D100), and only the
 * card knows which of its own tones mean what.
 */

export interface ShareSegment {
  /** Used to key the segment and to build the spoken sentence. */
  label: string;
  value: number;
  /** The fill, from the caller's own tokens. */
  className: string;
}

export function ShareBar({
  segments,
  total,
  label,
  className,
}: {
  segments: readonly ShareSegment[];
  /**
   * The whole. Segments summing to LESS than this leave the remainder as track,
   * which is the honest picture — the gap is the part nobody has accounted for.
   */
  total: number;
  /** What a screen reader says. A sentence, not a list of percentages. */
  label: string;
  className?: string;
}) {
  const safeTotal = Math.max(0, total);
  // Nothing to divide. Rendering an empty track would read as a panel that
  // failed to load rather than as a month with no quotes in it.
  if (safeTotal === 0) return null;

  // Clamped cumulatively, so a caller whose parts add to more than the whole
  // gets a full bar rather than segments running off the end. That can happen
  // for real: the parts and the total are separate figures from the server, and
  // a lagging window can disagree with itself by one.
  let used = 0;
  const drawn = segments.map((segment) => {
    const value = Math.min(Math.max(0, segment.value), safeTotal - used);
    used += value;
    return { ...segment, percent: (value / safeTotal) * 100 };
  });

  return (
    <div
      role="img"
      aria-label={label}
      className={
        "flex h-1.5 w-full overflow-hidden rounded-full bg-app-inset " +
        (className ?? "")
      }
    >
      {drawn.map((segment) =>
        segment.percent > 0 ? (
          <span
            key={segment.label}
            aria-hidden
            className={"h-full " + segment.className}
            style={{ width: `${segment.percent}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
