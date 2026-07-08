import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The v4 "FIRST RESPONSE" token system (DESIGN-DIRECTION §2) is defined in
 * globals.css under the marketing scope. These guards pin the palette hexes
 * to the direction's table, keep the app's petrol system intact, and keep
 * the dead v3 palette dead.
 */
const css = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

describe("globals.css — the --fr-* system (direction §2)", () => {
  it("defines every v4 token at the direction's exact value", () => {
    const expected: Record<string, string> = {
      "--fr-ground": "#fbfcfe",
      "--fr-card": "#ffffff",
      "--fr-ink": "#10173b",
      "--fr-ink-70": "#3f4563",
      "--fr-ink-55": "#5a6080",
      "--fr-cobalt": "#2740de",
      "--fr-cobalt-deep": "#1f33b8",
      "--fr-green": "#0b7a50",
      "--fr-flare": "#ff4a1f",
      "--fr-frost": "#edf2fb",
    };
    for (const [token, hex] of Object.entries(expected)) {
      expect(css, `${token} must be ${hex}`).toMatch(
        new RegExp(`${token}:\\s*${hex}`, "i"),
      );
    }
  });

  it("carries the one card shadow (§2), verbatim ink-tinted pair", () => {
    expect(css).toContain("--fr-shadow-card:");
    expect(css).toMatch(/0 1px 2px rgba\(16, 23, 59, 0\.06\)/);
    expect(css).toMatch(/0 8px 24px rgba\(16, 23, 59, 0\.06\)/);
  });

  it("scopes the system to the marketing root (.mkt-scope, with .marketing honored)", () => {
    expect(css).toMatch(/\.mkt-scope,\s*\.marketing\s*\{/);
  });

  it("keeps the APP's petrol system untouched (Law 2: marketing never repaints the product)", () => {
    // The app scope still anchors on petrol #0F766E.
    expect(css).toMatch(/\.app-scope[\s\S]*?--primary:\s*#0f766e/i);
    expect(css).toMatch(/--app-petrol:\s*#0f766e/i);
  });

  it("the v3 palette is dead: no night grounds, no porch amber, no copper literals", () => {
    for (const deadHex of ["#041f1c", "#02110f", "#ffb454", "#9a4f26", "#c06a3b", "#3fd5c0"]) {
      expect(css.toLowerCase(), `${deadHex} must not survive`).not.toContain(
        deadHex,
      );
    }
  });

  it("v4 type utilities exist for the page crews (§3)", () => {
    for (const util of [
      "@utility fr-h1",
      "@utility fr-h2",
      "@utility fr-h3",
      "@utility fr-body",
      "@utility fr-eyebrow",
      "@utility fr-mono-data",
      "@utility fr-figure",
      "@utility fr-card",
    ]) {
      expect(css).toContain(util);
    }
    // The mono law: tabular figures wherever data renders.
    expect(css).toMatch(/fr-mono-data[\s\S]*?tabular-nums/);
  });

  it("scroll reveals use the §4 motion spec (400ms, the v4 curve, once)", () => {
    expect(css).toMatch(/400ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  });
});

describe("fonts.ts — the v4 trio via next/font/google (§3)", () => {
  const fonts = readFileSync(
    join(process.cwd(), "src", "lib", "marketing", "fonts.ts"),
    "utf8",
  );

  it("loads Bricolage Grotesque / Hanken Grotesk / Spline Sans Mono with the direction's variables", () => {
    expect(fonts).toContain("Bricolage_Grotesque");
    expect(fonts).toContain("Hanken_Grotesk");
    expect(fonts).toContain("Spline_Sans_Mono");
    expect(fonts).toContain('variable: "--font-display"');
    expect(fonts).toContain('variable: "--font-body"');
    expect(fonts).toContain('variable: "--font-mono"');
    expect(fonts).toMatch(/axes:\s*\["opsz",\s*"wdth"\]/);
    expect(fonts).toMatch(/weight:\s*\["400",\s*"500"\]/);
  });

  it("the v3 faces are gone from the font wiring", () => {
    expect(fonts).not.toMatch(/besley|public.?sans|martian/i);
  });
});
