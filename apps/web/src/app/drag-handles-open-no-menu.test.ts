/**
 * #742: a drag handle never opens a menu.
 *
 * THE FAILURE THIS CAUGHT. The thread panel's border carried a grip pill, and
 * the pill was a dropdown trigger listing preset widths (added as WCAG 2.5.7's
 * no-drag path). The grip is exactly where a person grabs to drag, so pressing
 * it opened the menu and the drag never began. The no-drag alternative belongs
 * on a control of its own, never on the handle.
 *
 * WHAT COUNTS AS A HANDLE. An element that carries a grip icon, is
 * `role="separator"` with an `aria-orientation`, or is `draggable`. WHAT COUNTS
 * AS A MENU TRIGGER. Anything inside a Dropdown/Popover/Select/... Trigger
 * element, anything passed as a `trigger={...}` prop, or anything with
 * `aria-haspopup`. A context menu opens on right-click and does not compete
 * with a primary-button drag, so it is not a trigger here.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

const HANDLE_MARKERS: readonly { name: string; pattern: RegExp }[] = [
  { name: "grip icon", pattern: /<Grip[A-Za-z]*\b/g },
  { name: "draggable", pattern: /\bdraggable\b(?!\s*:)/g },
  { name: 'role="separator"', pattern: /role=["']separator["']/g },
];

/** Opening and closing tags of every menu-style trigger element. */
const TRIGGER_TAG = /<((?:Dropdown|Popover|Menubar|Select|Dialog|Sheet)[A-Za-z]*Trigger)\b/g;

type Range = readonly [number, number];

/** Index just past the `}` that balances the `{` at `open`. */
function balancedBraceEnd(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i + 1;
  }
  return code.length;
}

/** Every span of source that sits inside a menu trigger. */
export function triggerRanges(code: string): Range[] {
  const ranges: Range[] = [];
  for (const match of code.matchAll(TRIGGER_TAG)) {
    const start = match.index!;
    const close = code.indexOf(`</${match[1]}>`, start);
    if (close !== -1) ranges.push([start, close]);
  }
  for (const match of code.matchAll(/\btrigger=\{/g)) {
    const open = match.index! + match[0].length - 1;
    ranges.push([open, balancedBraceEnd(code, open)]);
  }
  return ranges;
}

/** The opening tag (`<` to its `>`) that contains position `at`, if any. */
function enclosingOpeningTag(code: string, at: number): string {
  const start = code.lastIndexOf("<", at);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0 && code[i - 1] !== "=") return code.slice(start, i + 1);
  }
  return code.slice(start);
}

/** Handles in `code` that are also menu triggers, as readable descriptions. */
export function handleTriggerConflicts(code: string): string[] {
  const ranges = triggerRanges(code);
  const found: string[] = [];
  for (const { name, pattern } of HANDLE_MARKERS) {
    for (const match of code.matchAll(pattern)) {
      const at = match.index!;
      const insideTrigger = ranges.some(([from, to]) => at > from && at < to);
      const ownTag = enclosingOpeningTag(code, at);
      const isTriggerItself =
        /\baria-haspopup\b/.test(ownTag) ||
        /^<(?:Dropdown|Popover|Menubar|Select)[A-Za-z]*Trigger\b/.test(ownTag);
      if (insideTrigger || isTriggerItself) {
        const line = code.slice(0, at).split("\n").length;
        found.push(`${name} at line ${line}`);
      }
    }
  }
  return found;
}

describe("#742 a drag handle never opens a menu", () => {
  const files = sourceFiles(SRC, [".tsx"]).filter((file) => !/\.test\.tsx?$/.test(file));

  it("DH-1: reads the client, so a pass means something", () => {
    expect(files.length).toBeGreaterThan(200);
    const handles = files.filter((file) =>
      HANDLE_MARKERS.some(({ pattern }) => new RegExp(pattern.source).test(stripComments(sourceText(file)))),
    );
    // The thread panel's separator and For you's grip are handles today; zero
    // would mean the scan has stopped seeing them.
    expect(handles.length).toBeGreaterThanOrEqual(2);
  });

  it("DH-2: no handle in the app is also a menu trigger", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const found of handleTriggerConflicts(stripComments(sourceText(file)))) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${found}`);
      }
    }
    expect(
      offenders,
      "These handles are menu triggers, so pressing them opens a menu instead of " +
        "starting a drag. Make the handle only drag; put the menu on a separate " +
        "control (the panel's ⋯ menu):\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("DH-3: the detector flags the #742 shape and passes the fix", () => {
    const broken = `
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button"><GripVertical className="size-3" /></button>
        </DropdownMenuTrigger>
      </DropdownMenu>`;
    expect(handleTriggerConflicts(broken)).toHaveLength(1);
    const viaProp = `<RecordOverflowMenu trigger={<span draggable>x</span>} />`;
    expect(handleTriggerConflicts(viaProp)).toHaveLength(1);
    const fixed = `
      <div role="separator" aria-orientation="vertical"><span><GripVertical /></span></div>
      <DropdownMenu><DropdownMenuTrigger asChild><button>more</button></DropdownMenuTrigger></DropdownMenu>`;
    expect(handleTriggerConflicts(fixed)).toEqual([]);
  });
});
