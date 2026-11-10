import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSequenceTracker, REORDER_WINDOW_MS } from "./sequence";

const TOPIC = "company:c1:number:n1";

describe("createSequenceTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const onGap = vi.fn();
    return { onGap, tracker: createSequenceTracker(onGap) };
  };

  it("stays quiet for events in order", () => {
    const { onGap, tracker } = setup();
    for (const seq of [1, 2, 3, 4]) tracker.observe(TOPIC, seq);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("ignores a duplicate and an older sequence", () => {
    const { onGap, tracker } = setup();
    for (const seq of [5, 6, 6, 5, 7]) tracker.observe(TOPIC, seq);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("does not resync when a late event fills the hole inside the window", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, 1);
    tracker.observe(TOPIC, 3);
    vi.advanceTimersByTime(REORDER_WINDOW_MS - 1);
    tracker.observe(TOPIC, 2);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("resyncs once when the hole is still open after the window", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, 1);
    tracker.observe(TOPIC, 3);
    tracker.observe(TOPIC, 4);
    vi.advanceTimersByTime(REORDER_WINDOW_MS - 1);
    expect(onGap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onGap).toHaveBeenCalledTimes(1);
    expect(onGap).toHaveBeenCalledWith(TOPIC);

    // The resync covers what was skipped, so the next event continues from 4.
    tracker.observe(TOPIC, 5);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).toHaveBeenCalledTimes(1);
  });

  it("ignores the event that arrives after its hole was resynced", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, 1);
    tracker.observe(TOPIC, 3);
    vi.advanceTimersByTime(REORDER_WINDOW_MS);
    tracker.observe(TOPIC, 2);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).toHaveBeenCalledTimes(1);
  });

  it("takes the first event after a join as the baseline only", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, 900);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();

    tracker.reset(TOPIC);
    tracker.observe(TOPIC, 4000);
    tracker.observe(TOPIC, 4001);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("cancels a pending window when the topic is reset", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, 1);
    tracker.observe(TOPIC, 3);
    tracker.reset(TOPIC);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("counts topics independently", () => {
    const { onGap, tracker } = setup();
    tracker.observe("a", 1);
    tracker.observe("b", 10);
    tracker.observe("a", 2);
    tracker.observe("b", 11);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("ignores a payload that carries no sequence", () => {
    const { onGap, tracker } = setup();
    tracker.observe(TOPIC, undefined);
    tracker.observe(TOPIC, "7");
    tracker.observe(TOPIC, 1);
    tracker.observe(TOPIC, 2);
    vi.advanceTimersByTime(REORDER_WINDOW_MS * 2);
    expect(onGap).not.toHaveBeenCalled();
  });
});
