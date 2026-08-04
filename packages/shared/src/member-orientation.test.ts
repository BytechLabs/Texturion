import { describe, expect, it } from "vitest";

import { MEMBER_ROLES, type MemberRole } from "./capabilities";
import {
  ORIENTATION_STEPS,
  orientationProgress,
  shouldShowOrientation,
} from "./member-orientation";

/**
 * #286 — "An invited member sees a short, skippable, member-specific
 * orientation on first sign-in."
 *
 * The decision is small and it is on three clients. A phone that disagrees
 * with the web about whether somebody is new shows them the flow twice, or
 * never — so the vectors here are shared with the Kotlin and Swift ports.
 */
describe("who sees the joining orientation", () => {
  it("shows it to the person it was written for", () => {
    expect(shouldShowOrientation("member", false)).toBe(true);
  });

  it("never shows it to somebody who has already been through it", () => {
    // The server's answer for THIS membership, so a skip on a phone is a skip
    // on the laptop too. That is the whole reason it is not a device flag.
    for (const role of MEMBER_ROLES) {
      expect(shouldShowOrientation(role, true), role).toBe(false);
    }
  });

  it("shows nothing while the answer is still in flight", () => {
    // `undefined` is "we have not asked yet". Flashing four screens at
    // somebody who has been here for months, then taking them away, is worse
    // than the wait.
    for (const role of MEMBER_ROLES) {
      expect(shouldShowOrientation(role, undefined), role).toBe(false);
    }
  });

  it("does not orient the person who built the workspace", () => {
    // They walked a five-step wizard and chose this product. #405 already
    // drew this line for the first-run checklist and it is the same line: not
    // a filtered version of the owner's flow, a different one.
    expect(shouldShowOrientation("owner", false)).toBe(false);
    expect(shouldShowOrientation("admin", false)).toBe(false);
  });

  it("does not orient a role that does not answer customers", () => {
    // #315: a read-only observer and a bookkeeper are not lesser members —
    // they are different sets. Every screen of this flow is about answering
    // customers, and four screens explaining a job that is not yours is worse
    // than no screens.
    expect(shouldShowOrientation("read_only", false)).toBe(false);
    expect(shouldShowOrientation("bookkeeper", false)).toBe(false);
  });

  it("shows nothing to a role this build has never heard of", () => {
    // What a client one release behind the server sees. Least privilege here
    // means least interruption.
    expect(shouldShowOrientation("superuser" as MemberRole, false)).toBe(false);
    expect(shouldShowOrientation(null, false)).toBe(false);
    expect(shouldShowOrientation(undefined, false)).toBe(false);
  });
});

describe("the progress bar", () => {
  it("never starts at zero", () => {
    // Somebody on screen one accepted an invite, signed in and opened the app.
    // A bar that starts empty says otherwise and makes four screens feel like
    // a form. *Applying: Goal Gradient Effect.*
    expect(orientationProgress(0)).toBeGreaterThan(0);
    expect(orientationProgress(0)).toBeCloseTo(0.25);
  });

  it("fills as they go, and is full on the last screen", () => {
    const values = ORIENTATION_STEPS.map((_, index) =>
      orientationProgress(index),
    );
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(1);
  });

  it("holds inside the bar for an index outside the flow", () => {
    // A client that adds a screen without adding a step, or reads a stale
    // index while unmounting, gets a bar rather than a NaN or a bar past its
    // own end.
    expect(orientationProgress(-3)).toBeCloseTo(0.25);
    expect(orientationProgress(99)).toBe(1);
  });
});

describe("the flow itself", () => {
  it("is short, and in the order the clients render", () => {
    // "Short" is the Acceptance word. Four screens is the number the issue
    // scoped; a flow that grows past that is a tutorial, which is the thing
    // being replaced.
    expect(ORIENTATION_STEPS).toEqual([
      "inbox",
      "number",
      "notes",
      "notifications",
    ]);
  });

  it("ends on the notification choice", () => {
    // "Notification permission is requested with context, not cold" is its own
    // Acceptance line, and joining is the moment that context exists. It is
    // last because a permission dialog is the one screen that interrupts the
    // OS, and everything explaining WHY has to come first.
    expect(ORIENTATION_STEPS.at(-1)).toBe("notifications");
  });
});
