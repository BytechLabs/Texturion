/** The global rule uses 0.01ms so animation-end dependent code can settle. */
export const MAX_REDUCED_TRANSITION_MS = 0.1;

/** Convert a computed CSS transition-duration list to its longest duration. */
export function maxTransitionDurationMs(raw) {
  const durations = raw.split(",").map((part) => {
    const token = part.trim();
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    return token.endsWith("ms") ? value : value * 1_000;
  });
  return Math.max(...durations);
}

/** Return the rendered-audit finding, or null when motion was actually reduced. */
export function reducedMotionTransitionProblem(where, raw) {
  if (maxTransitionDurationMs(raw) <= MAX_REDUCED_TRANSITION_MS) return null;
  return (
    `${where}: prefers-reduced-motion left a scripted 1s transition at ${raw}. ` +
    `The rendered media-query check must reduce it to at most ` +
    `${MAX_REDUCED_TRANSITION_MS}ms.`
  );
}
