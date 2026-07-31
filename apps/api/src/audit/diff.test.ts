/**
 * #461: "Audits show change of entire sections even if a single field is
 * modified." These pin the two properties that fixes it — only the moved keys,
 * and both sides — plus the invariant that must survive it: customer-facing
 * text never reaches the log.
 */
import { describe, expect, it } from "vitest";

import { auditDiff, redactText } from "./diff";

describe("auditDiff", () => {
  it("records only the field that moved, not the whole section", () => {
    const before = {
      enrich_task_address: true,
      enrich_task_due: true,
      suggest_replies: true,
      transcribe_voicemail: true,
      voicemail_intake: false,
    };
    const after = { ...before, suggest_replies: false };
    expect(auditDiff(before, after)).toEqual({
      before: { suggest_replies: true },
      after: { suggest_replies: false },
    });
  });

  it("carries BOTH sides — the log used to say what it became, never what it was", () => {
    const delta = auditDiff({ mctb_enabled: false }, { mctb_enabled: true });
    expect(delta).toEqual({
      before: { mctb_enabled: false },
      after: { mctb_enabled: true },
    });
  });

  it("returns null when a save changed nothing", () => {
    // A client that reads settings and posts them back unchanged is doing the
    // obvious thing; it must not produce an audit row. A log full of
    // non-events teaches people to skim it.
    expect(auditDiff({ a: 1, b: "x" }, { a: 1, b: "x" })).toBeNull();
  });

  it("ignores keys the caller did not touch", () => {
    // Settings PATCHes are partial: a key absent from `after` was not sent,
    // and reading that as "removed" would log a change nobody made.
    expect(auditDiff({ a: 1, b: 2 }, { a: 1 })).toBeNull();
  });

  it("treats null and undefined as the same absence", () => {
    expect(auditDiff({ a: null }, { a: undefined })).toBeNull();
    expect(auditDiff({}, { a: null })).toBeNull();
  });

  it("sees through object and array values", () => {
    expect(auditDiff({ a: { x: 1 } }, { a: { x: 1 } })).toBeNull();
    expect(auditDiff({ a: [1, 2] }, { a: [1, 3] })).not.toBeNull();
  });

  it("never lets authored text into the log, but does record that it changed", () => {
    const delta = auditDiff(
      { away_message: "We're closed until Monday." },
      { away_message: "Back Tuesday, sorry!" },
      { textKeys: ["away_message"] },
    );
    expect(delta).toEqual({
      before: { away_message: "edited" },
      after: { away_message: "edited" },
    });
    // The words themselves are the thing that must never be here.
    const serialized = JSON.stringify(delta);
    expect(serialized).not.toContain("Monday");
    expect(serialized).not.toContain("Tuesday");
  });

  it("distinguishes set, cleared and edited", () => {
    expect(redactText(null, "hi")).toEqual({ before: "cleared", after: "set" });
    expect(redactText("hi", null)).toEqual({ before: "set", after: "cleared" });
    expect(redactText("hi", "yo")).toEqual({
      before: "edited",
      after: "edited",
    });
    // Whitespace is not content: "   " is as absent as null.
    expect(redactText("   ", "hi")).toEqual({
      before: "cleared",
      after: "set",
    });
  });

  it("scopes to `only` when the caller holds a wider row", () => {
    const delta = auditDiff(
      { a: 1, secret: "x" },
      { a: 2, secret: "y" },
      { only: ["a"] },
    );
    expect(delta).toEqual({ before: { a: 1 }, after: { a: 2 } });
    expect(JSON.stringify(delta)).not.toContain("secret");
  });

  it("reports a first-time value as a change from null", () => {
    // A workspace that never wrote a setting has no prior row; the diff must
    // still say the field moved, with an honest empty before.
    expect(auditDiff({}, { voicemail_intake: true })).toEqual({
      before: { voicemail_intake: null },
      after: { voicemail_intake: true },
    });
  });
});
