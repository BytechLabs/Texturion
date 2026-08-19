#!/usr/bin/env node
/**
 * #238 — WCAG 2.2 **2.5.7 Dragging Movements**, on the two phones.
 *
 * > All functionality that uses a dragging movement for operation can be
 * > achieved by a single pointer without dragging.
 *
 * Web already has this: `apps/web/src/app/dragging-alternatives.test.ts` holds
 * a roster of every file allowed to start a drag and the code that does the
 * same job without one. The phones had the RULE and no check —
 * `ui/common/SwipeActions.kt` states it in a docblock:
 *
 *     A11Y RULE (#185): a swipe is NEVER the only path to an action. Every
 *     action wired here must ALSO have a visible tap path on the row.
 *
 * which is exactly the shape #238 is about: a binding rule enforced by
 * memory. The docblock cannot fail, so it decays like every other rule that
 * only lives in prose.
 *
 * ## What a "drag" is here, and what it is not
 *
 * A CUSTOM gesture needs a declared alternative: `pointerInput` +
 * `detectDragGestures` on Android, `DragGesture` on iOS. The platform cannot
 * know what those do, so nothing exposes them to TalkBack or VoiceOver.
 *
 * SwiftUI's `.swipeActions` is NOT in that category and is deliberately not
 * listed. It is a platform affordance, and VoiceOver publishes its buttons in
 * the Actions rotor automatically — the alternative ships with the API. Our
 * Android `SwipeActions.kt` looks similar and is not: it is hand-built on
 * `pointerInput`, so it gets no such treatment and its callers carry the
 * obligation instead.
 *
 * ## Why a roster instead of a pattern
 *
 * Same reasoning the web guard records: "there is a tap handler somewhere in
 * this file" passes forever while the handler does something unrelated.
 * Naming the code that implements the way out means deleting the alternative
 * fails HERE, even though the drag still works — which is the regression worth
 * catching, because the drag continuing to work is precisely why nobody would
 * notice.
 */
import { readFileSync, existsSync } from "node:fs";

/**
 * Every phone file allowed to start a custom drag, and the single-pointer path
 * that does the same job.
 *
 * `alternative` is source text that must appear in the file. `why` is for the
 * person who has to decide whether a new gesture belongs here.
 */
const SURFACES = {
  "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/PhotoMarkupSheet.kt": {
    alternative: "detectTapGestures",
    why:
      "Tap once to anchor, tap again to finish the mark. The same arrow or " +
      "circle with two pointer-downs and no movement — for a tremor, or a " +
      "touch that never registers as a drag. Twin of the web dialog and the " +
      "iOS sheet; all three share `isDeliberateDrag` from packages/shared.",
  },
  "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/Composer.kt": {
    alternative: "detectTapGestures",
    why:
      "The composer's mode pill can be dragged sideways to switch, and tapped " +
      "to do the same thing. The drag is the shortcut; the tap is the door.",
  },
  "apps/android/app/src/main/kotlin/com/loonext/android/ui/common/SwipeActions.kt": {
    // The component itself cannot carry the alternative — the actions belong
    // to its callers. What it CAN do is state the obligation where somebody
    // wiring a new action will read it, and that sentence is what this pins.
    alternative: "A11Y RULE (#185): a swipe is NEVER the only path to an action",
    why:
      "Hand-built on pointerInput, so unlike SwiftUI's `.swipeActions` nothing " +
      "publishes these to TalkBack. The rule lives in the component's docblock " +
      "and the tap paths live in the five callers; this pins the rule so the " +
      "next person to wire an action meets it.",
  },
  "apps/ios/Loonext/Features/Compose/PhotoMarkupSheet.swift": {
    alternative: "guard let held = anchor else {",
    why:
      "The iOS twin: `DragGesture(minimumDistance: 0)` treats a press that did " +
      "not move as a tap, and two taps anchor and finish the mark.",
  },
  "apps/ios/Loonext/Features/Tasks/TaskBoard.swift": {
    alternative: ".accessibilityLabel(moveLabel)",
    why:
      "D25's kanban board: a card is `.draggable(task.id)` and dropping it on " +
      "the other column runs the same PATCH as the arrow button in its " +
      "corner. The arrow is the single-pointer path, and it is the ONLY path " +
      "for VoiceOver, which cannot perform a drag at all. The card's own file " +
      "already said so in a comment — a sentence, which is not a control. " +
      "Pinned on the accessibility label rather than on `onMove`, because a " +
      "button that moves the task while announcing nothing is the failure " +
      "this clause is actually about.",
  },
};

const problems = [];

for (const [file, rule] of Object.entries(SURFACES)) {
  if (!existsSync(file)) {
    problems.push(
      `${file} is in the roster and does not exist. Either the gesture moved — ` +
        `in which case its alternative moved with it and this entry should ` +
        `follow — or the file went away and the entry is dead weight that reads ` +
        `as coverage.`,
    );
    continue;
  }
  const source = readFileSync(file, "utf8");
  if (!source.includes(rule.alternative)) {
    problems.push(
      `${file} starts a drag and no longer contains its single-pointer ` +
        `alternative (${JSON.stringify(rule.alternative)}).\n      ` +
        `What it was for: ${rule.why}`,
    );
  }
}

/**
 * And the other direction: a phone file that starts a custom drag and is not
 * in the roster at all.
 *
 * This is the half that catches the NEXT gesture rather than the ones already
 * thought about — the reason the web guard exists, and the reason a roster
 * alone would rot.
 */
const STARTS_A_DRAG = [
  // Android: a raw pointer stream with a drag detector on it.
  { pattern: /detectDragGestures|detectHorizontalDragGestures|detectVerticalDragGestures/, ext: ".kt" },
  /*
   * And the Modifier family, for exactly the reason the iOS arm below
   * already records: `detectDragGestures` is the API this codebase happened
   * to reach for FIRST, not the only way Compose starts a drag.
   * `Modifier.draggable`, `anchoredDraggable` and the deprecated
   * `swipeable` all begin a drag TalkBack cannot perform, and none of them
   * contains that substring.
   *
   * Nothing in the tree uses them today, which is the point of adding them
   * now: the iOS half of this sweep shipped blind to `.draggable` while the
   * task board had used it since it shipped, and the guard printed a
   * coverage count the whole time. The Android twin of that board has not
   * been built yet.
   */
  { pattern: /Modifier.draggable|anchoredDraggable|swipeable[(]|rememberDraggableState/, ext: ".kt" },
  // iOS: SwiftUI's own drag. `.swipeActions` is excluded on purpose — see the
  // header: VoiceOver publishes those buttons itself.
  //
  // THREE patterns, not one. `DragGesture(` was the only one here, and it is
  // the API this codebase happens to have used FIRST — not the only way
  // SwiftUI starts a drag. `.draggable(_:)` (Transferable) and the older
  // `.onDrag {}` both begin a drag the platform will not narrate, and neither
  // contains the string "DragGesture". The task board has used `.draggable`
  // since it shipped, so the single most-cited example in #238 — D25's kanban
  // drag-to-change-state — was invisible to the sweep that reports "no
  // unrostered drag", on every run, while reading as covered.
  { pattern: /DragGesture\s*\(/, ext: ".swift" },
  { pattern: /\.draggable\s*\(/, ext: ".swift" },
  { pattern: /\.onDrag\s*[({]/, ext: ".swift" },
];

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (statSync(full).isFile()) out.push(full.split("\\").join("/"));
  }
  return out;
}

const phoneFiles = [
  ...walk("apps/android/app/src/main"),
  ...walk("apps/ios/Loonext"),
];

for (const file of phoneFiles) {
  for (const { pattern, ext } of STARTS_A_DRAG) {
    if (!file.endsWith(ext)) continue;
    const source = readFileSync(file, "utf8");
    if (!pattern.test(source)) continue;
    if (file in SURFACES) continue;
    problems.push(
      `${file} starts a custom drag and is not in this guard's roster. Add it ` +
        `with the code that performs the same operation from a single pointer ` +
        `— or, if the drag is decorative and operates nothing, say so there. ` +
        `WCAG 2.2 2.5.7: a drag may be a shortcut, never the only way.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Dragging alternatives on the phones (#238, WCAG 2.5.7):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Gesture alternatives: ${Object.keys(SURFACES).length} phone drag surface(s), ` +
    `each with a single-pointer path, and no unrostered drag in ${phoneFiles.length} files.`,
);
