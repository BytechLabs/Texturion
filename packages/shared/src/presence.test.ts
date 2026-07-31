import { describe, expect, it } from "vitest";

import {
  PRESENCE_TTL_MS,
  TYPING_TTL_MS,
  presenceFor,
  presenceLabel,
  type PresenceEntry,
} from "./presence";

/**
 * #302 — the rule three clients implement, pinned once.
 *
 * What is asserted here is mostly about NOT lying. Stale presence is worse than
 * no presence: it tells somebody a colleague has this thread when they closed
 * the laptop ten minutes ago, which produces the nobody-replies failure the
 * feature exists to fix.
 */

const NOW = 1_760_000_000_000;
const CONV = "conv-1";
const ME = "me";

function entry(over: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    user_id: "sam",
    display_name: "Sam",
    conversation_id: CONV,
    at: NOW,
    ...over,
  };
}

const opts = (over: Partial<Parameters<typeof presenceFor>[1]> = {}) => ({
  conversationId: CONV,
  selfUserId: ME,
  now: NOW,
  healthy: true,
  ...over,
});

describe("#302 presenceFor — who is really here", () => {
  it("reports a teammate on this conversation", () => {
    expect(presenceFor([entry()], opts())).toEqual([
      { user_id: "sam", display_name: "Sam", typing: false },
    ]);
  });

  it("never reports you to yourself", () => {
    // Your own presence is not a collision, and seeing your own name on the
    // thread you are reading would read as a bug.
    expect(presenceFor([entry({ user_id: ME })], opts())).toEqual([]);
  });

  it("ignores teammates on a different conversation", () => {
    expect(presenceFor([entry({ conversation_id: "other" })], opts())).toEqual([]);
  });

  it("drops presence older than the TTL", () => {
    // The connection that goes quietly dead while still looking open has bitten
    // twice (#215). The TTL is the backstop for exactly that.
    const stale = entry({ at: NOW - PRESENCE_TTL_MS - 1 });
    expect(presenceFor([stale], opts())).toEqual([]);
    const fresh = entry({ at: NOW - PRESENCE_TTL_MS + 1_000 });
    expect(presenceFor([fresh], opts())).toHaveLength(1);
  });

  it("refuses a timestamp from far in the future rather than trusting it forever", () => {
    // A phone with a wrong clock would otherwise pin a ghost to the thread
    // until somebody reloaded.
    const skewed = entry({ at: NOW + PRESENCE_TTL_MS * 4 });
    expect(presenceFor([skewed], opts())).toEqual([]);
    // Small skew is normal and tolerated.
    expect(presenceFor([entry({ at: NOW + 2_000 })], opts())).toHaveLength(1);
  });

  it("reports NOTHING when the connection is unhealthy", () => {
    // The honest answer is "we do not know", and the honest render of that is
    // nothing — not the last thing we heard.
    expect(presenceFor([entry()], opts({ healthy: false }))).toEqual([]);
  });

  it("collapses one person on two devices, and believes typing on either", () => {
    const laptop = entry({ at: NOW - 1_000, typing: false });
    const phone = entry({ at: NOW - 3_000, typing: true });
    const viewers = presenceFor([laptop, phone], opts());
    expect(viewers).toHaveLength(1);
    // They ARE replying, on the phone, whether or not the laptop knows.
    expect(viewers[0].typing).toBe(true);
  });

  it("lets typing expire without dropping the person", () => {
    // The cost of expiring early is that the label falls back to "also here",
    // which is still true. The cost of it lingering is a lie.
    const old = entry({ at: NOW - TYPING_TTL_MS - 1_000, typing: true });
    const viewers = presenceFor([old], opts());
    expect(viewers).toHaveLength(1);
    expect(viewers[0].typing).toBe(false);
  });

  it("orders freshest first", () => {
    const viewers = presenceFor(
      [
        entry({ user_id: "a", display_name: "Ann", at: NOW - 9_000 }),
        entry({ user_id: "b", display_name: "Bo", at: NOW - 1_000 }),
      ],
      opts(),
    );
    expect(viewers.map((v) => v.user_id)).toEqual(["b", "a"]);
  });

  it("falls back to a name rather than rendering an empty one", () => {
    const viewers = presenceFor([entry({ display_name: "   " })], opts());
    expect(viewers[0].display_name).toBe("A teammate");
  });
});

describe("#302 presenceLabel — the one line the crew reads", () => {
  const viewer = (name: string, typing = false) => ({
    user_id: name.toLowerCase(),
    display_name: name,
    typing,
  });

  it("says nothing when there is nothing to say", () => {
    // Null, not "", so a caller renders nothing rather than an empty strip that
    // reserves space for an absence.
    expect(presenceLabel([])).toBeNull();
  });

  it("puts typing above viewing, because that is the line that stops somebody", () => {
    expect(presenceLabel([viewer("Sam", true), viewer("Dale")])).toBe(
      "Sam is replying…",
    );
  });

  it("names one and two, then counts", () => {
    expect(presenceLabel([viewer("Sam")])).toBe("Sam is also here");
    expect(presenceLabel([viewer("Sam"), viewer("Dale")])).toBe(
      "Sam and Dale are also here",
    );
    // A row of names is a wall; the actionable fact is only that somebody else
    // is here.
    expect(presenceLabel([viewer("Sam"), viewer("Dale"), viewer("Ann")])).toBe(
      "3 teammates are also here",
    );
  });

  it("counts multiple people replying too", () => {
    expect(presenceLabel([viewer("Sam", true), viewer("Dale", true)])).toBe(
      "Sam and Dale are replying…",
    );
    expect(
      presenceLabel([viewer("Sam", true), viewer("Dale", true), viewer("Ann", true)]),
    ).toBe("3 people are replying…");
  });
});
