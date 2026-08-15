/**
 * #321 — the changelog's credibility is the only thing it has.
 *
 * "A roadmap presented as news is how a changelog loses its credibility, and
 * once lost it does not come back." That rule is unenforceable in general — a
 * machine cannot know whether a sentence is true — but the shapes it takes when
 * broken are recognisable, and those are pinned here.
 *
 * The other half is the marker. A badge that is always lit is a badge nobody
 * reads, so the cases that would light it wrongly matter more than the ones
 * that light it correctly.
 */
import { describe, expect, it } from "vitest";

import {
  WHATS_NEW,
  hasUnseenWhatsNew,
  latestWhatsNewDate,
  unseenEntries,
  type WhatsNewEntry,
} from "./whats-new";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

const entries: WhatsNewEntry[] = [
  { date: "2026-07-01", title: "Older", body: "b", href: null },
  { date: "2026-08-01", title: "Newer", body: "b", href: "/inbox" },
];

describe("#321 the entries report what shipped", () => {
  it("is ordered newest first, which is what the page renders", () => {
    const dates = WHATS_NEW.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("never announces something that has not happened", () => {
    // The rule, in the shapes it takes when broken. A changelog that says
    // "coming soon" is a roadmap, and a customer who reads one and waits has
    // been told a thing that is not news.
    for (const entry of WHATS_NEW) {
      const text = `${entry.title} ${entry.body}`.toLowerCase();
      expect(text, entry.title).not.toMatch(/coming soon|we will|we'll be|soon you/);
      expect(text, entry.title).not.toMatch(/\broadmap\b|\bplanned\b|\bin beta\b/);
    }
  });

  it("carries no future dates", () => {
    // Dating an entry ahead is the other way a roadmap gets in.
    const today = new Date().toISOString().slice(0, 10);
    for (const entry of WHATS_NEW) {
      expect(entry.date <= today, `${entry.title} is dated ${entry.date}`).toBe(true);
    }
  });

  it("stays short enough to read", () => {
    // #321: "a periodic digest of what actually changed for a user is the right
    // grain". A page nobody scrolls has one useful entry, at the top.
    expect(WHATS_NEW.length).toBeLessThanOrEqual(12);
    for (const entry of WHATS_NEW) {
      expect(entry.title.length, entry.title).toBeLessThanOrEqual(60);
      expect(entry.body.length, entry.title).toBeLessThanOrEqual(220);
    }
  });

  it("renders no em or en dash (Law 6)", () => {
    for (const entry of WHATS_NEW) {
      expect(`${entry.title} ${entry.body}`).not.toMatch(/[–—]/);
    }
  });

  it("points at the product where there is somewhere to point", () => {
    // "The value is in taking someone to the thing on the screen where it now
    // exists." Null is allowed and meaningful: a fix that makes everything a
    // little better has nowhere to send anybody.
    const linked = WHATS_NEW.filter((e) => e.href !== null);
    expect(linked.length).toBeGreaterThan(WHATS_NEW.length / 2);
    for (const entry of linked) {
      expect(entry.href, entry.title).toMatch(/^\//);
    }
  });
});

describe("#321 the marker", () => {
  it("lights when something shipped since the member last looked", () => {
    expect(hasUnseenWhatsNew("2026-07-15", "2026-01-01", entries)).toBe(true);
  });

  it("goes dark once they have looked", () => {
    expect(hasUnseenWhatsNew("2026-08-01", "2026-01-01", entries)).toBe(false);
  });

  it("does NOT light up for somebody who just arrived", () => {
    // The case that would make the marker useless. A workspace that signed up
    // today has no memory of missing anything, and a badge advertising six
    // months of changes is a badge they learn to ignore on day one.
    expect(hasUnseenWhatsNew(null, "2026-08-02", entries)).toBe(false);
  });

  it("does light for somebody who joined before the newest change", () => {
    expect(hasUnseenWhatsNew(null, "2026-07-15", entries)).toBe(true);
  });

  it("says nothing when nothing is known about the member", () => {
    // A wrong badge costs trust in every later one, so an unknown member gets
    // silence rather than a guess.
    expect(hasUnseenWhatsNew(null, null, entries)).toBe(false);
  });

  it("tolerates a full timestamp where a date is expected", () => {
    // The clients store an ISO instant; the entries carry a date.
    expect(
      hasUnseenWhatsNew("2026-07-15T09:30:00.000Z", null, entries),
    ).toBe(true);
    expect(
      hasUnseenWhatsNew("2026-08-01T09:30:00.000Z", null, entries),
    ).toBe(false);
  });

  it("reports which entries are new, for the list to mark", () => {
    expect(unseenEntries("2026-07-15", null, entries).map((e) => e.title)).toEqual([
      "Newer",
    ]);
  });

  it("finds the newest date regardless of order", () => {
    expect(latestWhatsNewDate(entries)).toBe("2026-08-01");
    expect(latestWhatsNewDate([])).toBe("");
  });
});

/*
 * #228 — every entry's words exist, in both languages.
 *
 * A changelog is the surface where a half-translated app is most obvious: the
 * reader is scrolling a list of sentences and nothing else is on screen to
 * distract from one of them being in the wrong language.
 */
describe("#228 the changelog reads in both languages", () => {
  const lookUp = (table: unknown, key: string, lang: string): string => {
    const [section, name] = key.split(".");
    const value = (table as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
    return value;
  };
  const say = (key: string) => lookUp(WEB_EN, key, "English");
  const sayFr = (key: string) => lookUp(WEB_FR, key, "French");

  it("resolves every title and body", () => {
    for (const entry of WHATS_NEW) {
      for (const key of [entry.title, entry.body]) {
        expect(say(key).length, key).toBeGreaterThan(0);
        expect(sayFr(key).length, key).toBeGreaterThan(0);
        expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
      }
    }
    expect(WHATS_NEW.length).toBeGreaterThan(2);
  });

  it("gives every entry its own title", () => {
    // Two entries sharing a title would satisfy every assertion above while
    // making the list unreadable — and the marker keys on the newest entry, so
    // a duplicate is also a badge that lights for the wrong change.
    const titles = WHATS_NEW.map((entry) => say(entry.title));
    expect(new Set(titles).size).toBe(WHATS_NEW.length);
  });
});
