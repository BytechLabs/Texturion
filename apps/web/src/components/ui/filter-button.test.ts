/**
 * #733 — one filter row.
 *
 * A list's Filter button (with its active count) and its saved Views menu are
 * `FilterButton` and `SavedViewsMenu`. This scan fails when a file outside
 * those two draws either by hand: it imports the funnel or bookmark icon the
 * pair is built on, or it uses the label keys only they carry (the Filter
 * button's "N on" name, the Views menu's aria name, "Save these filters" and
 * "Manage views"). A named exception that stops matching fails too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

const SHARED = new Set([
  "components/ui/filter-button.tsx",
  "components/saved-views/saved-views-menu.tsx",
]);

/** A file that may keep drawing it, and why. */
const EXCEPTIONS: Record<string, string> = {};

const ICON_IMPORT =
  /import\s*\{[^}]*\b(?:ListFilter|ListFilterPlus|Filter|Bookmark|Bookmarks)\b[^}]*\}\s*from\s*["']lucide-react["']/;
const OWN_KEYS =
  /["'`]inbox\.(?:filterActionCount|viewsMenuAria|viewsSaveCurrent|viewsManage)["'`]/;

/** Does this source draw the filter button or the views menu itself? */
export function drawsFilterRowByHand(text: string): boolean {
  return ICON_IMPORT.test(text) || OWN_KEYS.test(text);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(marketing") || entry.name === "marketing") {
        continue;
      }
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

const drawing = files
  .filter(({ path }) => !SHARED.has(path))
  .filter(({ text }) => drawsFilterRowByHand(text))
  .map(({ path }) => path);

describe("#733 one filter row", () => {
  it("recognises a hand-built filter trigger and views menu", () => {
    expect(
      drawsFilterRowByHand(`import { ListFilter } from "lucide-react";`),
    ).toBe(true);
    expect(
      drawsFilterRowByHand(`import { Check, Bookmark } from "lucide-react";`),
    ).toBe(true);
    expect(drawsFilterRowByHand(`aria-label={t("inbox.viewsMenuAria")}`)).toBe(
      true,
    );
    expect(
      drawsFilterRowByHand(`t("inbox.filterActionCount", { count })`),
    ).toBe(true);
    expect(
      drawsFilterRowByHand(`import { Check, Star } from "lucide-react";`),
    ).toBe(false);
    expect(drawsFilterRowByHand(`<FilterButton count={2} />`)).toBe(false);
  });

  it("no file draws one by hand", () => {
    const offenders = drawing.filter((path) => !(path in EXCEPTIONS));
    expect(
      offenders,
      "use <FilterButton> and <SavedViewsMenu> instead",
    ).toEqual([]);
  });

  it("every exception still matches and gives a reason", () => {
    const stale = Object.keys(EXCEPTIONS).filter((p) => !drawing.includes(p));
    expect(stale).toEqual([]);
    expect(
      Object.entries(EXCEPTIONS)
        .filter(([, reason]) => reason.trim().length < 15)
        .map(([path]) => path),
    ).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    for (const path of SHARED) {
      expect(files.some((f) => f.path === path), path).toBe(true);
    }
    const buttons = files.filter(({ text }) => text.includes("<FilterButton"));
    const menus = files.filter(({ text }) => text.includes("<SavedViewsMenu"));
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(menus.length).toBeGreaterThanOrEqual(2);
  });
});
