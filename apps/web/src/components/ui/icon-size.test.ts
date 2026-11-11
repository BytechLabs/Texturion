/**
 * #733: icons come in three sizes, 14px (`size-3.5`), 16px (`size-4`) and 20px
 * (`size-5`), so a row, a button and a header each look the same on every
 * screen. This fails on an icon drawn at an arbitrary pixel size such as
 * `size-[17px]`, which is how the sidebar, the bell and the composer each ended
 * up a pixel or two away from everything else.
 *
 * An icon is a component imported from lucide-react, the sidebar's `Icon`
 * variable, or any element given a `strokeWidth`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const OUT_OF_SCOPE = ["components/marketing/", "app/(marketing)/", "components/public/"];
const ARBITRARY_PX = /\bsize-\[[0-9.]+px\]/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

function lucideNames(source: string): Set<string> {
  const names = new Set<string>(["Icon"]);
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)) {
    for (const part of match[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "");
      if (local) names.add(local);
    }
  }
  return names;
}

/** Every icon tag in a file that carries an arbitrary pixel size. */
export function arbitraryIconSizes(source: string): string[] {
  const icons = lucideNames(source);
  const found: string[] = [];
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]*)\b([^<>]*?)\/?>/g)) {
    const [tag, name, attributes] = match;
    const isIcon = icons.has(name) || /\bstrokeWidth=/.test(attributes);
    if (isIcon && ARBITRARY_PX.test(attributes)) found.push(tag.replace(/\s+/g, " ").slice(0, 120));
  }
  return found;
}

describe("#733 icon sizes", () => {
  const files = walk(SRC)
    .map((file) => ({ file, rel: relative(SRC, file).replaceAll("\\", "/") }))
    .filter(({ rel }) => !OUT_OF_SCOPE.some((prefix) => rel.startsWith(prefix)));

  it("draws no icon at an arbitrary pixel size", () => {
    const offenders = files.flatMap(({ file, rel }) =>
      arbitraryIconSizes(readFileSync(file, "utf8")).map((tag) => `${rel}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises an icon by its import, by the sidebar's Icon, and by its stroke", () => {
    const sample = `import { Bell } from "lucide-react";
      <Bell className="size-[18px]" aria-hidden />
      <Icon className={cn("size-[18px] shrink-0")} />
      <Custom className="size-[15px]" strokeWidth={1.75} />
      <Skeleton className="size-[38px]" />`;
    expect(arbitraryIconSizes(sample)).toHaveLength(3);
  });
});
