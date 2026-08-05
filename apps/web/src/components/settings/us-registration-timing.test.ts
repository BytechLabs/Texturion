import { formatMoney, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import type { PauseRead } from "@/components/settings/pause-read";
import type { PauseOffer } from "@/lib/api/billing";

import {
  US_REGISTRATION_PAUSED_HEADING,
  US_REGISTRATION_PAUSED_NOTE,
  US_REGISTRATION_RUNNING_TAIL,
  usRegistrationFee,
  usRegistrationPausedTerms,
  usRegistrationStarted,
  usRegistrationTail,
  usRegistrationTerms,
  usRegistrationTiming,
} from "./us-registration-timing";

/**
 * #525 — buying US registration during a paused season.
 *
 * The decision is ALLOW IT, DISCLOSE IT. So the guards here come in two halves,
 * and both matter: the copy must not quietly refuse or discourage (that is the
 * decision), and it must not promise a live inbox to somebody whose pause will
 * still be holding sending when the carriers say yes (that is the disclosure).
 *
 * Every assertion below reads the SHIPPED constant. A guard that quotes a
 * sentence typed into the test cannot fail when the sentence on screen changes.
 */
const ANSWER: PauseOffer = {
  eligible: false,
  reason: "already_paused",
  paused_at: null,
  monthly_cents: 1275,
  resume_plan: "pro",
};

const PAUSED: PauseRead = {
  state: "answered",
  answer: { ...ANSWER, paused_at: "2026-01-14T00:00:00.000Z" },
};
const RUNNING: PauseRead = { state: "answered", answer: { ...ANSWER } };

describe("#525 what the enable-US card may say about timing", () => {
  it("TIM-1: only an answer decides, and a read in flight decides nothing", () => {
    expect(usRegistrationTiming(PAUSED)).toBe("paused");
    expect(usRegistrationTiming(RUNNING)).toBe("running");

    // THE DEFECT THIS EXISTS FOR. `loading` and `failed` are not "not paused".
    // Fold either into "running" — which is what `data?.paused_at != null`
    // does — and a paused owner is told their US texting goes live, on the one
    // screen where they are handing over a card.
    expect(usRegistrationTiming({ state: "loading" })).toBe("unknown");
    expect(usRegistrationTiming({ state: "failed" })).toBe("unknown");

    // `unasked` is the carve-out, and it is knowledge rather than ignorance:
    // the gate only closes for a workspace with no plan or no live
    // subscription, which is exactly the shape a paused workspace cannot have.
    expect(usRegistrationTiming({ state: "unasked" })).toBe("running");
  });

  it("TIM-2: 'we email you when it's live' is said only to a plan we know is running", () => {
    expect(usRegistrationTail("running")).toBe(US_REGISTRATION_RUNNING_TAIL);
    // Withheld, not replaced. On a pause the three terms below say what
    // happens; on an unread pause there is nothing honest to add, and the core
    // terms are true either way — so silence costs the reader nothing.
    expect(usRegistrationTail("paused")).toBeNull();
    expect(usRegistrationTail("unknown")).toBeNull();
  });

  it("TIM-3: every figure resolves to the shared price book, in the workspace's currency", () => {
    for (const currency of ["usd", "cad"] as const) {
      expect(usRegistrationFee(currency)).toBe(
        formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency),
      );
      expect(usRegistrationTerms(currency)).toContain(
        usRegistrationFee(currency),
      );
      expect(
        usRegistrationPausedTerms(currency).some((line) =>
          line.includes(usRegistrationFee(currency)),
        ),
        `${currency} paused terms must name the fee`,
      ).toBe(true);
    }

    // #328: a CA workspace is billed the CAD figure. Printing the US one would
    // be a price the owner can check against their statement and find wrong —
    // and the paused copy is the copy that talks about the money twice.
    const cad = [
      usRegistrationTerms("cad"),
      ...usRegistrationPausedTerms("cad"),
    ].join(" ");
    expect(cad).toContain(usRegistrationFee("cad"));
    expect(cad).not.toContain(usRegistrationFee("usd"));
  });

  it("TIM-4: the paused terms cover the money, the wait, and the limit", () => {
    const terms = usRegistrationPausedTerms("usd");
    // Three facts as three lines. Concatenating them buries the third, and the
    // third is the only one that changes what the reader expects to happen.
    expect(terms).toHaveLength(3);

    const [money, wait, limit] = terms;
    // Charged once EVER (`registration_fee_paid_at`), which is the entire value
    // argument for buying during the quiet season rather than in spring.
    expect(money).toContain(usRegistrationFee("usd"));
    expect(money.toLowerCase()).toContain("once ever");
    // The carriers review while paused — established end to end in the API,
    // not assumed. If that ever stopped being true this line becomes a lie and
    // the whole decision changes, so it is stated plainly enough to notice.
    expect(wait.toLowerCase()).toContain("paused");
    // And approval does NOT lift the pause: `runPreSendGates` still refuses.
    expect(limit.toLowerCase()).toContain("resume");
    expect(limit.toLowerCase()).toContain("sending");
  });

  it("TIM-5: the paused copy invites the purchase, and never refuses it", () => {
    // #525 rule 1 is "do not add a gate that refuses the registration", and
    // copy refuses just as effectively as code: an owner told to come back
    // later does not press the button, and the outcome is identical to a 409.
    const invitation = `${US_REGISTRATION_PAUSED_HEADING} ${US_REGISTRATION_PAUSED_NOTE}`;
    const everything = `${invitation} ${usRegistrationPausedTerms("usd").join(" ")}`.toLowerCase();
    for (const refusal of [
      "resume first",
      "unavailable",
      "not available",
      "cannot register",
      "cannot start",
      "before you can",
      "wait until your plan",
    ]) {
      expect(everything, `copy must not say "${refusal}"`).not.toContain(
        refusal,
      );
    }

    // Positive, so an empty string cannot satisfy the ban above. The heading
    // leads with what they CAN do — a paused owner looking at a US texting card
    // that says nothing about their pause concludes it is shut to them, which
    // is refusal arrived at by silence.
    expect(US_REGISTRATION_PAUSED_HEADING.toLowerCase()).toContain("you can");
    expect(US_REGISTRATION_PAUSED_NOTE.length).toBeGreaterThan(40);
  });

  it("TIM-6: the invitation on the card does not argue the pause's terms", () => {
    // The card is an invitation; the dialog is the agreement. Putting "you
    // still cannot send" on the card would lead with the restriction on a
    // surface nobody has agreed to anything on yet, and would say it twice to
    // anybody who opens the dialog. The note earns its place by being the
    // reason to act, and the terms earn theirs by being where the money is.
    const note = US_REGISTRATION_PAUSED_NOTE.toLowerCase();
    expect(note).not.toContain("charged");
    expect(note).not.toContain("resume");
  });
});

describe("#525: the toast after the charge", () => {
  it("tells a paused buyer the thing that decides whether they can use it", () => {
    // Android and iOS both branched this and web did not, so a paused owner
    // pressed the button, paid, and was told "we'll email you when it's
    // approved" - true, and silent about the resume. The approval is not the
    // fact they need.
    expect(usRegistrationStarted("paused")).toContain("resume");
  });

  it("does not tell a running workspace to resume anything", () => {
    // The other direction, which is the common one. `unknown` takes the running
    // wording on purpose: telling a paying crew to resume a plan that is
    // already running is the worse error.
    for (const timing of ["running", "unknown"] as const) {
      expect(usRegistrationStarted(timing), timing).not.toContain("resume");
    }
  });
});
