import { describe, expect, it } from "vitest";

import {
  SPAM_SUSPECT_THRESHOLD,
  scoreInboundSpam,
  type SpamVerdict,
} from "./spam-signals";

/**
 * #250 — the classifier, tested from the expensive direction first.
 *
 * The costly mistake here is NOT missing a robotext. It is flagging a real
 * first-time customer, because every genuine new lead is an unknown sender
 * with no prior outbound — that is the definition of a new lead — and a
 * misfiled customer is a lost job. So the false-positive cases come first and
 * outnumber the true positives deliberately.
 */

const stranger = { knownContact: false, hasPriorOutbound: false };

function score(from: string, body: string | null, rest = stranger): SpamVerdict {
  return scoreInboundSpam({ from, body, ...rest });
}

describe("#250 real customers are never suspected", () => {
  // Every one of these is a plausible first text to a trades business from
  // somebody who has never contacted them before.
  const REAL_LEADS: [string, string][] = [
    ["+14155550188", "Hi, do you do emergency callouts? My kitchen tap is flooding."],
    ["+16135550143", "Got your number off the truck. Can you quote a bathroom reno?"],
    ["+14035550111", "URGENT - no heat and it's -20. Can anyone come tonight??"],
    ["+19055550101", "Are you free Saturday? I can send photos of the damage"],
    ["+15195550122", "Hi it's Dave from 14 Elm St, the furnace is making that noise again"],
    ["+14165550190", "how much to replace a hot water tank"],
    ["+16045550177", "Sorry to text so late. Water heater is leaking everywhere."],
    // A customer sharing a link is ordinary. One signal must never be enough.
    ["+14165550191", "Here's the listing with the specs: https://bit.ly/3xkPq2"],
    // Somebody quoting a scam text to ask whether it is real. Content looks
    // bad, but they are texting a person, from a real mobile.
    ["+14165550192", "Is this you? 'Your package is on hold, verify your identity now'"],
  ];

  for (const [from, body] of REAL_LEADS) {
    it(`lets through: "${body.slice(0, 44)}${body.length > 44 ? "…" : ""}"`, () => {
      const verdict = score(from, body);
      expect(
        verdict.suspected,
        `scored ${verdict.score} on ${verdict.signals.map((s) => s.key).join(", ")}`,
      ).toBe(false);
    });
  }

  it("says nothing at all about somebody we already know", () => {
    // A regular customer forwarding a marketing text is not a spammer, and a
    // relationship outranks every content signal there is.
    const spammy =
      "LIMITED TIME OFFER! Claim your prize at https://bit.ly/x - reply STOP to opt out";
    expect(score("+14155550188", spammy).suspected).toBe(true);
    expect(
      score("+14155550188", spammy, { knownContact: true, hasPriorOutbound: false })
        .suspected,
    ).toBe(false);
    expect(
      score("+14155550188", spammy, { knownContact: false, hasPriorOutbound: true })
        .suspected,
    ).toBe(false);
  });

  it("scores an empty or missing body at zero", () => {
    // An MMS with no text is a photo, which is how customers send damage.
    expect(score("+14155550188", null).score).toBe(0);
    expect(score("+14155550188", "").score).toBe(0);
    expect(score("", "").score).toBe(0);
  });
});

describe("#250 robotexts are caught", () => {
  it("catches a shortcode marketing blast", () => {
    const verdict = score(
      "72345",
      "LIMITED TIME OFFER! 50% off, claim your discount: https://bit.ly/2abc Reply STOP to opt out",
    );
    expect(verdict.suspected).toBe(true);
    expect(verdict.signals.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        "sender_not_dialable",
        "link_shortener",
        "bulk_footer",
        "broadcast_language",
      ]),
    );
  });

  it("catches an alphanumeric sender", () => {
    const verdict = score(
      "INFO-TXT",
      "Congratulations, you have been selected. Act now to claim your reward.",
    );
    expect(verdict.suspected).toBe(true);
  });

  it("catches a phishing text from a spoofed long code", () => {
    // The sender looks dialable, so this rests entirely on the body — which is
    // why the authority-plus-urgency shape carries the heaviest weight.
    const verdict = score(
      "+12125559999",
      "Your account has been suspended. Verify your identity now: https://tinyurl.com/x9",
    );
    expect(verdict.suspected).toBe(true);
    expect(verdict.signals.map((s) => s.key)).toContain("authority_urgency");
  });

  it("explains itself, so the badge can say why", () => {
    const verdict = score("72345", "Final notice! Reply STOP to opt out");
    expect(verdict.signals.length).toBeGreaterThan(0);
    for (const signal of verdict.signals) {
      expect(signal.why.length).toBeGreaterThan(20);
      expect(signal.weight).toBeGreaterThan(0);
    }
  });
});

describe("#250 the threshold needs corroboration", () => {
  it("never suspects on a single signal", () => {
    // Each of these produces exactly one signal. If any one of them alone
    // crossed the line, ordinary customer messages would start disappearing
    // from notifications.
    const singles = [
      score("+14155550188", "Photos here https://bit.ly/abc"),
      score("+14155550188", "To unsubscribe from our newsletter"),
      score("+14155550188", "Act now"),
      score("72345", "hello"),
    ];
    for (const verdict of singles) {
      expect(verdict.signals.length).toBeLessThanOrEqual(1);
      expect(verdict.suspected).toBe(false);
    }
  });

  it("keeps the threshold above the heaviest single signal", () => {
    // A guard on the constant itself: if somebody raises a weight to 3+ the
    // corroboration rule above silently stops holding.
    const heaviest = score(
      "+12125559999",
      "Your account has been suspended, verify your identity now",
    );
    expect(heaviest.signals).toHaveLength(1);
    // STRICTLY below: at equal weight one signal suspects on its own, which is
    // how the quoted-scam case above started failing.
    expect(heaviest.signals[0]?.weight).toBeLessThan(SPAM_SUSPECT_THRESHOLD);
  });
});
