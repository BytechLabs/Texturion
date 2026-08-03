/**
 * #238 — the motion promise, checked by something other than goodwill.
 *
 * `scripts/theme-audit.mjs` runs an accessibility pass in CI and says plainly
 * what it does not cover:
 *
 * > Focus appearance (2.4.11) needs a rendered focus ring compared against its
 * > surround, and reduced motion needs a second pass under an emulated media
 * > query. Both are real and both belong here later; neither is measurable in
 * > this pass without producing the kind of noisy near-miss that gets a gate
 * > rubber-stamped.
 *
 * That judgement is right about the RENDERED check. A pass that walks every
 * element looking for a surviving transition reports mostly near-misses, and
 * #320's warning applies: a firehose gets muted, and a muted gate is worse than
 * none.
 *
 * But the expensive question is binary and needs no renderer. WCAG 2.3.3 is
 * honoured here by one base rule that zeroes motion for everything, plus
 * per-component blocks for the animations that need more than zeroing. The
 * failure that actually costs a user is not a near-miss on one transition, it
 * is that base rule being weakened or deleted — after which every animation in
 * the product plays for somebody whose vestibular disorder is why they set the
 * preference.
 *
 * Reading the stylesheet answers that, cheaply and without a false positive to
 * its name. It is deliberately NOT a general motion audit: it asserts the
 * mechanism exists and still does its job, and claims nothing about any
 * individual animation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

/** The `@media (prefers-reduced-motion: reduce)` blocks, brace-balanced. */
function reducedMotionBlocks(): string[] {
  const marker = "@media (prefers-reduced-motion: reduce)";
  const blocks: string[] = [];
  let from = CSS.indexOf(marker);
  while (from !== -1) {
    const open = CSS.indexOf("{", from);
    let depth = 0;
    let i = open;
    for (; i < CSS.length; i += 1) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(CSS.slice(from, i + 1));
    from = CSS.indexOf(marker, i);
  }
  return blocks;
}

describe("#238 prefers-reduced-motion is honoured", () => {
  it("reads a real stylesheet, so a pass means something", () => {
    expect(CSS.length).toBeGreaterThan(10_000);
    expect(reducedMotionBlocks().length).toBeGreaterThan(0);
  });

  it("has a universal block, not only per-component ones", () => {
    // The catch-all is what makes the promise hold for an animation nobody
    // remembered. A product that honours the preference only where somebody
    // thought to is one where the next component silently does not.
    const universal = reducedMotionBlocks().find(
      (block) => /(^|[\s,{])\*\s*,/.test(block) || /\{\s*\*\s*,/.test(block),
    );
    expect(
      universal,
      "no `*` selector inside any prefers-reduced-motion block: the catch-all " +
        "that covers animations nobody remembered is gone",
    ).toBeDefined();
  });

  it("actually zeroes motion, rather than merely mentioning it", () => {
    // A block that exists but sets nothing is the failure this would otherwise
    // miss: the media query reads as compliance in a diff while changing
    // nothing on screen.
    const universal = reducedMotionBlocks().find((b) => /\*\s*,/.test(b)) ?? "";
    for (const property of [
      "animation-duration",
      "animation-iteration-count",
      "transition-duration",
      "scroll-behavior",
    ]) {
      expect(universal, `universal block does not set ${property}`).toContain(
        property,
      );
    }
  });

  it("wins against component styles, or it does not win at all", () => {
    // Specificity: a component animation set on a class beats `*` every time,
    // so the reset needs !important to mean anything. Without it the rule is
    // present, readable, and inert.
    const universal = reducedMotionBlocks().find((b) => /\*\s*,/.test(b)) ?? "";
    // Whole lines that are declarations, rather than a regex over the blob:
    // the media-query line itself reads as `property: value` to a loose
    // pattern, and matching it made an earlier version of this assertion pass
    // for the wrong reason.
    const declarations = universal
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[a-z-]+\s*:\s*[^;]+;$/.test(line));
    expect(declarations.length).toBeGreaterThan(2);
    for (const declaration of declarations) {
      expect(declaration, `not !important: ${declaration}`).toContain(
        "!important",
      );
    }
  });

  it("covers pseudo-elements, where decorative motion usually lives", () => {
    // Spinners and shimmer are drawn in ::before/::after more often than not,
    // and a reset that stops at real elements leaves exactly the decorative
    // motion this preference exists to stop.
    const universal = reducedMotionBlocks().find((b) => /\*\s*,/.test(b)) ?? "";
    expect(universal).toContain("::before");
    expect(universal).toContain("::after");
  });
});
