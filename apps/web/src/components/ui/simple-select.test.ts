import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

import { SimpleSelect } from "./simple-select";

/**
 * #746: one simple select.
 *
 * A short list of single choices was a native `<select>` in eight places, a
 * Radix `Select` built by hand in twenty-seven, and a button with its own
 * dropdown in two more. `SimpleSelect` is the one of them: the closed field
 * shows the chosen label only, and an option's description is drawn in the open
 * list. This scan fails on a native `<select>` or `<datalist>`, on a
 * `<SelectTrigger>` outside the two files that make it, and on a menu of radio
 * items used as a select outside the named exceptions. A name that stops
 * matching anything fails too.
 */
const NATIVE_SELECT = /<select\b|<datalist\b|\bNativeSelect\b/;
const HAND_BUILT_SELECT = /<SelectTrigger\b/;
const RADIO_MENU = /\bDropdownMenuRadioGroup\b/;

/** A menu of radio items is a record's own menu, not a form field. */
const RADIO_MENU_EXCEPTIONS: Record<string, string> = {
  "components/shell/member-menu.tsx":
    "the account menu theme choice, inside a menu of actions",
  "components/tasks/task-status-picker.tsx":
    "the status pill on a task row: the pill is the trigger",
  "components/thread/panel-width.tsx":
    "the thread panel width, inside its options menu",
  "components/thread/thread-header.tsx":
    "the conversation status pill and assignee avatar: icon triggers in a header",
};

const SELECT_MAKERS = new Set([
  "components/ui/select.tsx",
  "components/ui/simple-select.tsx",
]);

export function drawsNativeSelect(text: string): boolean {
  return NATIVE_SELECT.test(text);
}
export function drawsSelectByHand(text: string): boolean {
  return HAND_BUILT_SELECT.test(text);
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

describe("#746 one SimpleSelect", () => {
  it("recognises a native select and a hand-built Radix select", () => {
    expect(drawsNativeSelect(`<select value="a"><option /></select>`)).toBe(true);
    expect(drawsNativeSelect(`<datalist id="c" />`)).toBe(true);
    expect(drawsNativeSelect(`<NativeSelect value="a" />`)).toBe(true);
    expect(drawsSelectByHand(`<SelectTrigger id="x">`)).toBe(true);
    expect(drawsNativeSelect(`<SimpleSelect value="a" />`)).toBe(false);
    expect(drawsSelectByHand(`<SimpleSelect value="a" />`)).toBe(false);
  });

  it("no native <select> or <datalist> remains", () => {
    const offenders = files
      .filter(({ text }) => drawsNativeSelect(text))
      .map(({ path }) => path);
    expect(offenders, "use <SimpleSelect> or <SearchablePicker>").toEqual([]);
  });

  it("no file builds a select from the primitives", () => {
    const offenders = files
      .filter(({ path }) => !SELECT_MAKERS.has(path))
      .filter(({ text }) => drawsSelectByHand(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <SimpleSelect> from components/ui/simple-select",
    ).toEqual([]);
  });

  it("a menu of radio items is not used as a select, outside the named exceptions", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/dropdown-menu.tsx")
      .filter(({ path }) => !(path in RADIO_MENU_EXCEPTIONS))
      .filter(({ text }) => RADIO_MENU.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    const stale = Object.keys(RADIO_MENU_EXCEPTIONS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !RADIO_MENU.test(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is used, and the scan looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<SimpleSelect"));
    expect(users.length).toBeGreaterThanOrEqual(15);
  });

  it("the Invites and Members role fields are the same control", () => {
    const team = files.find((f) => f.path === "app/(app)/settings/team/page.tsx");
    expect(team?.text.match(/<RoleSelect\b/g)?.length).toBe(2);
  });
});

describe("#746 the closed select shows the label only", () => {
  it("never draws an option description in the closed field", () => {
    const html = renderToStaticMarkup(
      createElement(SimpleSelect, {
        value: "member",
        onValueChange: () => {},
        options: [
          {
            value: "member",
            label: "Member",
            description: "Read and answer customers; no billing, team or settings",
          },
          {
            value: "admin",
            label: "Admin",
            description: "Everything except billing",
          },
        ],
      }),
    );
    expect(html).toContain("Member");
    expect(html).not.toContain("Read and answer customers");
    expect(html).not.toContain("Everything except billing");
  });

  it("shows the placeholder for a value that is not an option", () => {
    const html = renderToStaticMarkup(
      createElement(SimpleSelect, {
        value: "",
        onValueChange: () => {},
        placeholder: "Choose what this is",
        options: [{ value: "a", label: "A" }],
      }),
    );
    expect(html).toContain("Choose what this is");
  });
});
