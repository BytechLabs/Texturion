import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WCAG AA regression tests for the app-scope token pairs (issues #26 / #61).
 *
 * APP-UI-ELEVATION §6 binds 4.5:1 text contrast — including petrol-on-tint —
 * verified in BOTH themes. These tests parse the actual hex tokens out of
 * globals.css and recompute the ratios, so a future palette tweak that drops a
 * pair below AA fails CI instead of shipping an unreadable inbox.
 */

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

/** Slice a top-level block: from its selector line to the first `}` at col 0. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector "${selector}" exists in globals.css`).toBeGreaterThan(
    -1,
  );
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

/** Read a 6-digit hex custom property out of a block. */
function token(blockCss: string, name: string): string {
  const m = blockCss.match(
    new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*(#[0-9a-fA-F]{6})`),
  );
  expect(m, `token ${name} is a 6-digit hex`).not.toBeNull();
  return m![1].toLowerCase();
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  );
}

/** WCAG contrast ratio between two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
/** WCAG 1.4.11: UI component boundaries and state indicators. */
const UI = 3;

const light = block(".app-scope");
const dark = block(".dark .app-scope,\n.app-scope.dark,\n.app-scope .dark");

/** The grounds quiet text actually sits on: paper, card, hover/chip fill. */
function grounds(theme: string): Record<string, string> {
  return {
    "app-stone-0 (paper)": token(theme, "--app-stone-0"),
    "app-white (card)": token(theme, "--app-white"),
    "app-stone-1 (hover/chip)": token(theme, "--app-stone-1"),
  };
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("app-scope %s theme", (label, theme) => {
  it("#61 — --app-muted clears AA on every ground it carries text on", () => {
    const fg = token(theme, "--app-muted");
    for (const [name, bg] of Object.entries(grounds(theme))) {
      expect
        .soft(contrast(fg, bg), `--app-muted ${fg} on ${name} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  it("#61 — --app-muted-2 (row timestamps, kbd hints) clears AA", () => {
    const fg = token(theme, "--app-muted-2");
    for (const [name, bg] of Object.entries(grounds(theme))) {
      expect
        .soft(contrast(fg, bg), `--app-muted-2 ${fg} on ${name} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  it("#61 — --muted-foreground (delivery state, secondary labels) clears AA", () => {
    const fg = token(theme, "--muted-foreground");
    for (const [name, bg] of Object.entries(grounds(theme))) {
      expect
        .soft(contrast(fg, bg), `--muted-foreground ${fg} on ${name} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  // #362: FILLS AND THEIR OWN FOREGROUNDS, one group per fill.
  //
  // These were a single assertion over three fills sharing one foreground,
  // which was true only because all three were petrol. Paper & Olive splits
  // what the web collapsed: its `primary` is INK, olive is the TEXT accent, and
  // lime is the highlight FILL — and lime needs an ink label where ink needs a
  // paper one. One shared foreground cannot AA against both (paper on lime is
  // 1.47:1), so the grouping had to change before any value could.
  //
  // Still one group each today, because the values are still petrol. That is
  // the point: this lands green and is ready to express the split.
  it("#26/#362 — every fill AAs against the foreground it actually paints with", () => {
    const pairs: [string, string, string][] = [
      // [label, fill token, its paired foreground token]
      ["--app-petrol", "--app-petrol", "--app-petrol-foreground"],
      ["--primary", "--primary", "--primary-foreground"],
      // The composer Send hover fill (hover:bg-app-petrol-deep).
      ["--app-petrol-deep", "--app-petrol-deep", "--app-petrol-foreground"],
    ];
    for (const [label, fillToken, fgToken] of pairs) {
      const bg = token(theme, fillToken);
      const fg = token(theme, fgToken);
      expect
        .soft(contrast(fg, bg), `${fgToken} ${fg} on ${label} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  // #362 — THE ASSERTION THAT WAS MISSING, and the one that matters most here.
  //
  // Nothing checked the accent used as TEXT — only as a fill. That is exactly
  // the gap Paper & Olive falls into: olive #66801F is 4.04:1 on its own
  // ground, so it fails AA as a link, count or emphasis, which is precisely
  // what MOBILE-DESIGN.md assigns it to. Both phones ship that today (#238).
  //
  // Petrol passes comfortably (5.28 light, 7.15 dark), so this is green now and
  // will go red the moment an accent that cannot carry small text is adopted.
  // When that happens the answer is a darker palette member for text, NOT
  // lowering this bar.
  it("#362 — the accent clears AA as TEXT, not merely as a fill", () => {
    const fg = token(theme, "--app-petrol");
    for (const [name, bg] of Object.entries(grounds(theme))) {
      expect
        .soft(contrast(fg, bg), `accent-as-text ${fg} on ${name} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  // #362 — the focus ring is a UI component boundary (WCAG 1.4.11), so 3:1
  // rather than 4.5:1. Asserted against the paper ground it is drawn on.
  it("#362 — the focus ring clears 3:1 against the ground it is drawn on", () => {
    const ring = token(theme, "--ring");
    const paper = token(theme, "--app-stone-0");
    expect(
      contrast(ring, paper),
      `--ring ${ring} on --app-stone-0 ${paper}`,
    ).toBeGreaterThanOrEqual(UI);
  });

  it("#26 — --primary-foreground matches the on-petrol pair (shadcn fills)", () => {
    expect(token(theme, "--primary-foreground")).toBe(
      token(theme, "--app-petrol-foreground"),
    );
  });
});

describe("app-scope guardrails in globals.css", () => {
  // #362 — moved here from the marketing suite (fr-tokens.test.ts), where an
  // app-scope assertion made the two surfaces impossible to sequence apart.
  // The VALUE changes when the app converges on olive; asserting it at all is
  // what stops the accent drifting silently, which is why it moved rather than
  // being deleted.
  it("#26/#362 — the app scope anchors its accent and fill on one declared pair", () => {
    expect(css).toMatch(/\.app-scope[\s\S]*?--primary:\s*#0f766e/i);
    expect(css).toMatch(/--app-petrol:\s*#0f766e/i);
  });

  it("#26 — petrol fills enforce the paired foreground at the token level", () => {
    // The unlayered override that keeps a stray `text-white` on bg-primary /
    // bg-app-petrol from shipping a 2.6:1 dark-mode pair (composer Send,
    // count badges).
    expect(css).toMatch(
      /\.app-scope \.bg-primary,\s*\.app-scope \.bg-app-petrol \{\s*color: var\(--app-petrol-foreground\);/,
    );
    // The outbound bubble utility carries its own text pair.
    expect(css).toMatch(
      /@utility app-bubble-out \{[^}]*color: var\(--app-petrol-foreground\);/,
    );
  });

  it("#65 — the 600 weight ceiling catches stray font-bold in the app scope", () => {
    expect(css).toMatch(
      /\.app-scope \.font-bold \{\s*font-weight: 600;\s*\}/,
    );
  });
});
