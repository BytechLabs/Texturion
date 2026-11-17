import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MODE_PREFIX } from "./composer-drafts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

describe("#774 composer draft mode parity", () => {
  it.each([
    [
      "android",
      "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/Drafts.kt",
    ],
    ["ios", "apps/ios/Loonext/Features/Compose/Drafts.swift"],
  ])("%s stores the same mode key as web", (_platform, relativePath) => {
    expect(readFileSync(join(REPO_ROOT, relativePath), "utf8")).toContain(
      MODE_PREFIX,
    );
  });
});
