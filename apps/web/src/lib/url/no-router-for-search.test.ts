import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A router navigation that only changes the search string (a filter, a tab, the
 * `?task=` drawer, a dialog param) sends a request to the web Worker for state
 * the client already owns, and the click waits on it. Those writes go through
 * lib/url/search-state.ts, which uses the History API.
 *
 * This flags `router.replace(`, `router.push(` and `navigate(` calls whose
 * argument is built from `pathname`, `searchParams` or `hrefForTask`, either in
 * the call itself or through a `const` of the same file that the call passes.
 */

const SRC = join(process.cwd(), "src");
const ROOTS = [join(SRC, "components"), join(SRC, "app", "(app)")];

const CALL = /\b(?:router\.(?:replace|push)|navigate)\(/g;
const CURRENT_URL = /\b(?:pathname|searchParams|hrefForTask)\b/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Converted by other packages; the lead empties this once they land. */
const PENDING = new Set([
  "components/inbox/inbox-pane.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The text between the call's parentheses, from `start` just past `(`. */
function callArguments(source: string, start: number): string {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

/** The first argument, cut at the first comma outside any bracket. */
function firstArgument(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

function initializers(source: string, name: string): string[] {
  const declaration = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=([^;]*)`, "g");
  return [...source.matchAll(declaration)].map((m) => m[1]);
}

function isCommentLine(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  return /^\s*(\/\/|\/\*|\*)/.test(source.slice(lineStart, index));
}

function searchOnlyNavigations(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(CALL)) {
    const index = match.index;
    if (isCommentLine(source, index)) continue;
    const args = callArguments(source, index + match[0].length);
    const first = firstArgument(args);
    const builtFromUrl =
      CURRENT_URL.test(args) ||
      (IDENTIFIER.test(first) &&
        initializers(source, first).some((init) => CURRENT_URL.test(init)));
    if (builtFromUrl) lines.push(source.slice(0, index).split("\n").length);
  }
  return lines;
}

function scan() {
  const files = ROOTS.flatMap(sourceFiles);
  const offences: string[] = [];
  const stillPending = new Set<string>();
  for (const file of files) {
    const rel = relative(SRC, file).split(sep).join("/");
    const lines = searchOnlyNavigations(readFileSync(file, "utf8"));
    if (lines.length === 0) continue;
    if (PENDING.has(rel)) stillPending.add(rel);
    else offences.push(...lines.map((line) => `src/${rel}:${line}`));
  }
  return { files, offences, stillPending };
}

describe("search-only URL changes skip the router", () => {
  const { files, offences, stillPending } = scan();

  it("scans the app's components and pages", () => {
    console.log(`no-router-for-search: scanned ${files.length} files`);
    expect(files.length).toBeGreaterThan(0);
  });

  it("writes search-only changes with lib/url/search-state.ts", () => {
    expect(
      offences,
      "use replaceSearch, pushSearch or updateSearch from @/lib/url/search-state",
    ).toEqual([]);
  });

  it("lists only pending files that still navigate", () => {
    for (const rel of PENDING) {
      expect(existsSync(join(SRC, rel)), `${rel} is gone`).toBe(true);
    }
    expect(
      [...PENDING].filter((rel) => !stillPending.has(rel)),
      "converted: remove these from PENDING",
    ).toEqual([]);
  });
});

describe("searchOnlyNavigations", () => {
  it("flags a call built from the current URL", () => {
    expect(
      searchOnlyNavigations(
        "router.replace(`${pathname}?${q}`, { scroll: false });",
      ),
    ).toEqual([1]);
  });

  it("follows a const the call passes", () => {
    const source = [
      "const href = hrefForTask(task.id);",
      "const go = () => navigate(href, { scroll: false });",
    ].join("\n");
    expect(searchOnlyNavigations(source)).toEqual([2]);
  });

  it("ignores another page and comment lines", () => {
    const source = [
      "router.push(`/contacts/${contact.id}`);",
      "// router.replace(pathname)",
    ].join("\n");
    expect(searchOnlyNavigations(source)).toEqual([]);
  });
});
