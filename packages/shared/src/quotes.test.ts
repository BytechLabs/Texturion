import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import { formatMoney } from "./billing-currency";
import { quoteSms } from "./quotes";

import {
  QUOTE_STATUSES,
  QUOTE_STATUS_KEYS,
  canTransitionQuote,
  effectiveQuoteStatus,
  isQuoteDecided,
  isQuoteDecidedForWinRate,
  isQuoteOutstanding,
  isQuoteStatus,
  type QuoteState,
  type QuoteStatus,
} from "./quotes";

/**
 * #287 — the rules a quote's status obeys, on all three clients.
 *
 * The case that matters most is the one nothing writes down: expiry is
 * DERIVED, not stored, so these assert the reading rather than a column. A
 * cron that wrote `expired` could fall behind and leave a row saying `sent`
 * about a price nobody honours; deriving it means there is no window at all.
 */

const NOW = new Date("2026-08-16T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const quote = (over: Partial<QuoteState> = {}): QuoteState => ({
  status: "sent",
  expires_at: new Date(NOW.getTime() + 7 * DAY).toISOString(),
  ...over,
});

/** Every expiry is computed from NOW, never a literal date (#time-bombs). */
const expiresIn = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("#287 the vocabulary", () => {
  it("recognises its own statuses and nothing else", () => {
    for (const status of QUOTE_STATUSES) expect(isQuoteStatus(status)).toBe(true);
    expect(isQuoteStatus("paid")).toBe(false);
    expect(isQuoteStatus("")).toBe(false);
  });

  it("names a catalogue key for every status, and the catalogue answers", () => {
    // The #228 rule applied from the start rather than retrofitted: a shared
    // module that returned a finished English sentence would answer in the
    // crew's language regardless of who is reading.
    for (const status of QUOTE_STATUSES) {
      const key = QUOTE_STATUS_KEYS[status];
      const [section, name] = key.split(".");
      for (const [lang, table] of [
        ["English", WEB_EN],
        ["French", WEB_FR],
      ] as const) {
        const text = (table as Record<string, Record<string, string>>)[section]?.[name];
        expect(typeof text, `${lang} has no ${key}`).toBe("string");
        expect(text, `${lang} ${key} is empty`).not.toBe("");
      }
    }
  });
});

describe("#287 expiry is read, not stored", () => {
  it("reads a sent quote past its date as expired", () => {
    // Nothing wrote this. That is the point.
    expect(
      effectiveQuoteStatus(quote({ expires_at: expiresIn(-1) }), NOW),
    ).toBe("expired");
  });

  it("leaves a live one alone", () => {
    expect(effectiveQuoteStatus(quote({ expires_at: expiresIn(DAY) }), NOW)).toBe(
      "sent",
    );
  });

  it("does not un-accept a quote that was accepted", () => {
    // A decision is final: the deadline was for answering, and it was
    // answered. Expiring an accepted quote would retract work the crew is
    // already doing.
    expect(
      effectiveQuoteStatus(
        quote({ status: "accepted", expires_at: expiresIn(-DAY) }),
        NOW,
      ),
    ).toBe("accepted");
    expect(
      effectiveQuoteStatus(
        quote({ status: "declined", expires_at: expiresIn(-DAY) }),
        NOW,
      ),
    ).toBe("declined");
  });

  it("never expires a draft", () => {
    // An unsent price is not an offer, so there is no deadline anybody missed.
    expect(
      effectiveQuoteStatus(
        quote({ status: "draft", expires_at: expiresIn(-DAY) }),
        NOW,
      ),
    ).toBe("draft");
  });

  it("treats an unreadable date as no expiry rather than as expiry", () => {
    // Fail toward the live offer. Reading a bad string as "expired" would
    // silently withdraw a price the business is still standing behind.
    expect(effectiveQuoteStatus(quote({ expires_at: "not a date" }), NOW)).toBe(
      "sent",
    );
  });

  it("expires exactly at the boundary rather than a moment after", () => {
    expect(effectiveQuoteStatus(quote({ expires_at: NOW.toISOString() }), NOW)).toBe(
      "expired",
    );
  });
});

describe("#287 the outstanding queue", () => {
  it("holds what has been asked and not answered", () => {
    expect(isQuoteOutstanding(quote({ status: "sent" }), NOW)).toBe(true);
    // Viewing is not answering.
    expect(isQuoteOutstanding(quote({ status: "viewed" }), NOW)).toBe(true);
  });

  it("excludes a draft, which was never offered to anybody", () => {
    expect(isQuoteOutstanding(quote({ status: "draft" }), NOW)).toBe(false);
  });

  it("drops a quote the moment it expires, with nothing having run", () => {
    const stale = quote({ status: "sent", expires_at: expiresIn(-1) });
    expect(isQuoteOutstanding(stale, NOW)).toBe(false);
  });

  it("excludes anything decided", () => {
    for (const status of ["accepted", "declined"] as QuoteStatus[]) {
      expect(isQuoteOutstanding(quote({ status }), NOW)).toBe(false);
    }
  });
});

describe("#287 what may follow what", () => {
  it("sends a draft and nothing else", () => {
    expect(canTransitionQuote("draft", "sent")).toBe(true);
    expect(canTransitionQuote("draft", "accepted")).toBe(false);
  });

  it("never returns to draft", () => {
    // A price that has been sent has been seen. Pretending otherwise loses
    // the record of what was actually offered, which is the dispute this
    // whole feature exists to settle.
    for (const status of QUOTE_STATUSES) {
      expect(canTransitionQuote(status, "draft"), status).toBe(false);
    }
  });

  it("makes a decision final", () => {
    for (const from of ["accepted", "declined"] as QuoteStatus[]) {
      for (const to of QUOTE_STATUSES) {
        expect(canTransitionQuote(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("does not re-open an expired quote", () => {
    // Re-offering is a NEW quote at today's price, which is the honest thing
    // for a trade whose material costs move.
    for (const to of QUOTE_STATUSES) {
      expect(canTransitionQuote("expired", to), to).toBe(false);
    }
  });

  it("lets a viewed quote still be answered either way", () => {
    expect(canTransitionQuote("viewed", "accepted")).toBe(true);
    expect(canTransitionQuote("viewed", "declined")).toBe(true);
  });
});

describe("#287 what a win rate is allowed to count", () => {
  it("counts only quotes somebody answered", () => {
    expect(isQuoteDecidedForWinRate(quote({ status: "accepted" }), NOW)).toBe(true);
    expect(isQuoteDecidedForWinRate(quote({ status: "declined" }), NOW)).toBe(true);
  });

  it("does not count silence as a loss", () => {
    /*
     * The trap `pipelineWinRate` already documents: counting an unanswered
     * quote as a loss makes the rate fall every time a crew quotes MORE work,
     * which is a number that punishes the behaviour it exists to encourage.
     * An expired quote is silence, not a no.
     */
    expect(
      isQuoteDecidedForWinRate(quote({ expires_at: expiresIn(-DAY) }), NOW),
    ).toBe(false);
    expect(isQuoteDecidedForWinRate(quote({ status: "sent" }), NOW)).toBe(false);
    expect(isQuoteDecidedForWinRate(quote({ status: "draft" }), NOW)).toBe(false);
  });

  it("agrees with isQuoteDecided about the stored half", () => {
    expect(isQuoteDecided("accepted")).toBe(true);
    expect(isQuoteDecided("sent")).toBe(false);
  });
});

/**
 * #228 — the text a customer gets about a price is in their language.
 *
 * Both of the money texts this product sends — the quote and the payment ask —
 * were composed in English regardless of who was reading them, which is the
 * exact gap #228 names: "a French-speaking customer receiving an English STOP
 * footer is a poor experience and arguably a defective disclosure". A quote is
 * worse than a footer, because it is often the FIRST thing a customer ever
 * receives from the business.
 */
describe("#228 the quote text speaks the customer's language", () => {
  const args = {
    businessName: "Plomberie Apex",
    amountCents: 45_000,
    currency: "cad" as const,
    description: "Remplacer le chauffe-eau",
    url: "https://app.loonext.com/q/tok",
  };

  it("writes the sentence in French for a French customer", () => {
    const text = quoteSms({ ...args, locale: "fr-CA" });
    expect(text).toContain("Consultez le devis");
    expect(text).not.toContain("See the quote");
  });

  it("still writes English for everybody else", () => {
    const text = quoteSms({ ...args, locale: "en" });
    expect(text).toContain("See the quote and accept it here");
  });

  it("leaves the FIGURE alone in both", () => {
    // The number is not copy. A customer quoted $450 must read $450 in the text
    // and on the page they accept — a price that changes shape between two
    // screens is a price somebody disputes, and this feature exists to prevent
    // exactly that argument.
    const fr = quoteSms({ ...args, locale: "fr-CA" });
    const en = quoteSms({ ...args, locale: "en" });
    const amount = formatMoney(45_000, "cad");
    expect(fr).toContain(amount);
    expect(en).toContain(amount);
  });

  it("carries the link unchanged, because a URL is not a sentence", () => {
    for (const locale of ["en", "fr-CA"] as const) {
      expect(quoteSms({ ...args, locale })).toContain(args.url);
    }
  });
});
