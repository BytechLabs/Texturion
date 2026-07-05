import { describe, expect, it } from "vitest";

import {
  doneBadgeLabel,
  doneEventExcerpt,
  doneEventSentence,
  doneToggleLabel,
  isDone,
  isUnsentOutbound,
  shouldPopDone,
} from "./done";

describe("isDone", () => {
  it("is true exactly when done_at is set", () => {
    expect(isDone({ done_at: null })).toBe(false);
    expect(isDone({ done_at: "2026-07-02T14:14:00Z" })).toBe(true);
  });
});

describe("isUnsentOutbound", () => {
  it("is false for a received inbound message (real customer text)", () => {
    expect(
      isUnsentOutbound({ direction: "inbound", status: "received" }),
    ).toBe(false);
  });

  it("is false for a sent/delivered outbound message (it left)", () => {
    expect(isUnsentOutbound({ direction: "outbound", status: "sent" })).toBe(
      false,
    );
    expect(
      isUnsentOutbound({ direction: "outbound", status: "delivered" }),
    ).toBe(false);
  });

  it("is false for a note (an internal note is not an unsent send)", () => {
    expect(isUnsentOutbound({ direction: "note", status: null })).toBe(false);
  });

  it("is true for a queued or failed outbound (never actually sent)", () => {
    expect(isUnsentOutbound({ direction: "outbound", status: "queued" })).toBe(
      true,
    );
    expect(isUnsentOutbound({ direction: "outbound", status: "failed" })).toBe(
      true,
    );
  });
});

describe("doneToggleLabel", () => {
  it("flips between mark done / not done", () => {
    expect(doneToggleLabel(false)).toBe("Mark done");
    expect(doneToggleLabel(true)).toBe("Mark not done");
  });
});

describe("shouldPopDone (#4 check pop)", () => {
  it("pops only on the not-done → done transition", () => {
    expect(shouldPopDone(false, true)).toBe(true);
  });

  it("never pops on mount (prev seeded to current) or a no-op re-render", () => {
    // Seed = current state on first render: done stays done, open stays open.
    expect(shouldPopDone(true, true)).toBe(false);
    expect(shouldPopDone(false, false)).toBe(false);
  });

  it("never pops on undone (done → not-done)", () => {
    expect(shouldPopDone(true, false)).toBe(false);
  });
});

describe("doneBadgeLabel", () => {
  it("resolves the actor name, or degrades to time only", () => {
    const message = {
      done_at: "2026-07-02T14:14:00Z",
      done_by_user_id: "u1",
    };
    expect(doneBadgeLabel(message, () => "Sam")).toMatch(/^Done · Sam · /);
    expect(doneBadgeLabel(message, () => undefined)).toMatch(/^Done · /);
    expect(doneBadgeLabel(message, () => undefined)).not.toContain("Sam");
  });

  it("is empty for a not-done message", () => {
    expect(doneBadgeLabel({ done_at: null, done_by_user_id: null }, () => "Sam")).toBe(
      "",
    );
  });
});

describe("doneEventExcerpt (§4.3)", () => {
  it("quotes a short body verbatim", () => {
    expect(doneEventExcerpt("Can you come Thursday?")).toBe(
      '"Can you come Thursday?"',
    );
  });

  it("truncates a long body with an ellipsis inside the quotes", () => {
    const long = "a".repeat(80);
    const out = doneEventExcerpt(long);
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('…"')).toBe(true);
    // The excerpt keeps at most the cap (48) chars before the ellipsis.
    expect(out.length).toBeLessThan(long.length);
  });

  it("collapses whitespace and reads an empty body as a photo", () => {
    expect(doneEventExcerpt("  hi   there ")).toBe('"hi there"');
    expect(doneEventExcerpt("   ")).toBe("a photo");
  });
});

describe("doneEventSentence (§4.2/§4.3)", () => {
  const doneEvent = {
    type: "message_done" as const,
    payload: { message_id: "m1" },
  };
  const undoneEvent = {
    type: "message_undone" as const,
    payload: { message_id: "m1" },
  };

  it("renders 'X marked \"…\" done' from the live body", () => {
    expect(
      doneEventSentence(doneEvent, "Sam", "Can you come Thursday?"),
    ).toBe('Sam marked "Can you come Thursday?" done');
  });

  it("renders 'not done' for an undone event", () => {
    expect(
      doneEventSentence(undoneEvent, "Sam", "Can you come Thursday?"),
    ).toBe('Sam marked "Can you come Thursday?" not done');
  });

  it("degrades to 'a message' on a body cache-miss (never invents text)", () => {
    expect(doneEventSentence(doneEvent, "Sam", undefined)).toBe(
      "Sam marked a message done",
    );
  });
});
