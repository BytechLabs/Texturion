import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { nextOptionIndex } from "./segmented-control";

describe("nextOptionIndex (#11, #733 keyboard)", () => {
  const COUNT = 4; // open · mine · all · closed

  it("moves forward with ArrowRight/ArrowDown and wraps at the end", () => {
    expect(nextOptionIndex("ArrowRight", 0, COUNT)).toBe(1);
    expect(nextOptionIndex("ArrowDown", 1, COUNT)).toBe(2);
    expect(nextOptionIndex("ArrowRight", 3, COUNT)).toBe(0);
  });

  it("moves back with ArrowLeft/ArrowUp and wraps at the start", () => {
    expect(nextOptionIndex("ArrowLeft", 2, COUNT)).toBe(1);
    expect(nextOptionIndex("ArrowUp", 1, COUNT)).toBe(0);
    expect(nextOptionIndex("ArrowLeft", 0, COUNT)).toBe(3);
  });

  it("jumps to the ends with Home/End", () => {
    expect(nextOptionIndex("Home", 2, COUNT)).toBe(0);
    expect(nextOptionIndex("End", 1, COUNT)).toBe(COUNT - 1);
  });

  it("returns the same index for any other key (a no-op the caller ignores)", () => {
    expect(nextOptionIndex("Enter", 2, COUNT)).toBe(2);
    expect(nextOptionIndex("a", 0, COUNT)).toBe(0);
    expect(nextOptionIndex("Tab", 3, COUNT)).toBe(3);
  });
});


/**
 * #733 — one segmented control.
 *
 * A pill track, or a `radiogroup` / `tablist` row of buttons, used to be drawn
 * by hand in every file with its own arrow-key code. This scan fails when a
 * file builds one outside `segmented-control.tsx`. A radio-card list (a stack
 * of described choices, not a short row of words) is a different pattern and
 * is named below, and so is the shared `ChoiceCards`; a name that stops
 * matching anything fails too.
 */
const RADIO_CARD_LISTS: Record<string, string> = {
  "app/onboarding/plan/page.tsx": "radio cards: the plan choice",
  "components/thread/thread-filter-bar.tsx":
    "multi-select toggles (aria-pressed): several categories can be on at once, not one choice",
};

/** The one place a stack of described radio cards is drawn (#746). */
const CHOICE_CARDS = "components/ui/choice-cards.tsx";

const HAND_ROLLED =
  /role="(?:radiogroup|tablist)"|rounded-full bg-app-line-soft p-\[3px\]|bg-(?:muted|app-line-soft) p-0\.5/;

/** Does this source draw a segmented track or a radiogroup/tablist by hand? */
export function drawsSegmentsByHand(text: string): boolean {
  return HAND_ROLLED.test(text);
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

const SRC = join(__dirname, "..", "..");
const files = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("#733 one SegmentedControl", () => {
  it("recognises a hand-rolled track and a radiogroup of buttons", () => {
    expect(
      drawsSegmentsByHand(
        `<div className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px]">`,
      ),
    ).toBe(true);
    expect(drawsSegmentsByHand(`<div role="tablist" aria-label="x">`)).toBe(true);
    expect(drawsSegmentsByHand(`<div role="radiogroup">`)).toBe(true);
    expect(
      drawsSegmentsByHand(`<div className="flex rounded-lg bg-muted p-0.5">`),
    ).toBe(true);
    expect(drawsSegmentsByHand(`<SegmentedControl value="a" />`)).toBe(false);
  });

  it("no file draws one by hand", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/segmented-control.tsx")
      .filter(({ path }) => path !== CHOICE_CARDS)
      .filter(({ path }) => !(path in RADIO_CARD_LISTS))
      .filter(({ text }) => drawsSegmentsByHand(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <SegmentedControl> from components/ui/segmented-control instead",
    ).toEqual([]);
  });

  it("every named radio-card exception still has a radiogroup", () => {
    const stale = Object.keys(RADIO_CARD_LISTS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !drawsSegmentsByHand(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<SegmentedControl"));
    expect(users.length).toBeGreaterThanOrEqual(8);
  });
});
