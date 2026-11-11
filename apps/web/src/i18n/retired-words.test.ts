import { describe, expect, it } from "vitest";

import { EN } from "./catalog";

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

function entries(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [section, keys] of Object.entries(EN)) {
    for (const [key, value] of Object.entries(keys as Record<string, unknown>)) {
      if (typeof value === "string") out.push([`${section}.${key}`, value]);
    }
  }
  return out;
}

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
