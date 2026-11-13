/**
 * The cache rules for files Cloudflare's assets layer serves before the Worker.
 *
 * `next.config.ts` headers() never reaches those files, so without
 * `public/_headers` every hashed chunk was "max-age=0, must-revalidate" and a
 * page load re-asked for all thirty of them. `scripts/ops/verify-app-edge.mjs`
 * checks the same rules on the deployed origin after each release.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WEB = process.cwd();
const PUBLIC = join(WEB, "public");

/** `_headers` as path pattern -> header lines, in file order. */
function parseHeaders(text: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      if (current === null) throw new Error(`header line before any path: ${raw}`);
      rules.get(current)?.push(raw.trim());
    } else {
      current = raw.trim();
      if (rules.has(current)) throw new Error(`path listed twice: ${current}`);
      rules.set(current, []);
    }
  }
  return rules;
}

const rules = parseHeaders(readFileSync(join(PUBLIC, "_headers"), "utf8"));

describe("public/_headers", () => {
  it("makes every content-hashed build file immutable for a year", () => {
    expect(rules.get("/_next/static/*")).toEqual(["Cache-Control: public, max-age=31536000, immutable"]);
  });

  it("leaves the service worker and the offline page to be checked on every use", () => {
    for (const path of rules.keys()) {
      expect(path, "a rule matching /sw.js would stop installed workers updating").not.toMatch(/^\/(sw\.js|\*)$/);
      expect(path).not.toBe("/offline.html");
    }
  });

  it("names only files and folders that exist, each with one Cache-Control", () => {
    for (const [path, lines] of rules) {
      if (path !== "/_next/static/*") {
        expect(existsSync(join(PUBLIC, path.replace(/\/\*$/, ""))), path).toBe(true);
      }
      expect(lines.filter((line) => /^cache-control:/i.test(line)), path).toHaveLength(1);
    }
  });
});

describe("wrangler assets", () => {
  it("serves public files only at their exact path, so /offline.html is never a redirect", () => {
    const config = readFileSync(join(WEB, "wrangler.jsonc"), "utf8");
    expect(config).toMatch(/"html_handling"\s*:\s*"none"/);
  });
});
