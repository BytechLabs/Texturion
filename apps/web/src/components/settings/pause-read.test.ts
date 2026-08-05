import { describe, expect, it } from "vitest";

import type { PauseOffer } from "@/lib/api/billing";

import {
  type PauseRead,
  pauseReadOf,
  planBadge,
  planStateUnknownNote,
  readAllowsPlanChange,
  readSaysPaused,
  readSaysRunning,
} from "./pause-read";

/**
 * #277 — the rule that a screen may not state a fact it has not read.
 *
 * These are pure because the rule is pure, and because a rule that can only be
 * checked by rendering a page is a rule nobody can break on purpose. Every one
 * of them fails if the four states are collapsed back into a boolean, which is
 * the defect they exist for: `data?.paused_at != null` answers "not paused" for
 * a read that never happened, one that has not landed, and one that failed, and
 * all three then rendered a green Active badge, the allowance lines of a plan
 * that is not running, and a plan switch the API answers 409 to.
 */
const ANSWER: PauseOffer = {
  eligible: false,
  reason: "already_paused",
  paused_at: null,
  monthly_cents: 1275,
  resume_plan: "pro",
};

/** The route's answer for a workspace that IS paused, right now. */
const PAUSED: PauseRead = {
  state: "answered",
  answer: { ...ANSWER, paused_at: "2026-07-02T00:00:00.000Z" },
};

/** The route's answer for a workspace whose plan is running. */
const RUNNING: PauseRead = { state: "answered", answer: { ...ANSWER } };

/** Every state in which nothing has been read. The three that used to lie. */
const UNANSWERED: PauseRead[] = [
  { state: "unasked" },
  { state: "loading" },
  { state: "failed" },
];

describe("#277 what the billing screen has actually read about the pause", () => {
  it("READ-1: an unanswered read is not paused AND not running", () => {
    // THE DEFECT, IN ONE ASSERTION. `isRunning` is not `!isPaused`, and this is
    // where that stops being a style preference: both accessors have to be
    // FALSE for a read that never happened, has not landed, or failed. Define
    // `readSaysRunning` as the negation of `readSaysPaused` and the second
    // expectation below fails three times over — which is exactly the shape
    // that put a green Active badge on a paused workspace.
    for (const read of UNANSWERED) {
      expect(readSaysPaused(read), read.state).toBe(false);
      expect(readSaysRunning(read), read.state).toBe(false);
    }

    // And an answer says so, in both directions, so silence cannot pass.
    expect(readSaysPaused(PAUSED)).toBe(true);
    expect(readSaysRunning(PAUSED)).toBe(false);
    expect(readSaysRunning(RUNNING)).toBe(true);
    expect(readSaysPaused(RUNNING)).toBe(false);
  });

  it("READ-2: 'nobody asked' and 'no answer yet' are told apart by the gate", () => {
    // A DISABLED react-query IS INDISTINGUISHABLE FROM A COLD START on the way
    // in: both report pending, no data, no error. They are not the same fact —
    // a closed gate means this workspace cannot be paused at all (no plan, or
    // no live subscription, and a pause is a price swap that leaves both
    // intact), while a cold start means we simply have not heard back. So the
    // gate is passed in, and dropping it collapses two states into one.
    const pending = { data: undefined, isError: false };
    expect(pauseReadOf(false, pending).state).toBe("unasked");
    expect(pauseReadOf(true, pending).state).toBe("loading");

    expect(pauseReadOf(true, { data: undefined, isError: true }).state).toBe(
      "failed",
    );
    const answered = pauseReadOf(true, { data: ANSWER, isError: false });
    expect(answered.state).toBe("answered");
    expect(answered).toEqual({ state: "answered", answer: ANSWER });
  });

  it("READ-3: an answer already in hand survives a refetch that failed", () => {
    // react-query keeps the last successful data through a failed background
    // refetch, and that answer came from this same route with nothing newer
    // contradicting it. Ordering the failure check first would flip a paused
    // card to neutral — and its plan switch back on — every time a revalidation
    // could not reach Stripe.
    const read = pauseReadOf(true, {
      data: PAUSED.state === "answered" ? PAUSED.answer : ANSWER,
      isError: true,
    });
    expect(read.state).toBe("answered");
    expect(readSaysPaused(read)).toBe(true);
  });

  it("READ-4: the badge never says Active over a state nobody read", () => {
    // The badge is the half of this screen a reader acts on, and "Active" beside
    // the full plan price is the sentence that contradicts the paused card above
    // it. It may only be green on an answer that said the plan is running.
    const live = { subscriptionActive: true, cancelAtPeriodEnd: false };
    for (const read of UNANSWERED) {
      expect(planBadge(read, live), read.state).not.toBe("active");
    }
    expect(planBadge({ state: "loading" }, live)).toBe("checking");
    // Nothing is claimed where nothing was read — and "Checking…" is not shown
    // to somebody who never asked, because there is no request to narrate.
    expect(planBadge({ state: "unasked" }, live)).toBeNull();
    expect(planBadge({ state: "failed" }, live)).toBeNull();

    // The positive cases, so silence cannot satisfy this test.
    expect(planBadge(RUNNING, live)).toBe("active");
    expect(planBadge(PAUSED, live)).toBe("paused");
    // A pause is a price swap, so `paused_at` outranks the two subscription
    // flags: the badge says Paused even on a workspace already on its way out.
    expect(
      planBadge(PAUSED, { subscriptionActive: true, cancelAtPeriodEnd: true }),
    ).toBe("paused");

    // Answered, running, and there is something else to say: the notice at the
    // top of the screen owns "cancelling" and "payment failed", and a second
    // badge repeating it beside the plan name is noise.
    expect(
      planBadge(RUNNING, { subscriptionActive: true, cancelAtPeriodEnd: true }),
    ).toBeNull();
    expect(
      planBadge(RUNNING, { subscriptionActive: false, cancelAtPeriodEnd: false }),
    ).toBeNull();
  });

  it("READ-5: only a failed read says anything, and it says nothing changed", () => {
    // A sentence under "Checking…" would be narrating a network request at
    // somebody who came to look at their plan, and there is nothing to report to
    // a reader who never asked. The failure is the one state where silence would
    // leave a card that has quietly dropped half its content with no reason.
    const note = planStateUnknownNote({ state: "failed" });
    expect(note).toBeTruthy();
    // The reader's next thought after "couldn't check" is "did something happen
    // to my plan", so the sentence answers it rather than apologising.
    expect(note).toContain("untouched");
    expect(note?.toLowerCase()).not.toContain("sorry");

    for (const read of [
      { state: "unasked" } as const,
      { state: "loading" } as const,
      RUNNING,
      PAUSED,
    ]) {
      expect(planStateUnknownNote(read), read.state).toBeNull();
    }
  });

  it("READ-6: a plan switch is drawn only where the API would take it", () => {
    // `POST /v1/billing/change-plan` answers 409 while `companies.paused_at` is
    // set and asks for the two steps in order. A control whose only outcome is a
    // refusal should not have been drawn — and that is equally true in the
    // window before the read lands, which is the window this whole file is
    // about.
    expect(readAllowsPlanChange(PAUSED)).toBe(false);
    expect(readAllowsPlanChange({ state: "loading" })).toBe(false);
    expect(readAllowsPlanChange({ state: "failed" })).toBe(false);

    // Running: the switch is the point of the screen.
    expect(readAllowsPlanChange(RUNNING)).toBe(true);
    // Unasked is the one carve-out, and it is knowledge rather than ignorance:
    // the gate is only closed for a workspace with no plan or no live
    // subscription, which is precisely the shape a paused workspace cannot have.
    expect(readAllowsPlanChange({ state: "unasked" })).toBe(true);
  });
});
