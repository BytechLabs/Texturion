import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

import { SearchablePicker } from "./searchable-picker";

/**
 * #746: one searchable picker.
 *
 * A long list found by typing (time zones, countries, teammates) is
 * `SearchablePicker`: a combobox over the shared Command list. This scan fails
 * when a file draws a combobox or a listbox by hand, or puts a search box over
 * a list (`CommandInput`), outside it. The files below do, each for a reason:
 * they are not a field with one chosen value. A name that stops matching
 * anything fails too.
 */
const HAND_BUILT = /role="(?:combobox|listbox)"|<CommandInput\b/;

const NOT_A_FIELD: Record<string, string> = {
  "components/shell/command-palette.tsx":
    "the command palette: runs an action, chooses no value",
  "components/inbox/new-conversation.tsx":
    "the recipient: free typing of a number or a contact, with its own keyboard contract",
  "components/tasks/assignee-field.tsx":
    "several assignees at once: a multi-select listbox",
  "components/tasks/task-bulk-bar.tsx":
    "assign several tasks to several people: a multi-select listbox",
  "components/tasks/task-planning-ui.tsx":
    "the labels on a task: a multi-select with create",
  "components/tasks/task-filter-bar.tsx":
    "the Tasks filter menu: several filters at once",
  "components/inbox/filter-bar.tsx":
    "the inbox filter menu: several filters at once",
  "components/contacts/contact-filter.tsx":
    "the Contacts filter menu: several filters at once",
  "components/contacts/contact-tags.tsx":
    "the tags on a contact: a multi-select with create",
  "components/contact-panel/contact-panel.tsx":
    "the tags on a contact: a multi-select with create",
  "components/tasks/reference-picker.tsx":
    "links a task to a record: searches records, chooses no setting",
  "components/thread/mention-picker.tsx":
    "inserts an at-mention into the note being typed",
  "components/thread/template-picker.tsx":
    "inserts a saved reply into the composer",
};

export function drawsPickerByHand(text: string): boolean {
  return HAND_BUILT.test(text);
}

const SRC = join(__dirname, "..", "..");
const files = sourceFiles(SRC, [".tsx"])
  .map((file) => ({ path: relative(SRC, file).split(sep).join("/"), file }))
  .filter(
    ({ path }) =>
      !/\.test\.tsx$/.test(path) &&
      !path.startsWith("components/marketing/") &&
      !path.includes("(marketing"),
  )
  .map(({ path, file }) => ({ path, text: stripComments(sourceText(file)) }));

describe("#746 one SearchablePicker", () => {
  it("recognises a hand-built combobox, listbox and search box", () => {
    expect(drawsPickerByHand(`<button role="combobox">`)).toBe(true);
    expect(drawsPickerByHand(`<ul role="listbox">`)).toBe(true);
    expect(drawsPickerByHand(`<CommandInput placeholder="x" />`)).toBe(true);
    expect(drawsPickerByHand(`<SearchablePicker value="a" />`)).toBe(false);
  });

  it("no file draws one outside the picker and the named exceptions", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/searchable-picker.tsx")
      .filter(({ path }) => !(path in NOT_A_FIELD))
      .filter(({ text }) => drawsPickerByHand(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <SearchablePicker> from components/ui/searchable-picker",
    ).toEqual([]);
  });

  it("every named exception still draws one", () => {
    const stale = Object.keys(NOT_A_FIELD).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !drawsPickerByHand(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is used for time zones, countries and teammates, and the scan looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files
      .filter(({ text }) => /<SearchablePicker\b/.test(text))
      .map(({ path }) => path);
    expect(users).toEqual(
      expect.arrayContaining([
        "components/settings/timezone-select.tsx",
        "components/ui/country-picker.tsx",
        "components/settings/on-call-card.tsx",
      ]),
    );
  });

  it("shows the chosen label, or the stored value when it is not listed", () => {
    const options = [
      { value: "america/toronto", label: "Toronto", group: "America" },
    ];
    expect(
      renderToStaticMarkup(
        createElement(SearchablePicker, {
          value: "america/toronto",
          onValueChange: () => {},
          options,
        }),
      ),
    ).toContain("Toronto");
    expect(
      renderToStaticMarkup(
        createElement(SearchablePicker, {
          value: "CA",
          onValueChange: () => {},
          options,
          allowCustom: true,
        }),
      ),
    ).toContain(">CA<");
  });
});
