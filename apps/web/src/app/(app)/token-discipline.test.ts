import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #320 — a literal colour in an app component is how a theme bug gets authored.
 *
 * Theme bugs kept arriving one at a time, found by a person happening to toggle:
 * mobile auth screens unreadable in light mode (#218), map pins illegible in dark
 * (#219), hovered rows invisible in light, a hover state that never lit up, a
 * storage-breakdown slice nobody could see. Each was fixed properly. The pattern
 * was the problem — nothing verified both themes, so correctness depended on
 * somebody remembering.
 *
 * WHY THIS CHECK AND NOT SCREENSHOTS. #320's own devil's advocate is right that
 * pixel-diff visual regression produces noisy diffs that get rubber-stamped, which
 * turns a quality gate into a rubber stamp and is worse than nothing. It names the
 * better instrument: assert on TOKEN USAGE rather than pixel equality, because a
 * token failure means something is genuinely wrong.
 *
 * This is that instrument. A component that reads `var(--app-*)` or a Tailwind
 * token class gets light and dark for free, because the token is what changes
 * between them. A hex literal gets whichever mode its author had open.
 *
 * The measurement that justified the shape: 18 files in `apps/web/src` carry hex
 * literals, and the app-side ones are *the same files that had the theme bugs* —
 * auth, tasks/map, settings. That correlation is the argument.
 *
 * WHAT THIS DOES NOT COVER, said plainly so nobody reads it as more than it is:
 * contrast ratios (needs rendered output) and the phone clients (their own token
 * systems, their own harness). Both are #320's remaining scope.
 */

const APP_SRC = join(process.cwd(), "src");

/**
 * Colour literals worth failing on. Deliberately narrow: 6- and 8-digit hex, plus
 * `rgb()`/`hsl()` calls with numeric arguments. NOT 3-digit hex — `#fff` on a map
 * marker's border is a hairline against a photographic tile, not a themed surface,
 * and widening this to catch it would make the check argue about things that are
 * fine. A guard with false positives gets switched off.
 */
const LITERAL = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|\b(?:rgb|hsl)a?\(\s*[\d.]/;

/**
 * Shadows are exempt, and this is a narrowing rather than a loophole.
 *
 * A drop shadow is a dark translucent smudge in *both* themes — that is what a
 * shadow is — so `rgba(41,37,36,.35)` in a `box-shadow` is not a mode-dependent
 * decision the way a background is. None of the bugs #320 lists was a shadow.
 * Routing them through a token would make the check argue about something that is
 * fine, and a guard that argues about fine things is a guard people switch off.
 */
function withoutShadows(line: string): string {
  return line.replace(/(?:box|text)-shadow\s*:[^;"'`]*/g, "");
}

/**
 * Files that may hold a literal, each with the reason it is not a theming bug.
 *
 * Every entry is a claim that the file draws somewhere the app's tokens do not
 * reach. "Add it to the list" is how a guard stops guarding, so a new entry needs
 * a reason of that kind and not a convenience.
 */
const ALLOWED = new Map<string, string>([
  [
    "app/global-error.tsx",
    "replaces the root layout, so it renders with no guarantee the app stylesheet " +
      "loaded at all — a token here could resolve to nothing on the one screen " +
      "whose job is to work when everything else did not",
  ],
  [
    "app/error.tsx",
    "same reason as global-error: an error boundary must not depend on the styling " +
      "of the thing that just failed",
  ],
  [
    "app/not-found.tsx",
    "rendered outside the authenticated shell, where the app token scope is absent",
  ],
  [
    "app/manifest.ts",
    "the PWA theme colour IS a literal by specification — the operating system " +
      "reads the value, and it has no concept of our tokens",
  ],
  [
    "app/layout.tsx",
    "the `theme-color` meta and the mask-icon colour are read by the browser " +
      "chrome, not by our CSS",
  ],
  [
    "components/auth/oauth-buttons.tsx",
    "Google's four brand colours in their logo. Their brand guidelines require " +
      "these exact values, and theming them would make the button unrecognisable " +
      "as the thing it is",
  ],
  [
    "components/brand/brand-mark.tsx",
    "the logo. A mark whose colour changes with the interface is not a mark",
  ],
  [
    "components/shell/wordmark.tsx",
    "same as brand-mark: brand identity, deliberately constant",
  ],
  [
    "components/settings/version-footer.tsx",
    "the wordmark's second 'o' in brand olive — the same brand treatment as " +
      "wordmark.tsx, and it already carries an explicit dark: variant rather than " +
      "assuming one mode",
  ],
  [
    "app/og/blog/[slug]/route.tsx",
    "an Open Graph image, rendered server-side to a PNG for a social platform. " +
      "There is no theme to follow: the viewer is Twitter or LinkedIn, and no " +
      "stylesheet of ours reaches it",
  ],
]);

/** Every non-test source file under apps/web/src, excluding the marketing tree. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // The marketing site has its OWN palette and its own theme handling
        // (#362: cobalt marketing, petrol app, olive mobile). It is #320's scope
        // too, but it is a different token system and lumping the two together
        // would make this check unable to say anything precise about either.
        if (entry.name === "marketing" || entry.name === "(marketing)") continue;
        walk(path);
      } else if (
        [".ts", ".tsx"].includes(extname(entry.name)) &&
        !entry.name.includes(".test.")
      ) {
        out.push(path);
      }
    }
  };
  walk(APP_SRC);
  return out;
}

describe("#320 app components take their colours from tokens", () => {
  it("has no colour literal outside the reasoned exceptions", () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      const rel = relative(APP_SRC, file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (LITERAL.test(withoutShadows(line))) offenders.push(`${rel}:${index + 1}`);
      });
    }

    expect(
      offenders,
      `\n\nColour literal(s) in app code:\n  ${offenders.join("\n  ")}\n\n` +
        `A literal gets whichever theme its author had open. Use a token — ` +
        `var(--app-*) or the Tailwind class — and both modes follow for free.\n\n` +
        `If this file genuinely draws where app tokens do not reach (an error ` +
        `boundary outside the shell, a brand mark, an OS-read manifest value), add ` +
        `it to ALLOWED with that reason. Convenience is not a reason.\n`,
    ).toEqual([]);
  });

  it("keeps every exception justified by a reason, not a filename", () => {
    // A guard whose allow-list can grow silently is a guard that stops guarding.
    for (const [file, reason] of ALLOWED) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it("has no stale exception", () => {
    // An allow-list entry for a file that no longer has a literal is an invitation
    // to put one back without noticing.
    const stale: string[] = [];
    for (const [rel] of ALLOWED) {
      const path = join(APP_SRC, rel.split("/").join(sep));
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        stale.push(`${rel} (file is gone)`);
        continue;
      }
      if (!text.split(/\r?\n/).some((line) => LITERAL.test(line))) {
        stale.push(`${rel} (no literal left)`);
      }
    }
    expect(stale, `remove these from ALLOWED:\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});
