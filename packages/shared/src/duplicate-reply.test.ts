/**
 * #408 — warning before two techs answer the same customer.
 *
 * The assertions that matter most are the ones about NOT warning. A
 * confirmation that fires when it should not is worse than none: the first
 * false one teaches people to dismiss it, and then the true one — the send
 * that lands on top of a colleague's answer — gets dismissed too.
 */
import { describe, expect, it } from "vitest";

import { duplicateReplyPrompt, duplicateReplyWarning } from "./duplicate-reply";

const ME = "user-me";
const SAM = "user-sam";

const at = (iso: string) => iso;

describe("duplicateReplyWarning", () => {
  it("warns when a teammate replied while the draft was being written", () => {
    // The case the issue is about: both techs opened the same new lead.
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-29T10:00:00.000Z"),
        lastOutboundAt: at("2026-07-29T10:00:40.000Z"),
        lastOutboundByUserId: SAM,
        meUserId: ME,
      }),
    ).toEqual({ warn: true, byUserId: SAM });
  });

  it("does not warn about a reply that predates the draft", () => {
    // Context the sender already had when they started typing.
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-29T10:00:00.000Z"),
        lastOutboundAt: at("2026-07-29T09:58:00.000Z"),
        lastOutboundByUserId: SAM,
        meUserId: ME,
      }).warn,
    ).toBe(false);
  });

  it("does not warn about your OWN previous send", () => {
    // Sending twice in a row is deliberate and ordinary — a correction, an
    // address, a second thought. Warning here would fire on the most common
    // action there is and destroy the signal.
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-29T10:00:00.000Z"),
        lastOutboundAt: at("2026-07-29T10:00:40.000Z"),
        lastOutboundByUserId: ME,
        meUserId: ME,
      }).warn,
    ).toBe(false);
  });

  it("warns about an AUTOMATIC send, with no name to give", () => {
    // An away reply or missed-call text-back went out. The customer has still
    // just received something, so the sender should know before adding to it.
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-29T10:00:00.000Z"),
        lastOutboundAt: at("2026-07-29T10:00:05.000Z"),
        lastOutboundByUserId: null,
        meUserId: ME,
      }),
    ).toEqual({ warn: true, byUserId: null });
  });

  it("stays silent when the draft's start is unknown", () => {
    // A draft restored from storage after a reload. We cannot say whether the
    // reply came before or after it was written, and a warning we cannot
    // justify is worse than none.
    expect(
      duplicateReplyWarning({
        draftStartedAt: null,
        lastOutboundAt: at("2026-07-29T10:00:40.000Z"),
        lastOutboundByUserId: SAM,
        meUserId: ME,
      }).warn,
    ).toBe(false);
  });

  it("stays silent in a thread nobody has replied in", () => {
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-29T10:00:00.000Z"),
        lastOutboundAt: null,
        lastOutboundByUserId: null,
        meUserId: ME,
      }).warn,
    ).toBe(false);
  });

  it("stays silent on a timestamp it cannot read", () => {
    // Never stand between a tech and a waiting customer on the strength of a
    // date that failed to parse.
    expect(
      duplicateReplyWarning({
        draftStartedAt: "not a date",
        lastOutboundAt: at("2026-07-29T10:00:40.000Z"),
        lastOutboundByUserId: SAM,
        meUserId: ME,
      }).warn,
    ).toBe(false);
  });

  it("warns on a draft left overnight and sent in the morning", () => {
    // A recency window would miss this, and it is the case where the sender is
    // LEAST likely to have seen the reply.
    expect(
      duplicateReplyWarning({
        draftStartedAt: at("2026-07-28T18:00:00.000Z"),
        lastOutboundAt: at("2026-07-29T08:00:00.000Z"),
        lastOutboundByUserId: SAM,
        meUserId: ME,
      }).warn,
    ).toBe(true);
  });
});

describe("duplicateReplyPrompt", () => {
  it("names the person, because that is a fact somebody can act on", () => {
    expect(duplicateReplyPrompt("Sam", 40)).toBe("Sam replied just now.");
    expect(duplicateReplyPrompt("Sam", 120)).toBe("Sam replied 2 minutes ago.");
    expect(duplicateReplyPrompt("Sam", 60)).toBe("Sam replied 1 minute ago.");
    expect(duplicateReplyPrompt("Sam", 7200)).toBe("Sam replied 2 hours ago.");
  });

  it("does not borrow a name it does not have", () => {
    expect(duplicateReplyPrompt(null, 5)).toBe("An automatic reply went out just now.");
    expect(duplicateReplyPrompt("  ", 5)).toBe("An automatic reply went out just now.");
  });

  it("stops counting past a day rather than saying '31 hours ago'", () => {
    expect(duplicateReplyPrompt("Sam", 200_000)).toBe(
      "Sam replied since you started writing.",
    );
  });
});
