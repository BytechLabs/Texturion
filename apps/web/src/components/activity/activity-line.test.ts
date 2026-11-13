/**
 * #725: the steps on a call's own timeline read as sentences, in both
 * languages, and no step kind falls through to the generic "Changed".
 */
import { CALL_STEP_KINDS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";
import type { ActivityItem } from "@/lib/api/record-activity";

import { activityLine } from "./activity-line";

const t = makeTranslate("en");
const tFr = makeTranslate("fr-CA");
const NAMES: Record<string, string> = { u1: "Sam Ortiz", u2: "Ana Lee" };

const step = (kind: string, payload: Record<string, unknown> = {}): ActivityItem => ({
  id: `id-${kind}`,
  kind,
  category: "call",
  occurred_at: "2026-11-10T15:00:00.000Z",
  actor: { type: "system", user_id: null, display_name: null },
  payload,
  source: { type: "call", id: "call-1", conversation_id: null },
});

const say = (item: ActivityItem, translate = t) =>
  activityLine(item, {
    t: translate,
    recordType: "call",
    recordId: "call-1",
    nameOf: (id) => (id ? (NAMES[id] ?? null) : null),
  }).text;

describe("#725 call steps", () => {
  it("every step kind has its own sentence, in both languages", () => {
    for (const kind of CALL_STEP_KINDS) {
      expect(say(step(kind)), kind).not.toBe(t("activity.unknownKind"));
      expect(say(step(kind), tFr), kind).not.toBe(tFr("activity.unknownKind"));
    }
  });

  it("names whose phones rang, and who asked to be rung", () => {
    expect(say(step("call_rang", { user_ids: ["u1", "u2"] }))).toBe("Rang Sam Ortiz, Ana Lee");
    expect(say(step("call_rang", { user_ids: ["u2"], asked: true }))).toBe(
      "Ana Lee asked to be rung",
    );
  });

  it("says why it came in the way it did, and why it went to voicemail", () => {
    expect(say(step("call_arrived", { routing: "rang" }))).toBe("Call came in");
    expect(say(step("call_arrived", { routing: "after_hours" }))).toBe(
      `Call came in · ${t("misc.callRoutingAfterHours")}`,
    );
    expect(say(step("call_voicemail", { cause: "no_answer_in_time" }))).toBe(
      `Went to voicemail · ${t("misc.callEndedNoAnswerInTime")}`,
    );
    expect(say(step("call_voicemail", { cause: "after_hours" }))).toBe(
      `Went to voicemail · ${t("misc.callRoutingAfterHours")}`,
    );
    expect(say(step("call_voicemail", { cause: null }))).toBe("Went to voicemail");
  });

  it("says how long the call lasted and why it ended", () => {
    expect(say(step("call_ended", { reason: "caller_hung_up", seconds: 12 }))).toBe(
      `Call ended · after 12s · ${t("misc.callEndedCallerHungUp")}`,
    );
    expect(say(step("call_ended", { reason: "answered", seconds: 0 }))).toBe("Call ended");
  });
});

describe("#725 an automated text on the timeline", () => {
  const text = (payload: Record<string, unknown>): ActivityItem => ({
    ...step("text_out", payload),
    category: "message",
  });
  it("says it was sent automatically, and by which automation", () => {
    expect(say(text({ automated: true, automation: "missed_call_text" }))).toBe(
      "Text sent automatically · Missed-call text",
    );
    expect(say(text({ automated: true, automation: null }))).toBe("Text sent automatically");
    expect(say(text({ automated: false }))).toBe("Text sent");
  });
});
