import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #429 — a font we serve must ship its license.
 *
 * SIL OFL 1.1 §2 permits redistribution "provided that each copy contains the
 * above copyright notice and this license", and serving a `.woff2` from our own
 * origin IS redistribution. Inter was served for a whole release with no license
 * on file — not through carelessness, but because the obligation was met by
 * whoever added each font, from whatever they happened to read, and Inter
 * arrived beside a Golos Text whose OFL was already filed.
 *
 * That is the failure mode this guards: not malice, memory. So it derives the
 * font list from what is actually LOADED rather than from a list somebody has to
 * remember to update — a hardcoded list would have passed the whole time.
 *
 * `next/font/google` counts, and is still read for that reason even though
 * #612 left us with none: Next downloads those faces at build time and
 * self-hosts them from our origin — it does not hot-link Google — so they
 * redistribute exactly like the local files, and the next one somebody adds
 * has to be caught.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB = join(REPO, "apps", "web");
const FONTS_DIR = join(WEB, "src", "app", "fonts");
const LICENSES_DIR = join(FONTS_DIR, "licenses");

/** Every `.woff2` we ship, reduced to the family that owns its license. */
function selfHostedFamilies(): string[] {
  const families = readdirSync(FONTS_DIR)
    .filter((f) => f.endsWith(".woff2"))
    .map((f) =>
      f
        .replace(/\.woff2$/, "")
        // "InterVariable-Italic" and "InterVariable" are both Inter.
        .replace(/-(Italic|Regular|Bold|Moonlight)$/i, "")
        .replace(/Variable$/, ""),
    );
  return [...new Set(families)];
}

/**
 * Families pulled from Google. The imported identifier IS the family name, so
 * this reads what the code actually loads instead of a list kept by hand.
 */
function googleFamilies(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // Test files mock next/font; only real imports count.
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      const importBlock = /import\s*\{([^}]*)\}\s*from\s*["']next\/font\/google["']/g;
      for (const match of source.matchAll(importBlock)) {
        for (const raw of match[1].split(",")) {
          const name = raw.trim();
          if (name) found.add(name.replace(/_/g, ""));
        }
      }
    }
  };
  walk(join(WEB, "src"));
  return [...found];
}

const licenseFiles = readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".txt"));
const readme = readFileSync(join(LICENSES_DIR, "README.md"), "utf8");

const shipped = [...selfHostedFamilies(), ...googleFamilies()].sort();

describe("#429 every font we serve ships its license", () => {
  it("finds the fonts by reading what is loaded, so the guard cannot go blind", () => {
    // If a refactor hides the fonts behind a helper this collapses to zero and
    // every assertion below would pass while checking nothing.
    //
    // The floor is on the COMBINED count, not on each loader. It used to
    // require three Google families, which pinned HOW the fonts were loaded
    // rather than the thing that matters — and #612 moved all three to
    // `next/font/local` for a build-reliability reason having nothing to do
    // with licences, so a guard about redistribution failed a change that
    // redistributed exactly the same five files. Zero Google fonts is now the
    // healthy state; zero fonts ALTOGETHER never is.
    expect(shipped.length).toBeGreaterThanOrEqual(5);
    // The exact set today. Deliberately pinned: a new font should make somebody
    // read this file, since the license is the point.
    expect(shipped).toEqual([
      "BricolageGrotesque",
      "GolosText",
      "HankenGrotesk",
      "Inter",
      "SplineSansMono",
    ]);
  });

  it("has a license file for every family", () => {
    const missing = shipped.filter(
      (family) => !licenseFiles.includes(`${family}-OFL.txt`),
    );
    expect(missing).toEqual([]);
  });

  it("ships real license text, not an empty placeholder", () => {
    for (const file of licenseFiles) {
      const text = readFileSync(join(LICENSES_DIR, file), "utf8");
      // A copyright line AND the license body — the OFL requires both to
      // travel together, so half of it satisfies nothing.
      expect(text, `${file} has no copyright line`).toMatch(/Copyright\s/i);
      expect(text, `${file} is missing the license body`).toContain(
        "SIL OPEN FONT LICENSE",
      );
      expect(text.length, `${file} is too short to be a license`).toBeGreaterThan(
        3000,
      );
    }
  });

  it("lists every family in the README beside its license file", () => {
    // The files alone are not the deliverable — somebody has to be able to see
    // WHICH font each one covers and where it renders.
    for (const family of shipped) {
      expect(readme, `README does not cite ${family}-OFL.txt`).toContain(
        `${family}-OFL.txt`,
      );
    }
  });

  it("keeps no license for a font that is no longer served", () => {
    // A stale license is a smaller problem than a missing one, but it is how
    // this table stops describing reality.
    const orphans = licenseFiles.filter(
      (file) => !shipped.includes(file.replace("-OFL.txt", "")),
    );
    expect(orphans).toEqual([]);
  });
});
