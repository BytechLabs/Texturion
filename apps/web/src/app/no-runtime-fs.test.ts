import { readFileSync, readdirSync, statSync } from "node:fs";
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
