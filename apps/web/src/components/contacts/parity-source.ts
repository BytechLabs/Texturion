import { readFileSync } from "node:fs";

import { stripComments } from "@/test/source-tree";

/**
 * #291/#519 — a client source with its comments removed, for the parity tests.
 *
 * The stripping itself lives in `src/test/source-tree.ts`, beside the tree
 * reader, because four guards across two apps needed the same thing and each
 * had written its own. Every copy was wrong the same way: a block comment was
 * taken to start at any `/*`, including one inside a string literal, so
 * `arrayOf("text/*", …)` in `ContactsTab.kt` blanked four hundred lines and the
 * assertions reading that region checked nothing.
 *
 * Kept as a named wrapper rather than inlined at each call site: these tests
 * read ANDROID and iOS sources, which the tree reader does not walk, so what
 * they share is the stripping and not the walking.
 */
export function parityCode(path: string): string {
  return stripComments(readFileSync(path, "utf8"));
}
