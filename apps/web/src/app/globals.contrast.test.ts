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

  it("#26 — the on-petrol foreground pairs AA with every petrol fill", () => {
    const fg = token(theme, "--app-petrol-foreground");
    const fills = {
      "--app-petrol": token(theme, "--app-petrol"),
      "--primary": token(theme, "--primary"),
      // The composer Send hover fill (hover:bg-app-petrol-deep).
      "--app-petrol-deep": token(theme, "--app-petrol-deep"),
    };
    for (const [name, bg] of Object.entries(fills)) {
      expect
        .soft(contrast(fg, bg), `on-petrol fg ${fg} on ${name} ${bg}`)
        .toBeGreaterThanOrEqual(AA);
    }
  });

  it("#26 — --primary-foreground matches the on-petrol pair (shadcn fills)", () => {
    expect(token(theme, "--primary-foreground")).toBe(
      token(theme, "--app-petrol-foreground"),
    );
  });
});

describe("app-scope guardrails in globals.css", () => {
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
