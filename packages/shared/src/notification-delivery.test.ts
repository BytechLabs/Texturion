import { describe, expect, it } from "vitest";

import {
  DEFAULT_DELIVERY,
  DELIVERY_MODES,
  NOTIFICATION_CATEGORIES,
  decideDelivery,
  digestLine,
} from "./notification-delivery";

describe("decideDelivery", () => {
  it("ND-1: an urgent event sends, whatever the member chose", () => {
    // THE RULE THIS MODULE EXISTS FOR. "Batching must never become a way to
    // miss the call that mattered." Every mode, including the quietest.
    for (const mode of DELIVERY_MODES) {
      expect(decideDelivery({ mode, urgent: true }), mode).toBe("send");
    }
  });

  it("ND-2: urgency is checked BEFORE the mode, not alongside it", () => {
    // A future mode this build has never heard of must not be able to swallow
    // an emergency while somebody works out what it means.
    expect(decideDelivery({ mode: "some_future_mode", urgent: true })).toBe(
      "send",
    );
  });

  it("ND-3: an ordinary event follows the member's setting", () => {
    expect(decideDelivery({ mode: "immediate", urgent: false })).toBe("send");
    expect(decideDelivery({ mode: "batched", urgent: false })).toBe("queue");
    expect(decideDelivery({ mode: "summary", urgent: false })).toBe("hold");
  });

  it("ND-4: an unknown or missing setting SENDS rather than swallowing", () => {
    // Settings are data and data outlives the code that wrote it. The safe
    // direction when we cannot read a preference is to be noisy: a member
    // notices an unwanted buzz and can fix it, and never notices the missed
    // call they were not told about.
    expect(decideDelivery({ mode: null, urgent: false })).toBe("send");
    expect(decideDelivery({ mode: undefined, urgent: false })).toBe("send");
    expect(decideDelivery({ mode: "gibberish", urgent: false })).toBe("send");
  });

  it("ND-5: nothing is ever dropped", () => {
    // `hold` means the daily summary, not the bin. A member who chose a
    // quieter setting did not choose to lose things, and a decision function
    // that CAN discard is one bug away from doing it.
    const decisions = new Set(
      DELIVERY_MODES.flatMap((mode) => [
        decideDelivery({ mode, urgent: false }),
        decideDelivery({ mode, urgent: true }),
      ]),
    );
    expect([...decisions].sort()).toEqual(["hold", "queue", "send"]);
  });
});

describe("the defaults", () => {
  it("ND-6: every category has one, so a new category cannot arrive silent", () => {
    // A category added to the union without a default would fall through to
    // `undefined` — which sends, so it fails safe, but the member would have
    // no control over it and nobody would notice for months.
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_DELIVERY[category], category).toBeDefined();
    }
  });

  it("ND-7: existing members keep receiving exactly what they receive today", () => {
    // The one thing a notification change must not do is quieten somebody who
    // did not ask to be quietened. Batching is OFFERED, not applied.
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_DELIVERY[category], category).toBe("immediate");
    }
  });
});

describe("digestLine", () => {
  it("ND-8: says both numbers, because they answer different questions", () => {
    // Four messages from one customer is a conversation. Four across four is a
    // morning. A digest that reported only the total would flatten them.
    expect(digestLine(4, 3)).toBe("4 new messages across 3 conversations");
  });

  it("ND-9: drops the second clause when it would say nothing", () => {
    expect(digestLine(4, 1)).toBe("4 new messages");
    expect(digestLine(1, 1)).toBe("1 new message");
  });
});
