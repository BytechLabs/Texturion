import { describe, expect, it } from "vitest";

import { EN, FR_CA } from "./catalog";

/**
 * One word per thing. A task's labels and a conversation's tags are the same
 * list (`task_tags` takes its values from the workspace's tag vocabulary), so
 * English says "tag" everywhere. This reads every English value and fails when
 * "label" or "labels" appears, unless the key is named below with the reason
 * its word means something else.
 *
 * The roster is closed: an entry whose value no longer says "label" FAILS, so
 * it cannot outlive the copy it excuses.
 */
const LABEL_WORD = /\blabels?\b/i;

/** `section.key` to why "label" is the right word there. */
const OTHER_MEANINGS: Record<string, string> = {
  "appShell.screeningOffDetail": "a caller-ID flag on a suspicious call, not a tag",
  "appShell.screeningFlagLabel": "call screening flags a call with a caller-ID label",
  "contacts.fieldLabel": "the name of a custom field's label",
  "contacts.vcardParameterNote": "a vCard line carries a label parameter (TEL;TYPE), a file-format term",
};

/** Placeholders such as `{label}` name a variable, not a word the reader sees. */
function readable(value: string): string {
  return value.replace(/\{[A-Za-z0-9_]+\}/g, "");
}

function entries(catalog: object = EN): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [section, keys] of Object.entries(catalog)) {
    for (const [key, value] of Object.entries(keys as Record<string, unknown>)) {
      if (typeof value === "string") out.push([`${section}.${key}`, value]);
    }
  }
  return out;
}

/**
 * "Thread" is retired for "conversation" (the same record the menus call a
 * conversation), and "line" meaning a phone line is retired for "number".
 * "Line" keeps its other meanings (a line of text, "Line of work", `{line}`), so
 * the bare word is NOT banned: the phone-line check matches the phrases a phone
 * line turns up in. Same closed roster as the label check above.
 */
const THREAD_WORD = /\bthreads?\b/i;
const PHONE_LINE =
  /\b(?:(?:this|that|each|every)\s+line\b|(?:business|phone|shop|office|field|shared)\s+lines?\b|(?:this|that|a|the)\s+line's|the\s+line\s+(?:you|they)\b|line\s+(?:busy|paused|ready)\b|on\s+the\s+line\b)/i;

/** `section.key` to why "thread" is the right word there. */
const THREAD_OTHER_MEANINGS: Record<string, string> = {};

/** `section.key` to why "line" is not a phone line there. */
const LINE_OTHER_MEANINGS: Record<string, string> = {
  "appShell.aiCatchupBoundary": "every line of a catch-up is a line of text quoting a message",
};

describe("English says conversation, not thread", () => {
  const all = entries();

  it("no value calls a conversation a thread", () => {
    const offenders = all
      .filter(([key, value]) => THREAD_WORD.test(readable(value)) && !(key in THREAD_OTHER_MEANINGS))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it("every named exception still says thread", () => {
    const byKey = new Map(all);
    const stale = Object.keys(THREAD_OTHER_MEANINGS).filter((key) => {
      const value = byKey.get(key);
      return value === undefined || !THREAD_WORD.test(readable(value));
    });
    expect(stale).toEqual([]);
  });
});

describe("English says number, not line, for a phone line", () => {
  const all = entries();

  it("no value calls a phone number a line", () => {
    const offenders = all
      .filter(([key, value]) => PHONE_LINE.test(readable(value)) && !(key in LINE_OTHER_MEANINGS))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it("every named exception still matches", () => {
    const byKey = new Map(all);
    const stale = Object.keys(LINE_OTHER_MEANINGS).filter((key) => {
      const value = byKey.get(key);
      return value === undefined || !PHONE_LINE.test(readable(value));
    });
    expect(stale).toEqual([]);
  });
});

describe("English says tag, not label", () => {
  const all = entries();

  it("reads a real catalogue", () => {
    expect(all.length).toBeGreaterThan(1000);
  });

  it("no value calls a tag a label", () => {
    const offenders = all
      .filter(([key, value]) => LABEL_WORD.test(readable(value)) && !(key in OTHER_MEANINGS))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it("every named exception still says label", () => {
    const byKey = new Map(all);
    const stale = Object.keys(OTHER_MEANINGS).filter((key) => {
      const value = byKey.get(key);
      return value === undefined || !LABEL_WORD.test(readable(value));
    });
    expect(stale).toEqual([]);
  });
});

// #755: the record of every change is the audit log. "History" was its nav name
// and "Activity log" its search name; Activity is the timeline on a record (#714).
const AUDIT_LOG_OLD_NAMES = /^\s*history\s*$|\bactivity log\b/i;

describe("English calls the audit log the audit log", () => {
  it("no value names it History or Activity log", () => {
    const offenders = entries()
      .filter(([, value]) => AUDIT_LOG_OLD_NAMES.test(readable(value)))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});

// French names it "Journal d'audit"; "Historique" alone was the nav name.
const AUDIT_LOG_OLD_NAMES_FR = /^\s*historique\s*$|\bjournal d['’]activité\b/i;

describe("French calls the audit log the journal d'audit", () => {
  it("no value names it Historique or Journal d'activité", () => {
    const all = entries(FR_CA);
    expect(all.length, "the French catalogue is empty").toBeGreaterThan(0);
    const offenders = all
      .filter(([, value]) => AUDIT_LOG_OLD_NAMES_FR.test(readable(value)))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
