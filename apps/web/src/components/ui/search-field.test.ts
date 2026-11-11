/**
 * #733: every search box is `SearchField`. Four lists drew their own, with two
 * icon offsets, two paddings and a clear button on only half of them. A search
 * input is `type="search"`, so it appears in the shared component and nowhere
 * else.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("#733 search fields", () => {
  const files = walk(SRC).map((file) => ({ file, rel: relative(SRC, file).replaceAll("\\", "/") }));

  it("draws a search input only inside SearchField", () => {
    const own = files
      .filter(({ rel }) => rel !== "components/ui/search-field.tsx" && !rel.startsWith("components/marketing/"))
      .filter(({ file }) => /type="search"/.test(readFileSync(file, "utf8")))
      .map(({ rel }) => rel);
    expect(own).toEqual([]);
  });

  it("is what the lists and settings use", () => {
    const users = files.filter(({ file }) => readFileSync(file, "utf8").includes("<SearchField"));
    expect(users.map(({ rel }) => rel).sort()).toEqual(
      [
        "components/contacts/contacts-table.tsx",
        "components/inbox/filter-bar.tsx",
        "components/settings/settings-search.tsx",
        "components/tasks/task-filter-bar.tsx",
      ].sort(),
    );
  });
});
