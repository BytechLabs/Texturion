/**
 * #232 — the widget intake, which is a public write endpoint on other people's
 * websites that spends money per use.
 *
 * So what this suite defends is mostly REFUSALS. The happy path is one test;
 * the rest are the ways a stranger, a bot or a broken embed must be stopped
 * before anything costs a segment.
 */
import { readFileSync } from "node:fs";

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

describe("what the two endpoints refuse to tell a caller", () => {
  it("answers every failed code the same way", () => {
    // Wrong, expired, spent, unknown id — one sentence. A visitor standing on a
    // plumber's website can act on none of the distinctions, and a caller who
    // COULD tell them apart would learn which verification ids exist and which
    // codes are still live.
    //
    // Asserted against the source because the alternative is a route test that
    // stubs five failure modes and proves only that the stubs were written.
    const source = readFileSync(
      new URL("./widget.ts", import.meta.url),
      "utf8",
    );
    const answerBranch = source.slice(source.indexOf("api_answer_widget_verification"));
    const messages = [...answerBranch.matchAll(/"([^"]*did not work[^"]*)"/g)];
    expect(messages).toHaveLength(1);
    // And the reason the RPC gave is never handed back.
    expect(answerBranch).not.toContain("result.reason");
  });

  it("spends the code before the message is threaded", () => {
    // A code answered correctly is used up whether or not everything after it
    // succeeds. The other order leaves a live code behind whenever threading
    // fails — a replayable credential created by an error path.
    const source = readFileSync(
      new URL("./widget.ts", import.meta.url),
      "utf8",
    );
    expect(source.indexOf("api_answer_widget_verification")).toBeLessThan(
      source.indexOf("thread_inbound_message"),
    );
  });

  it("threads a widget message with no carrier id and our own key", () => {
    // The whole point of the #232 source discriminator: no invented Telnyx id,
    // and a key that makes a double-tapped submit one thread.
    const source = readFileSync(
      new URL("./widget.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("p_telnyx_message_id: null");
    expect(source).toContain('p_source: "widget"');
    expect(source).toContain("p_idempotency_key: `widget:${body.verificationId}`");
  });

  it("answers an 11pm visitor with the owner's own away message", () => {
    // #232 phase 3. `maybeSendAwayReply` hangs off the CARRIER webhook, and a
    // widget message never goes near it — so a visitor typing at 11pm on a
    // Sunday got a thread nobody would look at until Monday and no
    // acknowledgement at all, from the highest-intent moment the product has.
    //
    // Two things have to be true and both are structural, which is why they
    // are read from the source rather than from a stubbed send: the call
    // exists, and it is behind `created`. Without the guard a double-tapped
    // submit that re-threads would answer the same visitor twice.
    const source = readFileSync(
      new URL("./widget.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("maybeSendAwayReply");
    const guard = source.indexOf("if (landed.created)");
    expect(guard).toBeGreaterThan(-1);
    expect(source.indexOf("maybeSendAwayReply(env, db,")).toBeGreaterThan(guard);
    // AFTER threading, because the reply is about a conversation that exists.
    expect(source.indexOf("thread_inbound_message")).toBeLessThan(guard);
  });

  it("resolves the line once, for both halves of a submission", () => {
    // The code is sent in one request and the message threaded in another,
    // minutes later. Two copies of "oldest active" agreed by accident; the
    // moment a workspace can choose, two copies are two chances to disagree —
    // and the visitor would prove their phone against one line while the
    // crew's reply arrived from another.
    const source = readFileSync(
      new URL("./widget.ts", import.meta.url),
      "utf8",
    );
    const calls = [...source.matchAll(/resolveWidgetNumber\(/g)];
    expect(calls).toHaveLength(2);
    // And neither half went back to querying numbers for itself.
    expect(source).not.toContain('.from("phone_numbers")');
  });
});
