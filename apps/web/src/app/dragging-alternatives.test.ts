/**
 * #238 — WCAG 2.2 **2.5.7 Dragging Movements**, checked by something other
 * than recollection.
 *
 * > All functionality that uses a dragging movement for operation can be
 * > achieved by a single pointer without dragging.
 *
 * THE FAILURE THIS CAUGHT. The calendar's day chip was draggable to
 * reschedule and was also a link, so clicking it navigated to the thread.
 * There was no third thing: anybody who could not drag — a screen-reader
 * user, somebody on a trackpad with a tremor, anybody on a touch device where
 * the drag never registered — could see the schedule and not change it. The
 * board view had solved exactly this two files away, with a visible "Move
 * to…" button, and nothing connected the two.
 *
 * That is the shape #238 names: a binding spec (APP-LAYOUT-V2 §7 anticipates
 * keyboard-accessible board moves) enforced by memory, which decays.
 *
 * ── WHY A SOURCE SCAN AND NOT A RENDERED PASS ─────────────────────────────
 *
 * `scripts/theme-audit.mjs` renders and measures, and is the right tool for
 * contrast and hit targets. It cannot answer this one: whether an alternative
 * exists is a question about INTENT, and a renderer sees a button without
 * knowing whether it performs the drag's operation or something else.
 *
 * So the check is deliberately coarse — every file that starts a drag must
 * declare how the drag can be done without dragging — and the declaration is
 * a roster below rather than a pattern match, because "there is a button
 * somewhere in this file" is exactly the assertion that passes forever while
 * the button does something unrelated.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

/**
 * Every file allowed to start a drag, and the single-pointer path that does
 * the same job.
 *
 * `pointerAlternative` names the code that must appear in the file with
 * comments stripped. The markers are deliberately pointer-shaped rather than
 * merely keyboard-shaped: WCAG 2.5.7 is independent of keyboard access. More
 * than one marker is allowed when the full range/bounds are part of the proof.
 * Deleting any marker fails here even though the drag still works — which is
 * the regression this exists to catch, because the drag going on working is
 * precisely why nobody would notice.
 */
const DRAG_SURFACES: Record<
  string,
  { pointerAlternative: readonly string[]; why: string }
> = {
  "components/attachments/photo-markup-dialog.tsx": {
    pointerAlternative: ["if (anchor === null) {"],
    why:
      "Tap once to anchor, tap again to finish the mark. The same arrow or circle, " +
      "with two pointer-downs and no movement — for a tremor, a trackpad, or a " +
      "touch that never registers as a drag.",
  },
  "components/tasks/views/board-view.tsx": {
    pointerAlternative: ["onClick={onMove}"],
    why: "A visible 'Move to To do / Move to Done' button on every card.",
  },
  "components/tasks/views/calendar-view.tsx": {
    pointerAlternative: ["RESCHEDULE_MOVES.map"],
    why: "A per-chip menu with relative moves — a day earlier, a day later, a week later.",
  },
  "components/thread/thread-view.tsx": {
    pointerAlternative: [
      "htmlFor={panelWidthControlId}",
      "id={panelWidthControlId}",
      "onClick={narrowPanel}",
      "onClick={widenPanel}",
      "const PANEL_WIDTH_NUDGE = 16",
      "clampPanelWidth(width + delta)",
      'aria-label={t("thread.narrowPanelAria")}',
      'aria-label={t("thread.widenPanelAria")}',
      "disabled={panelWidth <= PANEL_MIN_WIDTH}",
      "disabled={panelWidth >= PANEL_MAX_WIDTH}",
      'type="range"',
      "min={PANEL_MIN_WIDTH}",
      "max={PANEL_MAX_WIDTH}",
      "step={1}",
      "setAndPersistPanelWidth(event.currentTarget.valueAsNumber)",
    ],
    why:
      "Visible narrower/wider buttons take deterministic pointer steps and " +
      "clamp at the shared endpoints; a labelled range keeps fine control. " +
      "Both onClick handlers, both disabled bounds and the range wiring are " +
      "pinned so keyboard arrows or a decorative slider cannot satisfy it.",
  },
};

/**
 * Marketing surfaces are exempt, and this says why in one place rather than
 * by omission.
 *
 * `draggable` on a marketing image is the BROWSER's native image-drag, which
 * nothing depends on and which carries no functionality — 2.5.7 governs
 * operations performed BY dragging, and there is none here. Native range
 * inputs are browser-owned controls rather than custom authored pointer-drag
 * handlers, so there is no authored drag in those files for this scan to
 * roster.
 */
const NOT_AN_OPERATION = ["components/marketing/"];

/**
 * Anything that begins a drag somebody could depend on.
 *
 * `onPointerDown=` is matched on its own, NOT as `onPointerDown=.*drag`. The
 * narrower form was the first version of this rule and it had a hole: the
 * thread panel's resize handle reads `onPointerDown={startResize}`, with the
 * word "drag" nowhere on the line, so the guard walked straight past a
 * drag-to-resize interaction and reported the codebase clean.
 *
 * The trailing `=` matters too. Radix's `onPointerDownOutside` is a dismiss
 * callback rather than a drag, and it does not match — which is why the
 * exemption list below needs no entry for every dialog we own.
 */
const DRAG_STARTERS = /\bonDragStart=|\bdraggable\b|\bonPointerDown=/;

describe("#238 every draggable operation has a way out (WCAG 2.2 2.5.7)", () => {
  // Test files are excluded: this one names `onDragStart` in order to search
  // for it, and a guard that flags its own explanation is a guard nobody keeps.
  const files = sourceFiles(SRC, [".tsx"]).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );

  it("DA-1: reads the client, so a passing run means something", () => {
    // The failure this whole family of guards exists to catch: a scan that
    // walks nothing reports success forever.
    expect(files.length).toBeGreaterThan(200);
  });

  it("DA-2: no drag surface exists that this file has not been told about", () => {
    // The roster is the point. A new draggable interaction fails here until
    // somebody writes down how it works without dragging — which is the
    // moment to build the alternative, not months later when a customer says
    // they cannot use the calendar.
    const unknown: string[] = [];
    for (const path of files) {
      const rel = relative(path);
      if (NOT_AN_OPERATION.some((prefix) => rel.startsWith(prefix))) continue;
      if (rel in DRAG_SURFACES) continue;
      if (DRAG_STARTERS.test(stripComments(sourceText(path)))) unknown.push(rel);
    }

    expect(
      unknown,
      "These files start a drag and no single-pointer alternative is " +
        "recorded for them. WCAG 2.2 2.5.7 requires one. Add the file to " +
        "DRAG_SURFACES with the code that implements the way out — and build " +
        "that way out first:\n  " + unknown.join("\n  "),
    ).toEqual([]);
  });

  it("DA-3: every recorded pointer alternative is still in its file", () => {
    // The regression that would otherwise be silent. Deleting the menu leaves
    // the drag working perfectly, so every mouse user — including whoever
    // deleted it — sees a calendar that behaves exactly as before.
    for (const [rel, surface] of Object.entries(DRAG_SURFACES)) {
      const path = files.find((candidate) => relative(candidate) === rel);
      expect(path, `${rel} is in DRAG_SURFACES but not in the tree`).toBeTruthy();

      const code = stripComments(sourceText(path!));
      for (const marker of surface.pointerAlternative) {
        expect(
          code.includes(marker),
          `${rel} no longer contains its single-pointer alternative marker ` +
            `(${marker}). ${surface.why}`,
        ).toBe(true);
      }
    }
  });

  it("DA-6: the panel-width record pins both pointer buttons and its range", () => {
    // The old record cited only `event.key`, so the test stayed green while
    // arbitrary non-drag resizing was keyboard-only. Keep the exact failure
    // from returning under another explanatory comment.
    const panel = DRAG_SURFACES["components/thread/thread-view.tsx"];
    expect(panel.pointerAlternative).toContain("htmlFor={panelWidthControlId}");
    expect(panel.pointerAlternative).toContain("id={panelWidthControlId}");
    expect(panel.pointerAlternative).toContain("onClick={narrowPanel}");
    expect(panel.pointerAlternative).toContain("onClick={widenPanel}");
    expect(panel.pointerAlternative).toContain("const PANEL_WIDTH_NUDGE = 16");
    expect(panel.pointerAlternative).toContain("clampPanelWidth(width + delta)");
    expect(panel.pointerAlternative).toContain(
      'aria-label={t("thread.narrowPanelAria")}',
    );
    expect(panel.pointerAlternative).toContain(
      'aria-label={t("thread.widenPanelAria")}',
    );
    expect(panel.pointerAlternative).toContain(
      "disabled={panelWidth <= PANEL_MIN_WIDTH}",
    );
    expect(panel.pointerAlternative).toContain(
      "disabled={panelWidth >= PANEL_MAX_WIDTH}",
    );
    expect(panel.pointerAlternative).toContain('type="range"');
    expect(panel.pointerAlternative).toContain("min={PANEL_MIN_WIDTH}");
    expect(panel.pointerAlternative).toContain("max={PANEL_MAX_WIDTH}");
    expect(panel.pointerAlternative).toContain("step={1}");
    expect(panel.pointerAlternative.join(" ")).not.toContain("event.key");
  });

  it("DA-5: the exemption list cannot be widened into an off switch", () => {
    // Found by breaking it. Every other assertion here survived their sweep;
    // this one did not exist, and widening NOT_AN_OPERATION to "components/"
    // turned the whole guard green while every drag surface in the app went
    // unchecked. An exemption list is the softest part of any guard, because
    // widening one reads like housekeeping.
    //
    // The rule that makes it safe: a path cannot be BOTH "not an operation"
    // and "an operation with a recorded alternative". So an exemption broad
    // enough to cover a known drag surface is a contradiction, and it fails
    // here rather than quietly switching the scan off.
    const swallowed = Object.keys(DRAG_SURFACES).filter((rel) =>
      NOT_AN_OPERATION.some((prefix) => rel.startsWith(prefix)),
    );

    expect(
      swallowed,
      "The exemption list now covers files that DRAG_SURFACES says are real " +
        "drag operations with alternatives. Those two claims contradict each " +
        "other, and the wider one silently disables this check:\n  " +
        swallowed.join("\n  "),
    ).toEqual([]);
  });

  it("DA-4: the roster describes real files, not ones that moved", () => {
    // A roster entry pointing at a deleted file passes DA-2 forever while the
    // drag it was meant to cover lives somewhere else entirely.
    for (const rel of Object.keys(DRAG_SURFACES)) {
      const path = files.find((candidate) => relative(candidate) === rel);
      expect(path, `${rel} no longer exists — the roster is stale`).toBeTruthy();
      expect(
        DRAG_STARTERS.test(stripComments(sourceText(path!))),
        `${rel} no longer starts a drag. If dragging was removed, remove it ` +
          `from DRAG_SURFACES too rather than leaving a rule with nothing ` +
          `under it.`,
      ).toBe(true);
    }
  });
});

/** A path as the roster spells it: relative to src/, forward slashes. */
function relative(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const at = normalized.lastIndexOf("/src/");
  return at === -1 ? normalized : normalized.slice(at + "/src/".length);
}
