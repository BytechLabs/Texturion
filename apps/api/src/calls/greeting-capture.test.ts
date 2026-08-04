/**
 * #309 — the greeting-capture tag.
 *
 * GC-4 is the one that decides whether this tag is safe to route on. A tag
 * that parses when it should not would hand an ordinary call leg to the
 * greeting writer; a tag that fails to parse when it should would send a
 * capture leg into the session machine, which has no state for it. Both are
 * silent, and both are decided here rather than at the call site.
 */
import { describe, expect, it } from "vitest";

import {
  buildGreetingCaptureState,
  parseGreetingCaptureState,
} from "./greeting-capture";

const COMPANY = "cccccccc-0000-4000-8000-00000000000c";

describe("#309 greeting-capture tag", () => {
  it("GC-1: round-trips a company and a name", () => {
    const tag = buildGreetingCaptureState(COMPANY, "After hours");
    expect(parseGreetingCaptureState(tag)).toEqual({
      companyId: COMPANY,
      name: "After hours",
    });
  });

  it("GC-2: a name containing a pipe survives, because names are owner-written", () => {
    // The name takes the REMAINDER for this reason. "After hours | holidays"
    // is a name somebody will type, and a parse that split on it would write a
    // greeting called "After hours" and lose the rest — or reject the call.
    const tag = buildGreetingCaptureState(COMPANY, "After hours | holidays");
    expect(parseGreetingCaptureState(tag)?.name).toBe("After hours | holidays");
  });

  it("GC-3: another feature's tag is not a capture tag", () => {
    // Every inbound-ring tag is base64 of `prefix|…`, so a decoder that only
    // checked "does this base64-decode" would claim all of them.
    expect(parseGreetingCaptureState(btoa("vmi|+16135551000"))).toBeNull();
    expect(parseGreetingCaptureState(btoa(`brm|${COMPANY}|u1||cc1`))).toBeNull();
  });

  it("GC-4: anything malformed is null, never a partial parse", () => {
    // THE ONE THAT MATTERS. Null falls through to the ordinary routing rules;
    // a partial parse would hand a leg to the greeting writer on the strength
    // of a prefix somebody could type.
    expect(parseGreetingCaptureState(null)).toBeNull();
    expect(parseGreetingCaptureState("")).toBeNull();
    expect(parseGreetingCaptureState("not base64 at all!!")).toBeNull();
    // The right prefix, no company.
    expect(parseGreetingCaptureState(btoa("vgc||After hours"))).toBeNull();
    // The right prefix, a company that is not a uuid.
    expect(parseGreetingCaptureState(btoa("vgc|acme|After hours"))).toBeNull();
    // The right prefix and company, no name.
    expect(parseGreetingCaptureState(btoa(`vgc|${COMPANY}|`))).toBeNull();
    expect(parseGreetingCaptureState(btoa(`vgc|${COMPANY}|   `))).toBeNull();
    // A name past the column's ceiling: refused here rather than at the insert,
    // where the call has already happened and the owner has already spoken.
    expect(
      parseGreetingCaptureState(btoa(`vgc|${COMPANY}|${"x".repeat(61)}`)),
    ).toBeNull();
  });
});
