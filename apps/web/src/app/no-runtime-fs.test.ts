import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A page renders on the SERVER, and this server is not a filesystem.
 *
 * ## What happened
 *
 * Three legal pages — the accessibility statement, the DPA and the
 * vulnerability-disclosure policy — were generated from markdown with
 * `readFileSync(join(process.cwd(), "..", "..", "docs", …))`. That is correct
 * in `next dev`, correct in `next build`, and **fatal in production**: the
 * deployed Worker carries no repo and reports `process.cwd()` as `/`, so the
 * path resolved to `/docs/ACCESSIBILITY.md` and the render threw. Each page
 * answered **HTTP 500 from the day it shipped** — including the published
 * accessibility conformance statement, which exists to be handed to a buyer.
 *
 * Nothing caught it. Every gate this repo runs is a build or a Node test, and
 * `fs` works in both. The page prerendered locally, the HTML appeared in
 * `.next`, `next build` was green, and the route was still 500 on the wire.
 *
 * ## Why the rule is "no fs at all" rather than "no bad paths"
 *
 * A correct-looking path is exactly what shipped. `process.cwd()` was a
 * reasonable guess that happens to differ between the two machines this code
 * runs on, and no amount of care about the path fixes the category: the
 * request-time environment has no repo in it. So the check is on the IMPORT,
 * which is mechanical and has no judgement in it.
 *
 * Read the document with an `import` instead — `next.config.ts` turns a `.md`
 * import into its text at build time, so it travels inside the bundle. See
 * `src/markdown.d.ts`.
 *
 * ## Scope
 *
 * `src/app/**` only — the request path. Tests, scripts and build tooling read
 * files legitimately and are excluded by extension and by directory.
 */

const APP = join(import.meta.dirname);

/** `node:fs`, bare `fs`, and the promises flavours of each. */
const FS_IMPORT =
  /\bfrom\s+["'](?:node:)?fs(?:\/promises)?["']|\brequire\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|\bimport\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // A test beside a page is not the request path.
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("no page reads the filesystem while rendering", () => {
  const files = walk(APP);

  it("walked the app tree, so a passing run means something", () => {
    // The failure mode of every tree-derived check: a path that resolves to
    // nothing makes each assertion below vacuously true. This repo has shipped
    // one of those.
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.some((f) => f.includes("legal")),
      "the walk never reached the legal pages, which are what this is about",
    ).toBe(true);
  });

  it("imports no fs module anywhere under src/app", () => {
    const offenders = files.filter((f) => FS_IMPORT.test(readFileSync(f, "utf8")));
    expect(
      offenders.map((f) => f.slice(f.indexOf("src"))),
      "These render on a Worker with no repo on disk and process.cwd() === '/'. " +
        "Reading a file here is a 500 that every local gate reports as green — " +
        "it is how the accessibility statement, the DPA and the vulnerability " +
        "policy were all 500 in production from the day they shipped. Import " +
        "the document instead; .md imports are inlined at build time.",
    ).toEqual([]);
  });

  it("the three pages that caused this read their document by import", () => {
    // Named individually, because "no fs" would also pass if somebody deleted
    // the pages. What has to stay true is that they still publish the document.
    const pages: [string, string][] = [
      ["legal/accessibility/page.tsx", "@root/docs/ACCESSIBILITY.md"],
      ["legal/dpa/page.tsx", "@root/docs/DPA.md"],
      ["legal/vulnerability-disclosure/page.tsx", "@root/SECURITY.md"],
    ];
    for (const [rel, spec] of pages) {
      const path = files.find((f) => f.replace(/\\/g, "/").endsWith(rel));
      expect(path, `${rel} is gone`).toBeTruthy();
      expect(
        readFileSync(path!, "utf8"),
        `${rel} no longer imports ${spec}`,
      ).toContain(spec);
    }
  });
});

/**
 * The escape route out of `fs` has to exist in BOTH bundlers.
 *
 * The guard above bans `fs` under `src/app`, and the alternative it points at —
 * `import statement from "@root/docs/ACCESSIBILITY.md"` — is not a language
 * feature. It works because `next.config.ts` teaches the bundler what a `.md`
 * module is. Take that rule away and the import does not fall back to anything;
 * the build fails, or worse, a future bundler quietly treats it as unknown.
 *
 * Which is exactly what is coming. `next build` uses webpack on the version we
 * ship and **Turbopack on the next major**, and Turbopack does not read the
 * `webpack` key at all. Running `next build --turbopack` on today's version
 * reproduces it precisely:
 *
 *     Turbopack build failed with 3 errors:
 *     ./SECURITY.md            Unknown module type
 *     ./docs/ACCESSIBILITY.md  Unknown module type
 *     ./docs/DPA.md            Unknown module type
 *
 * Three documents, which is all three legal pages — the same three that
 * answered 500 in production for their whole life. The upgrade would have put
 * them straight back.
 *
 * So the rule is declared twice, once per bundler, and this is what keeps the
 * pair together: a repo where one of them is edited and the other forgotten is
 * a repo one dependency bump away from the original bug.
 */
describe("both bundlers know what a .md module is", () => {
  const config = readFileSync(join(APP, "..", "..", "next.config.ts"), "utf8");

  it("webpack turns .md into its text", () => {
    expect(
      config.includes('type: "asset/source"'),
      "the webpack .md rule is gone; the legal pages' imports have nothing to " +
        "resolve them and the build that ships today is the one that breaks",
    ).toBe(true);
  });

  it("turbopack turns .md into its text", () => {
    expect(
      config.includes("turbopack:") && config.includes('"*.md"'),
      "next.config.ts declares a .md rule for webpack only. That is the state " +
        "this repo was in before the Turbopack rule was added, and it means " +
        "the next Next major returns /legal/accessibility, /legal/dpa and " +
        "/legal/vulnerability-disclosure to the 500s they used to serve.",
    ).toBe(true);
  });

  it("every loader those rules name actually resolves", () => {
    // A rule naming something that is not there is a rule that fails the first
    // time it runs, on the upgrade, when attention is elsewhere.
    const pkg = JSON.parse(
      readFileSync(join(APP, "..", "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };

    // Derived from the config rather than listed here, so the check covers
    // whatever the rules actually name. A hardcoded list would keep passing
    // after somebody swapped the loader for a different one.
    const named = new Set<string>();
    let from = 0;
    for (;;) {
      const at = config.indexOf("loaders: [", from);
      if (at === -1) break;
      const close = config.indexOf("]", at);
      for (const piece of config.slice(at + 10, close).split('"').filter((_, i) => i % 2 === 1)) {
        named.add(piece);
      }
      from = close;
    }

    expect(named.size, "no turbopack loader names were found to check").toBeGreaterThan(0);
    for (const loader of named) {
      if (loader.startsWith(".")) {
        // A path into this repo — the loader is ours, so the check is that the
        // file is still where the config says. Renaming it is silent until a
        // Turbopack build runs, and the thing that breaks is the legal pages.
        expect(
          existsSync(join(APP, "..", "..", loader)),
          `next.config.ts points at ${loader} and no such file exists`,
        ).toBe(true);
        continue;
      }
      expect(
        Object.hasOwn(declared, loader),
        `next.config.ts names the ${loader} loader and package.json does not depend on it`,
      ).toBe(true);
    }
  });
});
