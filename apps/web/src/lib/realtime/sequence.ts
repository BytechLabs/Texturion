/**
 * Every broadcast carries `seq`, a gapless per-topic counter (D151). A hole in
 * it means a delivery was lost on a healthy socket, and the client answers with
 * the resync it already runs after a connection gap.
 *
 * Two seconds of patience, because Realtime can reorder frames: at the hosted
 * ceiling's edge the slowest emit-to-socket time was 1.4 s (CAPACITY.md 2e),
 * so a frame that is only late still lands inside the window and costs nothing.
 */
export const REORDER_WINDOW_MS = 2_000;

type TopicState = {
  /** Highest sequence applied in order, or null before the first event. */
  last: number | null;
  /** Sequences seen beyond a hole, waiting for the hole to fill. */
  ahead: Set<number>;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type SequenceTracker = {
  /** Feed the `seq` of one received broadcast. Payloads without one are ignored. */
  observe(topic: string, seq: unknown): void;
  /** Forget a topic's baseline; the next event only sets it. */
  reset(topic: string): void;
  /** Cancel every pending window. */
  dispose(): void;
};

export function createSequenceTracker(
  onGap: (topic: string) => void,
  windowMs: number = REORDER_WINDOW_MS,
): SequenceTracker {
  const topics = new Map<string, TopicState>();

  const stateFor = (topic: string): TopicState => {
    let state = topics.get(topic);
    if (!state) {
      state = { last: null, ahead: new Set(), timer: undefined };
      topics.set(topic, state);
    }
    return state;
  };

  const clearTimer = (state: TopicState) => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };

  return {
    observe(topic, seq) {
      if (typeof seq !== "number" || !Number.isSafeInteger(seq)) return;
      const state = stateFor(topic);

      if (state.last === null) {
        state.last = seq;
        return;
      }
      if (seq <= state.last || state.ahead.has(seq)) return;

      state.ahead.add(seq);
      while (state.ahead.has(state.last + 1)) {
        state.last += 1;
        state.ahead.delete(state.last);
      }

      if (state.ahead.size === 0) {
        clearTimer(state);
        return;
      }
      if (state.timer !== undefined) return;
      state.timer = setTimeout(() => {
        state.timer = undefined;
        if (state.ahead.size === 0) return;
        // The resync reads everything, so what was skipped no longer matters.
        state.last = Math.max(...state.ahead);
        state.ahead.clear();
        onGap(topic);
      }, windowMs);
    },

    reset(topic) {
      const state = topics.get(topic);
      if (state) clearTimer(state);
      topics.delete(topic);
    },

    dispose() {
      for (const state of topics.values()) clearTimer(state);
      topics.clear();
    },
  };
}
