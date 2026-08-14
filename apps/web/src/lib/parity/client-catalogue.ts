import { readFileSync } from "node:fs";

/**
 * #228 — where a client's COPY lives, now that it is moving.
 *
 * The cross-client parity tests read each client's source and assert the same
 * sentences appear on all three. That worked while every client wrote its
 * English inline. #228 is moving it, file by file, into per-platform
 * catalogues — so a sentence that has been extracted reads as MISSING to a test
 * that only greps the source, and the test fails on work that improved the
 * thing it guards.
 *
 * This is used by tests only and is deliberately not exported from any barrel:
 * it reaches for `node:fs`, and pulling that into a bundle through a re-export
 * is a build failure this repo has already had once.
 *
 * ## Why the keys are stripped
 *
 * Found by breaking it, in `response-time-parity.test.ts`: the card calls
 * `t("inbox.responseDetails")` and that KEY contains the fragment "Details", so
 * a catalogue read whole let an identifier satisfy a copy check while the
 * sentence beside it had been reworded. Comment lines go for the same reason —
 * a fragment quoted in a note about the code is not the code.
 *
 * ## Why this is one function rather than four
 *
 * It was written twice before this file existed, and two more tests needed it
 * the moment the Android sweep landed. A per-client predicate copied four times
 * is the drift these very tests exist to prevent, one level up.
 */

/**
 * Glue a wrapped string literal back into one sentence.
 *
 * A catalogue entry longer than the line limit is written as
 * `"It will go " + "out when billing is sorted."`, and a parity test asking for
 * the sentence VERBATIM cannot span that. Without this the guard reports copy as
 * missing purely because it was too long to fit on one line — which is the
 * failure it produced the first time the Android sweep landed.
 */
function joinWrappedLiterals(text: string): string {
  return text.replace(/"\s*\+\s*\n\s*"/g, "");
}

/** Strip `"section.key" to ` pairs and comment lines, leaving the sentences. */
export function kotlinCatalogueValues(text: string): string {
  return joinWrappedLiterals(text)
    .replace(/"[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+"\s*to\s*/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

/** The same, for a Swift `"section.key": "value"` catalogue. */
export function swiftCatalogueValues(text: string): string {
  return joinWrappedLiterals(text)
    .replace(/"[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+"\s*:\s*/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

/**
 * Read a client's source together with every catalogue section that could now
 * hold its sentences.
 *
 * BOTH, not one. The migration is file-by-file and will be for a while: most
 * copy on a given screen may already have moved while the rest is still inline,
 * and a test that switched to catalogue-only would go quiet on everything left
 * behind. A missing file is skipped rather than thrown, because the catalogue a
 * client has not grown yet is not an error.
 */
export function copyWithCatalogue(
  sourcePath: string,
  cataloguePaths: readonly string[],
  dialect: "kotlin" | "swift",
  /**
   * Which keys belong to THIS test, e.g. `["domain.scheduledHold"]`.
   *
   * Not optional in practice, and the reason is a mistake worth recording. A
   * catalogue section holds the copy for a whole area — `DomainStrings.kt`
   * carries the send-hold reasons, the contact clock lines, the number-access
   * notes and the carrier registration steps together. Handing all of it to a
   * test that also asserts the REVERSE direction ("this client knows of no
   * reason the shared roster has not been told about") made every unrelated
   * sentence in the file look like an undeclared hold reason.
   *
   * So a test says which keys are its business, and sees only those. Omitting
   * this takes the whole file, which is right only for a test that asks in one
   * direction.
   */
  keyPrefixes?: readonly string[],
): string {
  const values = dialect === "kotlin" ? kotlinCatalogueValues : swiftCatalogueValues;
  // The SOURCE now names keys where it used to carry sentences — `t("domain.x")`
  // in place of the English. A reverse-direction assertion reads those bare
  // identifiers as copy nobody declared, so they go before anything is compared.
  const source = readFileSync(sourcePath, "utf8").replace(
    /"[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+"/g,
    "",
  );
  const parts = [source];
  for (const path of cataloguePaths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // Not every client has every section. See the docblock.
    }
    if (keyPrefixes && keyPrefixes.length > 0) {
      text = onlyKeys(text, keyPrefixes, dialect);
    }
    parts.push(values(text));
  }
  return parts.join("\n");
}

/** Keep only the catalogue entries whose key starts with one of [prefixes]. */
function onlyKeys(
  text: string,
  prefixes: readonly string[],
  dialect: "kotlin" | "swift",
): string {
  const joined = joinWrappedLiterals(text);
  const entry =
    dialect === "kotlin"
      ? /"([a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+)"\s*to\s*("(?:[^"\\]|\\.)*")/g
      : /"([a-z][A-Za-z0-9_]*\.[A-Za-z0-9_]+)"\s*:\s*("(?:[^"\\]|\\.)*")/g;
  // FIRST occurrence only. Every catalogue in this repo carries the same keys
  // twice — once in `en` and once in `frCA`, English first — and a parity test
  // compares against the English roster, so including the second copy makes
  // every finished translation read as undeclared copy.
  const kept = new Map<string, string>();
  for (const match of joined.matchAll(entry)) {
    if (!prefixes.some((prefix) => match[1].startsWith(prefix))) continue;
    if (!kept.has(match[1])) kept.set(match[1], match[2]);
  }
  return [...kept.values()].join("\n");
}
