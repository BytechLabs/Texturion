/**
 * #733: the empty state is drawn by `EmptyState` and nowhere else.
 *
 * Twelve screens hand-rolled their own: five paddings, four icon sizes, two
 * title sizes. A hand-rolled one is a centred column with big padding, so this
 * fails on any class string that is a column, centred, text-centred and padded
 * like a zero state, outside the component itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/**
 * Outside the pattern on purpose: marketing, public pages, auth and
 * onboarding have their own layouts, and the inbox's activation moment is its
 * own peak.
 */
const OUT_OF_SCOPE = [
  "components/marketing/",
  "app/(marketing)/",
  "components/public/",
  "app/(auth)/",
  "app/onboarding/",
  "components/inbox/empty-states.tsx",
  "components/ui/empty-state.tsx",
  // The load-failed state shares the shape and has its own component.
  "components/ui/load-error.tsx",
];

const ZERO_STATE =
  /"([^"\n]*\bflex-col\b[^"\n]*)"/g;

function looksLikeAnEmptyState(classes: string): boolean {
  return (
    /\bitems-center\b/.test(classes) &&
    /\btext-center\b/.test(classes) &&
    /\b(py-(1[0-9]|20)|p-(8|10))\b/.test(classes)
  );
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("#733 empty states", () => {
  const files = walk(SRC)
    .map((file) => ({ file, rel: relative(SRC, file).replaceAll("\\", "/") }))
    .filter(({ rel }) => !OUT_OF_SCOPE.some((prefix) => rel.startsWith(prefix)));

  it("draws every empty state through EmptyState", () => {
    const offenders: string[] = [];
    for (const { file, rel } of files) {
      for (const match of readFileSync(file, "utf8").matchAll(ZERO_STATE)) {
        if (looksLikeAnEmptyState(match[1])) offenders.push(`${rel}: "${match[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is used across the app, so an empty scan cannot pass", () => {
    const users = files.filter(({ file }) => readFileSync(file, "utf8").includes("<EmptyState"));
    expect(users.length).toBeGreaterThanOrEqual(12);
  });
});
