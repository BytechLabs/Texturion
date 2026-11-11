import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { join, relative, sep } from "node:path";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

import { ChoiceCards } from "./choice-cards";

/**
 * #746: one described choice.
 *
 * A stack of radio cards for a few options that each have a consequence
 * (who rings, what happens after hours, who may use a number) used to be drawn
 * by hand in each card, each with its own copy of the arrow-key code. This scan
 * fails when a file draws a radio by hand outside `ChoiceCards` and
 * `SegmentedControl`. The files below still do, each for a reason, and a name
 * that stops matching anything fails too.
 */
const OPEN_EXCEPTIONS: Record<string, string> = {
  "app/onboarding/plan/page.tsx": "radio cards with a price and a feature list: the plan choice",
  "components/contacts/duplicate-contacts-card.tsx":
    "which record survives a merge: a radio per row of a table, not a stack of options",
  "components/numbers/number-picker.tsx":
    "rows of live numbers and area codes: results to pick from, not options with consequences",
};

const BUILT_BY_HAND =
  /role="radio"|type="radio"|<RadioGroupItem\b|role="radiogroup"/;

export function drawsRadiosByHand(text: string): boolean {
  return BUILT_BY_HAND.test(text);
}

const SRC = join(__dirname, "..", "..");
const SHARED = new Set([
  "components/ui/choice-cards.tsx",
  "components/ui/segmented-control.tsx",
  "components/ui/radio-group.tsx",
]);

const files = sourceFiles(SRC, [".tsx"])
  .map((file) => ({ path: relative(SRC, file).split(sep).join("/"), file }))
  .filter(
    ({ path }) =>
      !/\.test\.tsx$/.test(path) &&
      !path.startsWith("components/marketing/") &&
      !path.includes("(marketing"),
  )
  .map(({ path, file }) => ({ path, text: stripComments(sourceText(file)) }));

describe("#746 one ChoiceCards", () => {
  it("recognises a hand-built radio", () => {
    expect(drawsRadiosByHand(`<button role="radio" aria-checked>`)).toBe(true);
    expect(drawsRadiosByHand(`<input type="radio" name="x" />`)).toBe(true);
    expect(drawsRadiosByHand(`<RadioGroupItem value="a" />`)).toBe(true);
    expect(drawsRadiosByHand(`<ChoiceCards value="a" />`)).toBe(false);
  });

  it("no file draws one outside the shared controls and the named exceptions", () => {
    const offenders = files
      .filter(({ path }) => !SHARED.has(path) && !(path in OPEN_EXCEPTIONS))
      .filter(({ text }) => drawsRadiosByHand(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <ChoiceCards> (or <SegmentedControl>) instead of a hand-built radio",
    ).toEqual([]);
  });

  it("every named exception still draws one", () => {
    const stale = Object.keys(OPEN_EXCEPTIONS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !drawsRadiosByHand(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is used where the issue named it, and the scan looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files
      .filter(({ text }) => text.includes("<ChoiceCards"))
      .map(({ path }) => path);
    expect(users).toEqual(
      expect.arrayContaining([
        "components/settings/ring-card.tsx",
        "components/settings/after-hours-calls-card.tsx",
        "components/settings/number-access-dialog.tsx",
        "app/(app)/settings/missed-calls/page.tsx",
        "app/onboarding/number/page.tsx",
        "app/onboarding/name/page.tsx",
        "components/settings/cancel-subscription-card.tsx",
        "components/contact-panel/contact-language.tsx",
      ]),
    );
  });

  it("shows the label and the description of each option, one card in the tab order", () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceCards, {
        ariaLabel: "Who rings",
        value: "b",
        onChange: () => {},
        options: [
          { value: "a", label: "Everyone", description: "Every phone rings." },
          { value: "b", label: "In turn", description: "One at a time." },
        ],
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Every phone rings.");
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-checked="true"');
  });
});
