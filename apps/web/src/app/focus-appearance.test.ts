/**
 * #238 — the focus indicator: the verdict logic, and the source rule that keeps
 * it green.
 *
 * `docs/ACCESSIBILITY.md` listed focus appearance as SPECIFIED BUT UNVERIFIED
 * for a good reason — it needs a rendered ring measured against its surround,
 * which no source scan can do. `scripts/theme-audit.mjs` now does that in CI by
 * pressing Tab through every surface in both themes. What it found on its first
 * honest run was two real failures:
 *
 *   - shadcn's stock `focus-visible:ring-ring/50` on every control in the app.
 *     `--ring` is #3f3f3f and half of it over a #fdfdfd card lands on
 *     rgb(158,158,158): 2.63:1, under 1.4.11's 3:1.
 *   - the marketing primary CTA ringed in its own lime fill, 1.78:1 on the
 *     ground — lime is the one colour on the page picked to be loud against
 *     ink, which is what makes it quiet against paper.
 *
 * TWO THINGS ARE TESTED HERE, and they cover different failures.
 *
 * 1. THE VERDICT, as a pure function. Three of the walk's five branches could
 *    be proven by breaking real markup — a deleted ring, a dim ring, a header
 *    dragged over the page — and were. The other two could not: staging a focus
 *    TRAP or a control with no rendered box means building the broken thing
 *    first, so they would have shipped never having executed. That is the exact
 *    complaint this issue makes about §7, and it is not worth repeating inside
 *    the fix for it.
 *
 * 2. THE ALPHA RULE, on source. The rendered walk is the real check, but it
 *    only runs where a surface is listed and only reaches forty tab stops. A
 *    new component pasted from the shadcn docs arrives carrying `ring-ring/50`,
 *    and if it lands on an unlisted surface nothing catches it. The colour is
 *    fine; the translucency is the defect, every time.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIN_FOCUS_CONTRAST, classifyFocusStop } from "../../../../scripts/focus-classify.mjs";

/** A stop that is fine, so each test can change exactly one thing. */
const OK = {
  tag: "button.tap-target",
  hidden: false,
  revisited: false,
  offscreen: false,
  obscured: false,
  hasIndicator: true,
  uaRing: false,
  contrast: 10.4,
};

describe("#238 the focus walk's verdict", () => {
  it("FA-1 passes a control with an opaque ring well clear of the bar", () => {
    expect(classifyFocusStop(OK, 3)).toBeNull();
  });

  it("FA-2 reports a control with no indicator at all (2.4.7)", () => {
    const fault = classifyFocusStop({ ...OK, hasIndicator: false }, 3);
    expect(fault?.kind).toBe("NO-FOCUS-RING");
    expect(fault?.detail).toContain("2.4.7");
  });

  it("FA-3 reports a ring under 3:1 and names the measurement (1.4.11)", () => {
    // The real number the app shipped with, so this test fails if the bar or
    // the arithmetic ever drifts back past the defect it was written for.
    const fault = classifyFocusStop({ ...OK, contrast: 2.63 }, 3);
    expect(fault?.kind).toBe("DIM-FOCUS-RING");
    expect(fault?.what).toContain("2.63:1");
    expect(fault?.detail).toContain("1.4.11");
  });

  it("FA-4 passes 3:1 exactly — the bar is a floor, not a gap", () => {
    expect(classifyFocusStop({ ...OK, contrast: MIN_FOCUS_CONTRAST }, 3)).toBeNull();
    expect(classifyFocusStop({ ...OK, contrast: MIN_FOCUS_CONTRAST - 0.01 }, 3)?.kind).toBe(
      "DIM-FOCUS-RING",
    );
  });

  it("FA-5 reports a control covered by an overlay (2.2's 2.4.11)", () => {
    const fault = classifyFocusStop({ ...OK, obscured: true }, 3);
    expect(fault?.kind).toBe("FOCUS-OBSCURED");
    expect(fault?.detail).toContain("2.4.11");
  });

  it("FA-6 reports a focus trap and stops the walk", () => {
    // Unreachable by breaking markup: a trap has to be built before it can be
    // caught. It is here precisely because it would otherwise never run.
    const fault = classifyFocusStop({ ...OK, revisited: true }, 12);
    expect(fault?.kind).toBe("FOCUS-LOOP");
    expect(fault?.stopWalk).toBe(true);
    expect(fault?.detail).toContain("12");
  });

  it("FA-7 reports focus landing on something with no rendered box", () => {
    const fault = classifyFocusStop({ ...OK, offscreen: true }, 3);
    expect(fault?.kind).toBe("FOCUS-INVISIBLE");
  });

  it("FA-8 ignores an aria-hidden subtree entirely", () => {
    // Hidden wins over every other verdict, including ones that would report.
    expect(
      classifyFocusStop({ ...OK, hidden: true, hasIndicator: false, obscured: true }, 3),
    ).toBeNull();
  });

  it("FA-9 accepts the browser's own ring without measuring its colour", () => {
    // Chrome paints `outline: auto` two-tone and ignores `outline-color`, so
    // the colour reported for it is one it never uses. Measuring it anyway
    // would fail the UA's accessible default.
    expect(classifyFocusStop({ ...OK, uaRing: true, contrast: 1.1 }, 3)).toBeNull();
    // But a UA ring does not excuse being covered, which is a different claim.
    expect(classifyFocusStop({ ...OK, uaRing: true, obscured: true }, 3)?.kind).toBe(
      "FOCUS-OBSCURED",
    );
  });

  it("FA-11a ignores an element Tab can never reach", () => {
    // Radix focuses its dropdown and dialog CONTAINERS on open so the reader
    // hears them announced. They carry `tabindex="-1"`, so no criterion about
    // the tab sequence applies — and the walk asking why a `<div>` had no focus
    // ring failed two portal surfaces for behaving correctly.
    expect(classifyFocusStop({ ...OK, programmatic: true, hasIndicator: false }, 3)).toBeNull();
  });

  it("FA-11b treats a cycle inside a modal as correct, and still ends the walk", () => {
    // §7 asks for focus never trapped in a SCROLL REGION. An open dialog is the
    // opposite case: 2.1.2 permits the trap because Escape is the way out, and
    // a dialog that let Tab wander back to the page behind it would be the bug.
    const verdict = classifyFocusStop({ ...OK, revisited: true, inModal: true }, 5);
    expect(verdict?.kind).toBeUndefined();
    expect(verdict?.stopWalk).toBe(true);

    // Outside a modal the same cycle is still a fault, or this branch would be
    // an off switch for the loop check rather than an exemption for dialogs.
    expect(classifyFocusStop({ ...OK, revisited: true, inModal: false }, 5)?.kind).toBe(
      "FOCUS-LOOP",
    );
  });

  it("FA-10 reports being obscured before blaming the ring", () => {
    // A ring hidden behind a sticky header is not a colour bug, and reporting
    // it as one sends the reader to change something that was never wrong.
    const fault = classifyFocusStop({ ...OK, obscured: true, contrast: 1.2 }, 3);
    expect(fault?.kind).toBe("FOCUS-OBSCURED");
  });
});

/**
 * Comments out, code in.
 *
 * FA-11 failed on its first run against a docblock — the one directly above the
 * fixed declaration in `globals.css`, explaining that it used to say
 * `outline-ring/50`. Prose describing a defect is not the defect, and a guard
 * that cannot tell them apart makes the fix unwritable: you would have to
 * choose between explaining the change and passing the check.
 *
 * Block comments go first, then whole lines that are `//` or a `*`
 * continuation. Deliberately not stripping trailing `//` — that would eat the
 * `//` in any URL sitting in a string literal, and a false PASS is the failure
 * that matters here.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/** Every `.tsx`/`.css` under `src`, which is where a pasted component lands. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("#238 the focus ring is never translucent", () => {
  const SRC = join(import.meta.dirname, "..");

  it("FA-11 no focus ring or outline is drawn through an alpha modifier", () => {
    // `ring-ring/50` and `outline-ring/50` are shadcn's stock softening, and
    // the softening IS the defect: --ring is a legal colour that fails only
    // once half of it is composited away. An alpha modifier on a focus
    // indicator has no legitimate use here — it can only ever make the ring
    // harder to see than the token it names.
    //
    // ANY focus ring colour, not `ring-ring` by name. Written the narrow way
    // first, this passed while `focus-visible:ring-destructive/20` sat on the
    // destructive button at 1.30:1 — the dimmest indicator in the product, on
    // the one button that deletes things. The rule was never about a token; it
    // is that a focus indicator is not translucent.
    //
    // Scoped to the `focus-visible:` variant deliberately. `aria-invalid:
    // ring-destructive/20` is a resting error tint that happens to be drawn as
    // a ring — it is not answering "where is the keyboard", and a translucent
    // wash is the right treatment for it.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = stripComments(readFileSync(file, "utf8"));
      const patterns = [
        /(?:dark:)?focus-visible:(?:ring|outline)-[a-z-]+\/\d+/g,
        /(?:ring|outline)-ring\/\d+/g,
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("FA-12 the base layer still sets a default outline colour", () => {
    // FA-11 passes just as well if the declaration is deleted outright, which
    // would leave every outline drawing in currentColor — a white-labelled
    // control ringing itself in white, the #116 shape. The rule has to be
    // present AND opaque.
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).toMatch(/@apply\s+border-border\s+outline-ring\s*;/);
  });
});
