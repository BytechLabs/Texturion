/**
 * At most one event per key in a window, per isolate. For signals a public
 * route or a busy path can repeat without limit, where PostHog needs only to
 * hear that it is happening: the free plan stops ingesting when the month's
 * quota runs out, errors and heartbeats with it (D146).
 *
 * Per isolate rather than global, so a burst spread over many isolates sends
 * a few events per window instead of one. The map holds one entry per key,
 * and callers pass a fixed set of keys.
 */
export interface RateGate {
  /** True, and starts a window, when `key` has not been let through lately. */
  allow(key: string): boolean;
  /** Forget every window. For tests. */
  reset(): void;
}

export function rateGate(windowMs: number): RateGate {
  const last = new Map<string, number>();
  return {
    allow(key) {
      const now = Date.now();
      const before = last.get(key);
      if (before !== undefined && now - before < windowMs) return false;
      last.set(key, now);
      return true;
    },
    reset() {
      last.clear();
    },
  };
}
