// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX } from "@loonext/shared";

import { settingsSectionOf } from "@/components/settings/settings-nav";

/**
 * #719: the settings search index and the settings pages must agree.
 *
 * Reads the source of every settings page and settings component. A setting is
 * a `<SettingsCard>`; the index names each by the `id` on its card, which is
 * what the search scrolls to. This fails when
 *   - an index entry points at an id no settings file has,
 *   - two entries share an anchor,
 *   - a titled card has no id, or has an id the index does not list.
 */

const SRC = path.resolve(__dirname, "../..");
const ROOTS = [
  path.join(SRC, "app", "(app)", "settings"),
  path.join(SRC, "components", "settings"),
];

/**
 * Pages whose cards are content, not settings: the changelog entries and the
 * trash rows come from data, so there is nothing fixed to point at. Each is
 * reached by its section's own entry instead.
 */
const CONTENT_FILES = new Set([
  "app/(app)/settings/whats-new/page.tsx",
  "components/settings/trash-list.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

/** The text of a JSX opening tag, from just after the tag name to its `>`. */
function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === ">" && depth === 0) {
      return source.slice(from, i);
    }
  }
  return source.slice(from);
}

interface Card {
  file: string;
  id: string | null;
  titled: boolean;
}

function scan() {
  const cards: Card[] = [];
  const ids = new Set<string>();
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) ids.add(match[1]!);
    for (const match of source.matchAll(/<SettingsCard(?=[\s>])/g)) {
      const tag = openingTag(source, match.index! + match[0].length);
      cards.push({
        file: rel,
        id: tag.match(/\bid="([^"]+)"/)?.[1] ?? null,
        titled: /\btitle=/.test(tag),
      });
    }
  }
  return { cards, ids };
}

const { cards, ids } = scan();
const settingCards = cards.filter((card) => !CONTENT_FILES.has(card.file) && card.titled);
const indexed = new Set(SETTINGS_INDEX.map((entry) => entry.anchor));

describe(`#719 settings index against the pages (${cards.length} cards found, ${settingCards.length} settings checked, ${SETTINGS_INDEX.length} entries)`, () => {
  it("SI-0: the scan found the cards", () => {
    expect(cards.length, "no SettingsCard found: the scan is broken").toBeGreaterThan(0);
    expect(settingCards.length).toBeGreaterThan(0);
  });

  it("SI-1: every index entry's anchor is an id on a settings page or component", () => {
    const missing = SETTINGS_INDEX.filter((entry) => !ids.has(entry.anchor)).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it("SI-2: no anchor is used by two entries", () => {
    const seen = new Set<string>();
    const duplicated: string[] = [];
    for (const entry of SETTINGS_INDEX) {
      if (seen.has(entry.anchor)) duplicated.push(entry.anchor);
      seen.add(entry.anchor);
    }
    expect(duplicated).toEqual([]);
  });

  it("SI-3: every setting card has an id, and the index lists it", () => {
    const noId = settingCards.filter((card) => !card.id).map((card) => card.file);
    expect(noId, "a titled SettingsCard without an id").toEqual([]);
    const unlisted = [...new Set(settingCards.map((card) => card.id!))].filter(
      (id) => !indexed.has(id),
    );
    expect(unlisted, "a card id the settings search does not know").toEqual([]);
  });

  it("SI-4: every entry opens a real page of its section", () => {
    for (const entry of SETTINGS_INDEX) {
      const section = settingsSectionOf(entry.section, entry.page);
      expect(section, entry.id).toBeDefined();
      expect(section?.id, entry.id).toBe(entry.section);
      if (entry.page) expect(section?.slug, entry.id).toBe(entry.page);
    }
  });
});
