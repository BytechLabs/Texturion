/**
 * #238 — the VERDICT half of the keyboard focus walk, with no browser in it.
 *
 * `theme-audit.mjs` does two separable things at every tab stop: it asks the
 * rendered page what the focus indicator looks like, and it decides whether
 * that constitutes a failure. Only the first half needs Chromium. Splitting
 * them is what makes the second half provable.
 *
 * This matters because of how the rest of these guards were built. Every other
 * check on #238 was proven by breaking real markup and watching it fail, and
 * two of them turned out to be decorative when that was finally tried. The same
 * method does not reach here: deleting a focus ring is a one-line edit, but
 * staging a focus TRAP, or a control with no rendered box, means building the
 * broken thing first — so those two branches would have shipped never having
 * been executed, which is exactly the shape this issue exists to complain
 * about. As a pure function they are five ordinary unit tests that run on every
 * pull request, rather than a browser experiment nobody repeats.
 *
 * WHICH CRITERIA. Three, and they are not interchangeable — `docs/
 * ACCESSIBILITY.md` cites these numbers to buyers:
 *
 *   2.4.7  Focus Visible          AA   2.0   there is an indicator at all
 *   1.4.11 Non-text Contrast      AA   2.1   the indicator clears 3:1
 *   2.4.11 Focus Not Obscured     AA   2.2   nothing covers the focused control
 *
 * 2.4.13 Focus Appearance is AAA and adds area rules nothing here measures, so
 * it is not claimed.
 */

/** 1.4.11 Non-text Contrast's bar for a focus indicator against its surround. */
export const MIN_FOCUS_CONTRAST = 3;

/**
 * Decide whether one tab stop is a fault.
 *
 * @param info  what `FOCUS_WALK` measured on the rendered page
 * @param stop  how many Tab presses in we are, for the loop message
 * @returns a fault, or null when the stop is fine
 *
 * The ORDER is load-bearing and not alphabetical:
 *
 *   - `hidden` first, because an `aria-hidden` subtree is not part of the
 *     accessible page and its ring is nobody's business.
 *   - `revisited` before anything measurable, because once the sequence has
 *     closed a loop the later stops are repeats and every fault they carry has
 *     already been reported once.
 *   - `obscured` before the ring checks, because a ring you cannot see behind a
 *     sticky header is not a ring problem and reporting it as one sends the
 *     reader to change a colour that was never wrong.
 */
export function classifyFocusStop(info, stop) {
  if (info.hidden) return null;

  // Not reachable by Tab, so no criterion about the tab sequence applies to it.
  // Radix focuses its dropdown and dialog containers programmatically on open;
  // they carry `tabindex="-1"` and exist to be announced, not visited.
  if (info.programmatic) return null;

  if (info.revisited) {
    // A MODAL IS SUPPOSED TO CYCLE, and this is the distinction §7 draws that
    // the first version of this check missed. It asks for focus never trapped
    // in a SCROLL REGION — an open dialog or menu is the opposite case, where
    // 2.1.2 permits the trap precisely because Escape is the documented way
    // out, and a dialog that let Tab wander back to the page behind it would be
    // the bug. Reported as a fault, this failed four portal surfaces for
    // behaving correctly, which is how a gate earns its reputation for crying
    // wolf and gets switched off.
    if (info.inModal) return { stopWalk: true };

    return {
      kind: "FOCUS-LOOP",
      what: info.tag,
      stopWalk: true,
      detail:
        `tab order returned to a stop it had already visited after ${stop} ` +
        "presses — focus is cycling inside a region instead of leaving it (§7 " +
        "keyboard path)",
    };
  }

  if (info.offscreen) {
    return {
      kind: "FOCUS-INVISIBLE",
      what: info.tag,
      detail:
        "focus landed on an element with no rendered box — the reader's caret " +
        "is somewhere they cannot see (§7 keyboard path)",
    };
  }

  if (info.obscured) {
    return {
      kind: "FOCUS-OBSCURED",
      what: info.tag,
      detail:
        "the focused control is entirely covered by something drawn over it — " +
        "a sticky header or overlay is hiding where the keyboard is (WCAG 2.2 " +
        "2.4.11 Focus Not Obscured, AA)",
    };
  }

  if (!info.hasIndicator) {
    return {
      kind: "NO-FOCUS-RING",
      what: info.tag,
      detail:
        "focused by keyboard with no outline and no ring — there is no way to " +
        "tell where you are (WCAG 2.4.7 Focus Visible, AA; §7 visible focus)",
    };
  }

  // The browser's own ring, which Chrome paints two-tone so it stays visible on
  // any ground and ignores `outline-color` while doing it. It satisfies 2.4.7,
  // and its colour is not ours to measure. Not a loophole: nothing in this
  // product sets `outline: auto` deliberately, so it only appears where a
  // control declares no focus style at all and the UA steps in.
  if (info.uaRing) return null;

  if (info.contrast < MIN_FOCUS_CONTRAST) {
    return {
      kind: "DIM-FOCUS-RING",
      what: `${info.tag} ${info.contrast.toFixed(2)}:1`,
      detail:
        `focus indicator under ${MIN_FOCUS_CONTRAST}:1 against the surface ` +
        "behind it — present, and not visible enough to be the answer to " +
        '"where am I" (WCAG 1.4.11 Non-text Contrast, AA)',
    };
  }

  return null;
}
