import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const appTrees = [
  { path: "apps/web/src", timer: /setTimeout\([\s\S]{0,1800}?,\s*800\s*\)/ },
  { path: "apps/android/app/src/main/kotlin", timer: /delay\(\s*800\s*\)/ },
  {
    path: "apps/ios/Loonext",
    timer: /Task\.sleep\([\s\S]{0,80}?(?:milliseconds\(\s*800\s*\)|800_000_000)/,
  },
];

function dropsPendingSave(source: string, timer: RegExp): boolean {
  return timer.test(source) &&
    /autosave|lastSaved|saveState/i.test(source) &&
    !/\bflush(?:Pending|Autosave)?\s*\(/.test(source);
}

it("keeps an immediate write path alongside each 800 ms autosave timer", () => {
  const missingFlush: string[] = [];
  for (const tree of appTrees) {
    const entries = readdirSync(join(root, tree.path), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(tsx?|kt|swift)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const filename = join(entry.parentPath, entry.name);
      if (dropsPendingSave(readFileSync(filename, "utf8"), tree.timer)) {
        missingFlush.push(relative(root, filename));
      }
    }
  }
  expect(missingFlush).toEqual([]);
});

it("flags an autosave that only waits for the timer", () => {
  expect(dropsPendingSave("val lastSaved = value; delay(800); save(value)", appTrees[1].timer)).toBe(true);
});
