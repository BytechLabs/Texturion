/**
 * #238 / WCAG 2.2 2.5.7 — the calendar's way to reschedule without dragging.
 *
 * CR-1 is the load-bearing one. Dragging a chip to another cell moves the DATE
 * and leaves the appointment time alone; the drop handler is explicit about it
 * ("Preserve the original time-of-day; only move the calendar date"). The menu
 * has to do the same thing, because it is the SAME operation offered a
 * different way — and a menu that quietly reset every job to midnight would
 * be a different operation wearing the same name, discovered by a crew turning
 * up at the wrong hour.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { movedDueAt, RESCHEDULE_MOVES } from "./calendar-view";

const NOW = new Date("2026-07-15T09:00:00.000Z");

const SOURCE = readFileSync(
  fileURLToPath(new URL("./calendar-view.tsx", import.meta.url)),
  "utf8",
);

describe("#238 rescheduling from the calendar without a drag", () => {
  it("CR-1: the time of day survives the move", () => {
    // A job at 08:30 pushed to tomorrow is at 08:30 tomorrow.
    const due = "2026-07-15T08:30:00.000Z";
    const moved = new Date(movedDueAt(due, 1, NOW));
    const original = new Date(due);

    expect(moved.getHours()).toBe(original.getHours());
    expect(moved.getMinutes()).toBe(original.getMinutes());
    expect(moved.getDate()).toBe(original.getDate() + 1);
  });

  it("CR-2: a move backwards is a move backwards", () => {
    // "A day earlier" exists because a job sometimes moves UP the calendar,
    // and a menu that could only push work later would send people back to
    // dragging for half the cases.
    const moved = new Date(movedDueAt("2026-07-15T08:30:00.000Z", -1, NOW));
    expect(moved.getDate()).toBe(14);
  });

  it("CR-3: a week later crosses the month boundary correctly", () => {
    // Date arithmetic by hand is where an off-by-one lives. 29 July + 7 is
    // 5 August, and `setDate` past the end of a month rolls over for free —
    // asserted so a future "optimisation" to day-of-month maths cannot creep in.
    const moved = new Date(movedDueAt("2026-07-29T08:30:00.000Z", 7, NOW));
    expect(moved.getMonth()).toBe(7); // August, zero-indexed
    expect(moved.getDate()).toBe(5);
  });

  it("CR-4: a task with no due date is scheduled from today", () => {
    // Not a crash, and not 1970. A task that was never dated is exactly the
    // one somebody most wants to put on the calendar.
    const moved = new Date(movedDueAt(null, 1, NOW));
    expect(moved.getDate()).toBe(NOW.getDate() + 1);
    expect(moved.getMonth()).toBe(NOW.getMonth());
  });

  it("CR-5: the moves offered are the ones a schedule actually needs", () => {
    // Both directions, and a longer push. A list that only went forward, or
    // only by one day, would leave the common "next week" case on the drag —
    // which is the interaction this whole change exists to stop depending on.
    const days = RESCHEDULE_MOVES.map((move) => move.days);
    expect(days).toContain(-1);
    expect(days).toContain(1);
    expect(days.some((day) => day >= 7)).toBe(true);
    // Short enough to read at a glance inside a dense month grid.
    expect(RESCHEDULE_MOVES.length).toBeLessThanOrEqual(4);
  });

  it("CR-6: every move is labelled in plain words, not a signed number", () => {
    for (const move of RESCHEDULE_MOVES) {
      expect(move.label).not.toMatch(/^[+-]?\d/);
      expect(move.label.length).toBeGreaterThan(3);
    }
  });

  it("CR-7: the trigger is never hidden until hover", () => {
    // Found by breaking it. The comment above the trigger already said "always
    // in the DOM, never hover-only" and nothing checked it, so swapping
    // `opacity-40` for `hidden group-hover/chip:grid` passed every test here.
    //
    // That change looks identical to a mouse user and removes the control
    // entirely for the people it was built for: `display: none` is not
    // focusable, so the keyboard path disappears, and there is no hover on a
    // touch screen at all. Dimming is fine — it stays focusable and stays hit-
    // testable. Removing it from the box tree is not.
    const trigger = SOURCE.slice(
      SOURCE.indexOf("aria-label={`Reschedule "),
      SOURCE.indexOf("CalendarClock className"),
    );
    expect(trigger, "the reschedule trigger is where this test thinks").toContain(
      "className=",
    );

    for (const hiding of ["hidden ", '"hidden', "invisible", "sr-only"]) {
      expect(
        trigger.includes(hiding),
        `The reschedule trigger uses "${hiding}", which takes it out of the ` +
          `box tree or the accessibility tree. It is the single-pointer and ` +
          `keyboard alternative to dragging (WCAG 2.2 2.5.7) — dim it if it ` +
          `is too loud, but it has to stay focusable and hit-testable.`,
      ).toBe(false);
    }
    // And the quiet-until-noticed treatment is opacity, which keeps both.
    expect(trigger).toMatch(/opacity-\d+/);
  });
});
