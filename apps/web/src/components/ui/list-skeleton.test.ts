/**
 * #733 — one list skeleton.
 *
 * A list's loading state was drawn inline in a dozen files: an
 * `Array.from({ length: N })` mapped to rows of `<Skeleton`, each with its own
 * row shape. `ListSkeleton` is the one of them. This scan fails when a file
 * outside it builds the rows again. A skeleton shaped like a grid of tiles or a
 * board of columns is not a list and is named below; a name that stops
 * matching anything fails too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

const EXCEPTIONS: Record<string, string> = {
  "components/thread/attachments-gallery.tsx": "a grid of square photo tiles",
  "components/tasks/views/board-view.tsx": "columns of cards: the board's shape",
};

/** An `Array.from({ length: ... })` whose callback body opens a `<Skeleton`. */
const ROWS = /Array\.from\(\s*\{\s*length[^}]*\}[\s\S]{0,400}?<Skeleton\b/;

/** Does this source map a counted array to rows of skeletons? */
export function drawsSkeletonRows(text: string): boolean {
  return ROWS.test(text);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(marketing") || entry.name === "marketing") {
        continue;
      }
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("#733 one ListSkeleton", () => {
  it("recognises rows of skeletons", () => {
    expect(
      drawsSkeletonRows(
        `{Array.from({ length: 3 }, (_, i) => (<div key={i}><Skeleton className="h-3" /></div>))}`,
      ),
    ).toBe(true);
    expect(
      drawsSkeletonRows(
        `{Array.from({ length: 6 }).map((_, i) => (<Skeleton key={i} />))}`,
      ),
    ).toBe(true);
    expect(drawsSkeletonRows(`<ListSkeleton rows={3} />`)).toBe(false);
    expect(
      drawsSkeletonRows(`Array.from({ length: 5 }, (_, i) => <Dot key={i} />)`),
    ).toBe(false);
  });

  it("no file draws skeleton rows by hand", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/list-skeleton.tsx")
      .filter(({ path }) => !(path in EXCEPTIONS))
      .filter(({ text }) => drawsSkeletonRows(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <ListSkeleton> from components/ui/list-skeleton instead",
    ).toEqual([]);
  });

  it("every named exception still draws skeleton rows", () => {
    const stale = Object.keys(EXCEPTIONS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !drawsSkeletonRows(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<ListSkeleton"));
    expect(users.length).toBeGreaterThanOrEqual(10);
  });
});
