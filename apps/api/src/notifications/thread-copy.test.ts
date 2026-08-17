/**
 * #228 — the thread alerts, in both languages, pinned.
 *
 * Two things are asserted and they pull in opposite directions.
 *
 * The ENGLISH is asserted character for character because people read it
 * today: a lock screen is the one surface where a reworded sentence reaches
 * somebody before any release note does, and `inbound.ts`'s snippet fallbacks
 * are additionally the words the mobile toasts render.
 *
 * The FRENCH is asserted only to be DIFFERENT, key by key. A translation table
 * fails silently — a forgotten entry copied across from the English half still
 * type-checks, still renders, and reaches a francophone crew looking exactly
 * like a decision somebody made. Every one of these strings differs between
 * the two languages, so "differs" is a check rather than a hope.
 *
 * `mention.ts` has no suite of its own, so its three strings are only ever
 * covered here.
 */
import type { Locale } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { THREAD_PUSH_COPY } from "./thread-copy";

/** Somebody else's words, in every slot that takes one. */
const CONTACT = "Dana Reyes";
const ACTOR = "Sam Ortiz";

/** Every string in the table, rendered with the same sample arguments. */
function rendered(locale: Locale): Record<string, string> {
  const copy = THREAD_PUSH_COPY[locale];
  return {
    emergencyTitle: copy.emergencyTitle(CONTACT),
    snippetAttachment: copy.snippetAttachment,
    snippetMessage: copy.snippetMessage,
    inboundWithheldBody: copy.inboundWithheldBody,
    mentionTitle: copy.mentionTitle(ACTOR),
    teammateFallback: copy.teammateFallback,
    mentionWithheldBody: copy.mentionWithheldBody,
    assignBulkTitleOne: copy.assignBulkTitle(ACTOR, 1),
    assignBulkTitleMany: copy.assignBulkTitle(ACTOR, 14),
    assignBulkBody: copy.assignBulkBody,
    assignTaskTitle: copy.assignTaskTitle(ACTOR),
    taskTitleFallback: copy.taskTitleFallback,
    assignWithheldBody: copy.assignWithheldBody,
    assignConversationTitle: copy.assignConversationTitle(ACTOR),
  };
}

describe("the English a crew reads today", () => {
  it("is unchanged, word for word", () => {
    expect(rendered("en")).toEqual({
      emergencyTitle: "EMERGENCY — Dana Reyes",
      snippetAttachment: "Sent an attachment",
      snippetMessage: "Sent a message",
      inboundWithheldBody: "Sent you a message",
      mentionTitle: "Sam Ortiz mentioned you",
      teammateFallback: "A teammate",
      mentionWithheldBody: "Mentioned you in a note",
      assignBulkTitleOne: "Sam Ortiz assigned you 1 conversation",
      assignBulkTitleMany: "Sam Ortiz assigned you 14 conversations",
      assignBulkBody: "Open your inbox to see them",
      assignTaskTitle: "Sam Ortiz assigned you a task",
      taskTitleFallback: "A task",
      assignWithheldBody: "Open the app to see it",
      assignConversationTitle: "Sam Ortiz assigned you a conversation",
    });
  });
});

describe("the French half", () => {
  it("actually says something else, in all 14 renderings", () => {
    const en = rendered("en");
    const fr = rendered("fr-CA");
    const keys = Object.keys(en);
    // The sample size, stated: an empty table would otherwise walk this loop
    // and report clean.
    expect(keys).toHaveLength(14);
    for (const key of keys) {
      expect(fr[key], `${key} was never translated`).not.toBe(en[key]);
      expect(fr[key]?.trim(), `${key} is empty in French`).toBeTruthy();
    }
  });

  it("leaves somebody else's name alone", () => {
    // A contact's name and a teammate's display name are not copy. The only
    // slot in this table that holds OUR words is the stand-in for a profile
    // that is gone, and it is the one that changes.
    const fr = rendered("fr-CA");
    expect(fr.emergencyTitle).toContain(CONTACT);
    expect(fr.mentionTitle).toContain(ACTOR);
    expect(fr.assignConversationTitle).toContain(ACTOR);
    expect(THREAD_PUSH_COPY["fr-CA"].teammateFallback).toBe("Un coéquipier");
  });

  it("keeps the emergency prefix no longer than the English one", () => {
    // #414 puts WHAT before WHO because a lock screen shows one line. A longer
    // prefix would eat the contact's name in the language it was translated
    // for, which is the one reader who cannot fall back to the English.
    const en = THREAD_PUSH_COPY.en.emergencyTitle("");
    const fr = THREAD_PUSH_COPY["fr-CA"].emergencyTitle("");
    expect(fr.length).toBeLessThanOrEqual(en.length);
  });
});
