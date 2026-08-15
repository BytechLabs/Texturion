import { describe, expect, it } from "vitest";

import { REFERRAL_REWARDS_PER_YEAR } from "./referrals";
import {
  REFERRAL_ASK_MIN_CUSTOMERS,
  REFERRAL_ASK_MIN_DAYS,
  REFERRAL_ASK_QUIET_DAYS,
  REFERRAL_ASK_ACTION,
  REFERRAL_ASK_BODY,
  REFERRAL_ASK_DISMISS,
  REFERRAL_REWARD_LINE,
  REFERRAL_SHARE_ACTION,
  REFERRAL_SHARE_COPIED,
  REFERRAL_SHARE_COPY,
  REFERRAL_SHARE_DRAFT_LABEL,
  REFERRAL_SHARE_LINK_NOTE,
  REFERRAL_SHARE_NOTE,
  REFERRAL_SHARE_TITLE,
  REFERRAL_STAGE_LABELS,
  referralAskDecision,
  referralAskHeadline,
  referralShareText,
  type ReferralAskFacts,
} from "./referral-share";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/* #228 — this module names keys, so the assertions resolve them. */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");

/* The share fallback carries {code}, so its resolver substitutes. */
function withVars(table: unknown, lang: string) {
  return (key: string, vars: Record<string, string>): string =>
    Object.entries(vars).reduce(
      (out, [token, value]) => out.split(`{${token}}`).join(value),
      lookUp(table, key, lang),
    );
}

const sayVars = withVars(WEB_EN, "English");
const sayVarsFr = withVars(WEB_FR, "French");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-08T12:00:00.000Z");

function ago(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

/** A workspace that has earned the ask, so each test can break one thing. */
function earned(overrides: Partial<ReferralAskFacts> = {}): ReferralAskFacts {
  return {
    activated: true,
    activatedAt: ago(60),
    repliedCustomers: REFERRAL_ASK_MIN_CUSTOMERS + 5,
    dismissedAt: null,
    rewardsThisYear: 0,
    rewardCap: REFERRAL_REWARDS_PER_YEAR,
    ...overrides,
  };
}

describe("referralShareText", () => {
  it("puts the link on the end so an edited message keeps it", () => {
    const text = referralShareText("Come try this", "https://loonext.com/?ref=ABCD2345", "ABCD2345", sayVars);
    expect(text).toBe("Come try this\n\nhttps://loonext.com/?ref=ABCD2345");
  });

  it("survives the owner deleting every word of it", () => {
    // The whole reason the link is not inside the editable box. An empty draft
    // must still send something usable rather than a lone blank line.
    expect(referralShareText("   ", "https://loonext.com/?ref=ABCD2345", "ABCD2345", sayVars)).toBe(
      "https://loonext.com/?ref=ABCD2345",
    );
  });

  it("falls back to the code when there is no link to give", () => {
    // SITE_ORIGIN unset. A code read aloud at a supply counter is how a fair
    // share of these will travel anyway; "undefined/?ref=" is not.
    expect(referralShareText("Have a look", null, "ABCD2345", sayVars)).toBe(
      "Have a look\n\nUse my code ABCD2345 when you sign up.",
    );
  });

  it("#228 gives a French owner a French line under their own words", () => {
    // Unlike the automated bodies in locale.ts, this is not sent by us. It is
    // dropped into a share sheet for the OWNER to send, sitting under words
    // they typed - so one English line at the bottom of a French message is
    // the product speaking out of turn in somebody else's conversation.
    const text = referralShareText("Essayez ceci", null, "ABCD2345", sayVarsFr);
    expect(text).toContain("ABCD2345");
    expect(text).toContain("Utilisez mon code");
    expect(text).not.toContain("when you sign up");
    expect(text).not.toMatch(/\{/);
  });

  it("#228 never reaches the fallback sentence when a link exists", () => {
    // The link case is the common one and carries no sentence at all, in
    // either language - a URL is not copy.
    for (const resolve of [sayVars, sayVarsFr]) {
      const text = referralShareText("x", "https://x.test/?ref=A", "A", resolve);
      expect(text).toBe("x\n\nhttps://x.test/?ref=A");
    }
  });

  it("trims the draft rather than sending trailing whitespace", () => {
    expect(referralShareText("Look  \n\n", "https://x.test/?ref=A", "A", sayVars)).toBe(
      "Look\n\nhttps://x.test/?ref=A",
    );
  });
});

describe("REFERRAL_SHARE_NOTE", () => {
  it("does not claim the crew is limited to one number", () => {
    // A crew can run several numbers, so "one number" is a promise the product
    // does not make. The inbox is the thing that is singular.
    expect(REFERRAL_SHARE_NOTE).not.toMatch(/one number/i);
  });

  it("carries no link of its own", () => {
    // referralShareText appends it. A URL in the default draft would be a
    // second place for the link to come from, and one of the two would be wrong.
    expect(REFERRAL_SHARE_NOTE).not.toMatch(/https?:/);
  });

  it("fits in a text message somebody will actually read", () => {
    expect(REFERRAL_SHARE_NOTE.length).toBeLessThanOrEqual(220);
  });
});

describe("referralAskDecision", () => {
  it("asks a workspace that has been working for a month", () => {
    expect(referralAskDecision(earned(), NOW)).toEqual({
      ask: true,
      customers: REFERRAL_ASK_MIN_CUSTOMERS + 5,
    });
  });

  it("never asks at signup", () => {
    // The acceptance criterion, stated as a test: a workspace the product has
    // not worked for once is not asked to vouch for it.
    expect(
      referralAskDecision(earned({ activated: false, activatedAt: null }), NOW),
    ).toEqual({ ask: false, refusal: "not_activated" });
  });

  it("does not ask a workspace that activated yesterday", () => {
    expect(referralAskDecision(earned({ activatedAt: ago(1) }), NOW).refusal).toBe(
      "too_new",
    );
  });

  it("counts the month from the day it started working, not from signup", () => {
    // One day short, then one day over. The boundary is the whole point of the
    // constant, so it is asserted rather than assumed.
    expect(
      referralAskDecision(
        earned({ activatedAt: ago(REFERRAL_ASK_MIN_DAYS - 1) }),
        NOW,
      ).ask,
    ).toBe(false);
    expect(
      referralAskDecision(earned({ activatedAt: ago(REFERRAL_ASK_MIN_DAYS) }), NOW)
        .ask,
    ).toBe(true);
  });

  it("does not ask a crew the product is barely doing anything for", () => {
    expect(
      referralAskDecision(
        earned({ repliedCustomers: REFERRAL_ASK_MIN_CUSTOMERS - 1 }),
        NOW,
      ),
    ).toEqual({ ask: false, refusal: "too_quiet" });
  });

  it("takes 'Not now' as an answer for a quarter", () => {
    expect(
      referralAskDecision(earned({ dismissedAt: ago(1) }), NOW).refusal,
    ).toBe("dismissed");
    expect(
      referralAskDecision(
        earned({ dismissedAt: ago(REFERRAL_ASK_QUIET_DAYS - 1) }),
        NOW,
      ).ask,
    ).toBe(false);
    expect(
      referralAskDecision(
        earned({ dismissedAt: ago(REFERRAL_ASK_QUIET_DAYS) }),
        NOW,
      ).ask,
    ).toBe(true);
  });

  it("stops asking once the reward can no longer be paid", () => {
    // Not a timing rule — an honesty one. decideReferral refuses a capped
    // referrer's claim, so asking anyway would offer a month we have already
    // decided not to pay, and their friend is the one who finds out.
    expect(
      referralAskDecision(
        earned({ rewardsThisYear: REFERRAL_REWARDS_PER_YEAR }),
        NOW,
      ),
    ).toEqual({ ask: false, refusal: "capped" });
    expect(
      referralAskDecision(
        earned({ rewardsThisYear: REFERRAL_REWARDS_PER_YEAR - 1 }),
        NOW,
      ).ask,
    ).toBe(true);
  });

  it("refuses rather than guesses when a timestamp is unreadable", () => {
    expect(referralAskDecision(earned({ activatedAt: "not a date" }), NOW).ask).toBe(
      false,
    );
    // A dismissal we cannot parse is still a dismissal. Somebody pressed the
    // button; our parsing problem must not turn that into a yes.
    expect(
      referralAskDecision(earned({ dismissedAt: "not a date" }), NOW),
    ).toEqual({ ask: false, refusal: "dismissed" });
  });

  it("treats activated-without-a-timestamp as not activated", () => {
    // The two halves come from different columns, and a row where one is set
    // and the other is not would otherwise fall through to a NaN comparison.
    expect(
      referralAskDecision(earned({ activatedAt: null }), NOW).refusal,
    ).toBe("not_activated");
  });
});

describe("referralAskHeadline", () => {
  it("counts in customers, in their own numbers", () => {
    expect(referralAskHeadline(37, say)).toBe("You replied to 37 customers this month.");
  });

  it("does not say '1 customers'", () => {
    expect(referralAskHeadline(1, say)).toBe("You replied to 1 customer this month.");
  });

  it("does not say it in French either", () => {
    // The reason singular and plural are separate keys rather than one sentence
    // with the number swapped in. A French translation that reused the plural
    // would read "1 clients", which is the exact defect the English test above
    // exists to prevent, in the language nobody re-reads.
    expect(referralAskHeadline(1, sayFr)).not.toMatch(/1 clients/);
    expect(referralAskHeadline(37, sayFr)).toContain("37");
    expect(referralAskHeadline(1, sayFr)).not.toBe(referralAskHeadline(37, sayFr));
  });
});

/*
 * #228 — every key this module names, resolved in both languages.
 *
 * Written up front rather than after a break-test found the gap: these are
 * fifteen exported constants that clients render directly, so a typo in any one
 * reaches a screen as its own name and nothing else here would notice.
 */
describe("#228 every referral string exists in both languages", () => {
  it("resolves all of them", () => {
    const keys = [
      REFERRAL_SHARE_NOTE,
      REFERRAL_SHARE_TITLE,
      REFERRAL_REWARD_LINE,
      REFERRAL_SHARE_ACTION,
      REFERRAL_SHARE_COPY,
      REFERRAL_SHARE_COPIED,
      REFERRAL_SHARE_DRAFT_LABEL,
      REFERRAL_SHARE_LINK_NOTE,
      REFERRAL_ASK_BODY,
      REFERRAL_ASK_ACTION,
      REFERRAL_ASK_DISMISS,
      ...Object.values(REFERRAL_STAGE_LABELS),
    ];
    for (const key of keys) {
      expect(say(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
    }
    expect(keys.length).toBeGreaterThan(14);
  });

  it("gives each referral stage its own words", () => {
    // Five stages sharing a label would satisfy every assertion above while
    // making the progress list say nothing.
    const labels = Object.values(REFERRAL_STAGE_LABELS).map(say);
    expect(new Set(labels).size).toBe(Object.keys(REFERRAL_STAGE_LABELS).length);
  });
});
