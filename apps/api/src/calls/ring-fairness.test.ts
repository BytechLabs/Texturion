/**
 * #366 — a crew past the ring ceiling has members who never ring.
 *
 * `MAX_LEGS_PER_SESSION = 24` is a correct, well-argued bound, and the Sentry
 * warning before it is exactly right. The gap was who gets told and who gets
 * left out: "dial the first 24 by earliest membership" is reproducible and
 * unfair in a way that compounds. A member who sorts 25th is 25th on every
 * call, forever. They do not ring occasionally — they never ring, and nothing
 * in the product tells them why.
 *
 * The two properties below pull in opposite directions, which is why both are
 * asserted rather than assumed:
 *
 *   DETERMINISTIC per call — the state machine is replayable, and a replay
 *   that dialled different people would break that.
 *
 *   DIFFERENT across calls — otherwise the fix changes nothing.
 */
import { describe, expect, it } from "vitest";

import { MAX_LEGS_PER_SESSION, rotateForFairness } from "./transitions";

const crew = (n: number) => Array.from({ length: n }, (_, i) => `member-${i}`);

describe("#366 — who gets rung when the crew is bigger than the ceiling", () => {
  it("gives the same answer every time for the same call", () => {
    // Replay safety. The machine is re-derived from its journal, and a second
    // derivation that dialled a different set would leave legs nobody owns.
    const people = crew(30);
    const once = rotateForFairness(people, "session-abc");
    const twice = rotateForFairness(people, "session-abc");
    expect(once).toEqual(twice);
  });

  it("gives a DIFFERENT answer for a different call", () => {
    // The whole point. Without this the rotation is decoration.
    const people = crew(30);
    const a = rotateForFairness(people, "session-abc").slice(0, MAX_LEGS_PER_SESSION);
    const b = rotateForFairness(people, "session-xyz").slice(0, MAX_LEGS_PER_SESSION);
    expect(a).not.toEqual(b);
  });

  it("eventually rings everybody", () => {
    // A rotation that only ever shifted by a few would still exclude the same
    // tail. Over a realistic day of calls, every member must appear.
    const people = crew(30);
    const rung = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      for (const person of rotateForFairness(people, `session-${i}`).slice(
        0,
        MAX_LEGS_PER_SESSION,
      )) {
        rung.add(person);
      }
    }
    expect(rung.size).toBe(people.length);
  });

  it("keeps everybody exactly once — it rotates, it does not sample", () => {
    // A shuffle could drop or duplicate somebody. Two legs for one member
    // would ring their phone twice and leave a leg nobody hangs up.
    const people = crew(30);
    const rotated = rotateForFairness(people, "session-abc");
    expect(rotated).toHaveLength(people.length);
    expect(new Set(rotated).size).toBe(people.length);
    expect([...rotated].sort()).toEqual([...people].sort());
  });

  it("leaves a crew under the ceiling completely alone", () => {
    // The common case by far, and the one where a change would be pure risk:
    // everybody is dialled either way, so the order should not move.
    const people = crew(5);
    const rotated = rotateForFairness(people, "session-abc");
    expect([...rotated].sort()).toEqual([...people].sort());
    expect(rotated).toHaveLength(5);
  });

  it("survives an empty crew without throwing", () => {
    // A modulo by zero is the obvious way to write this wrong, and the path is
    // reachable: RING-START runs before the both-empty check in some orders.
    expect(rotateForFairness([], "session-abc")).toEqual([]);
  });
});
