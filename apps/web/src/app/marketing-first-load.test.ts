import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the marketing home and pricing pages make a phone download before it
 * can hydrate.
 *
 * The app catalogue (every section of `i18n/catalog.ts`, both languages,
 * about 590 KB) reached the mobile home page through three imports: the root
 * error boundaries calling `useT()`, the nav's mobile sheet reading its close
 * label through `useT()`, and the SERVER thread demos importing
 * `formatCallDuration` from `lib/format/call.ts`, which imports
 * `@/i18n/provider`. The third needs no rendering: a server module importing
 * a `"use client"` module makes it a client reference, and Next ships every
 * client reference in the page's server graph. So the rules are on the import
 * graph, not on usage.
 *
 * Walking the static imports (a dynamic `import()` is a separate, later
 * chunk) from each page and the layouts and boundaries that wrap it:
 *
 * 1. No reachable module imports `@/i18n/provider`.
 * 2. No module below a `"use client"` boundary imports the app catalogue or
 *    the home catalogue (the whole home page, both languages).
 *
 * And no marketing module loads the full `p5` build; the sketch draws with
 * `hero/p5-lean.ts`.
 */

const SRC = resolve(import.meta.dirname, "..");

const ENTRIES = [
  "app/layout.tsx",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/(marketing)/layout.tsx",
  "app/(marketing)/page.tsx",
  "app/(marketing)/pricing/page.tsx",
  "app/(marketing-fr)/layout.tsx",
  "app/(marketing-fr)/fr/page.tsx",
  "app/(marketing-fr)/fr/tarifs/page.tsx",
];

const PROVIDER = join(SRC, "i18n", "provider.tsx");
const CLIENT_FORBIDDEN = new Map([
  [join(SRC, "i18n", "catalog.ts"), "the app catalogue (every section, both languages)"],
  [join(SRC, "i18n", "marketing", "home.ts"), "the home catalogue (the whole page, both languages)"],
]);

/** So an import quoted in a doc comment is not read as one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Static import specifiers. Type-only imports and dynamic `import()` are skipped. */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    if (m[1]) continue;
    out.push(m[2]);
  }
  return out;
}

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package; not this app's graph
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface Finding {
  importer: string;
  target: string;
  why: string;
}

function walk(): { visited: Map<string, boolean>; findings: Finding[] } {
  // Value: whether the module is reached in client context.
  const visited = new Map<string, boolean>();
  const findings: Finding[] = [];
  const queue: [string, boolean][] = ENTRIES.map((e) => [join(SRC, e), false]);
  while (queue.length > 0) {
    const [file, inherited] = queue.shift()!;
    const source = stripComments(readFileSync(file, "utf8"));
    const isClient = inherited || /^\s*["']use client["']/.test(source);
    const seen = visited.get(file);
    // Revisit only when a module is first reached as client code.
    if (seen === true || (seen === false && !isClient)) continue;
    visited.set(file, isClient);
    for (const spec of staticImports(source)) {
      const target = resolveSpecifier(file, spec);
      if (!target) continue;
      if (target === PROVIDER) {
        findings.push({
          importer: file,
          target,
          why: isClient
            ? "a client module importing the provider ships the whole app catalogue"
            : "a server module importing the provider makes it a client reference, " +
              "and Next ships every client reference with the page",
        });
        continue;
      }
      const forbidden = CLIENT_FORBIDDEN.get(target);
      if (isClient && forbidden) {
        findings.push({ importer: file, target, why: `client code imports ${forbidden}` });
        continue;
      }
      queue.push([target, isClient]);
    }
  }
  return { visited, findings };
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");

describe("the marketing home and pricing pages' first load", () => {
  const { visited, findings } = walk();
  const clientModules = [...visited].filter(([, c]) => c).map(([f]) => rel(f));

  it("walked the graph through the client boundary, so a pass means something", () => {
    console.info(
      `marketing-first-load: walked ${visited.size} modules from ${ENTRIES.length} entries, ` +
        `${clientModules.length} of them client code`,
    );
    expect(visited.size).toBeGreaterThan(50);
    for (const must of [
      "components/marketing/hero/hero.tsx",
      "components/marketing/hero/hero-inbox.tsx",
      "components/marketing/nav.tsx",
      "components/marketing/thread-demo/thread-primitives.tsx",
    ]) {
      expect(
        [...visited.keys()].map(rel),
        `the walk never reached ${must}, so it is not testing the page`,
      ).toContain(must);
    }
    expect(clientModules).toContain("components/marketing/hero/hero-inbox.tsx");
  });

  it("ships neither the i18n provider nor a two-language catalogue", () => {
    expect(
      findings.map((f) => `${rel(f.importer)} -> ${rel(f.target)}: ${f.why}`),
      "These put the app catalogue (about 590 KB, both languages) or a whole " +
        "page's copy in both languages on the marketing first load. Import the " +
        "one module you need instead (e.g. lib/format/call-duration.ts, " +
        "components/ui/sheet-base.tsx, app/boundary-copy.ts), or pass the words " +
        "down from a server component.",
    ).toEqual([]);
  });
});

describe("the hero loads the lean p5", () => {
  const MARKETING = join(SRC, "components", "marketing");
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collect(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
    }
  };
  collect(MARKETING);
  // A value import of the package root, static or dynamic. `import type` is
  // erased and costs nothing.
  const FULL_P5 =
    /(?:import\s+(?!type\b)[\w*{}\s,$]+\s+from\s+|import\s*\(\s*)["']p5["']/;

  it("scanned the marketing components", () => {
    console.info(`marketing-first-load: scanned ${files.length} marketing modules for p5`);
    expect(files.length).toBeGreaterThan(50);
    expect(files.map(rel)).toContain("components/marketing/hero/arrival-field.tsx");
  });

  it("never imports the full p5 build", () => {
    expect(
      files.filter((f) => FULL_P5.test(stripComments(readFileSync(f, "utf8")))).map(rel),
      'import("p5") is the whole browser build, about 1 MB of script. The ' +
        "sketch draws with components/marketing/hero/p5-lean.ts; register the " +
        "addon you need there instead.",
    ).toEqual([]);
  });

  it("composes p5 from its core", () => {
    const lean = readFileSync(join(MARKETING, "hero", "p5-lean.ts"), "utf8");
    expect(lean).toMatch(/from\s+["']p5\/core["']/);
  });
});
