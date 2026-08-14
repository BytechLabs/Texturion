/**
 * #232 — the widget intake, which is a public write endpoint on other people's
 * websites that spends money per use.
 *
 * So what this suite defends is mostly REFUSALS. The happy path is one test;
 * the rest are the ways a stranger, a bot or a broken embed must be stopped
 * before anything costs a segment.
 */
import { describe, expect, it, vi } from "vitest";

import {
  hashWidgetCode,
  mintWidgetCode,
  normaliseVisitorNumber,
  WIDGET_CODES_PER_NUMBER_PER_DAY,
  WIDGET_CODE_TTL_SECONDS,
} from "./widget";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

describe("the number a visitor typed", () => {
  it("accepts the shapes a person actually types", () => {
    // One field on somebody's plumber's website, filled in by a homeowner on a
    // phone. Every one of these is the same number.
    for (const typed of [
      "5551234567",
      "555 123 4567",
      "(555) 123-4567",
      "555-123-4567",
      "15551234567",
      "+1 555 123 4567",
    ]) {
      expect(normaliseVisitorNumber(typed)).toBe("+15551234567");
    }
  });

  it("refuses what it cannot text, rather than guessing", () => {
    // The alternative to refusing is texting somebody else, which is worse than
    // an error message on a form.
    for (const typed of ["", "123", "abcdefghij", "555-12", "+", "++15551234567"]) {
      expect(normaliseVisitorNumber(typed)).toBeNull();
    }
  });

  it("keeps a longer international number when it is written as one", () => {
    // The send gates refuse non-NANP anyway, and refusing it HERE would report
    // "that is not a number" about a number that plainly is one.
    expect(normaliseVisitorNumber("+442071234567")).toBe("+442071234567");
  });
});

describe("the code", () => {
  it("is six digits, keeping a leading zero", () => {
    // A five-digit code that happens to start with a zero is a quietly weaker
    // code, and the padding is the only thing preventing it.
    for (let i = 0; i < 200; i += 1) {
      expect(mintWidgetCode()).toMatch(/^\d{6}$/);
    }
  });

  it("is not the same code twice in a row", () => {
    // Not a randomness test — a guard against the plausible mistake of minting
    // once at module scope, which would hand every visitor the same code.
    const drawn = new Set(Array.from({ length: 200 }, () => mintWidgetCode()));
    expect(drawn.size).toBeGreaterThan(150);
  });

  it("hashes with the row's id, so two identical codes do not collide", () => {
    // Six digits means collisions are ordinary, not exotic. Without the salt,
    // one rainbow table covers every code this product will ever send.
    return Promise.all([
      hashWidgetCode("11111111-1111-4111-8111-111111111111", "123456"),
      hashWidgetCode("22222222-2222-4222-8222-222222222222", "123456"),
      hashWidgetCode("11111111-1111-4111-8111-111111111111", "123456"),
    ]).then(([a, b, again]) => {
      expect(a).not.toBe(b);
      expect(a).toBe(again);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      // And the code itself is nowhere in it.
      expect(a).not.toContain("123456");
    });
  });
});

describe("the numbers this feature is bounded by", () => {
  it("caps a single number well below a company's day", () => {
    // The per-number budget is the one that stops the platform becoming an
    // amplifier: without it, a widget is a way to text one person once per
    // workspace, and there is no ceiling on the number of workspaces.
    expect(WIDGET_CODES_PER_NUMBER_PER_DAY).toBeLessThan(10);
  });

  it("expires a code in minutes, not hours", () => {
    // Long enough for a phone in another room; short enough that a code read
    // over somebody's shoulder is worthless by the time it is used.
    expect(WIDGET_CODE_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(WIDGET_CODE_TTL_SECONDS).toBeGreaterThanOrEqual(120);
  });
});
