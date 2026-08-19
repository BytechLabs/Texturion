import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #340 — the personal-data inventory DOCUMENT lists every table the SQL guard
 * says is classified.
 *
 * ## Why this exists, when a guard already claims to do it
 *
 * `supabase/tests/personal_data_inventory.test.sql` opens with "Every table is
 * classified in the personal-data inventory… `docs/PERSONAL-DATA-INVENTORY.md`
 * is the result, and this is what stops it quietly becoming untrue."
 *
 * **It never opens that file.** It compares the live catalog against a
 * `classified text[]` array declared in the same script, and its own header
 * concedes the rest is a convention — "the list and the prose are meant to be
 * edited in the same commit" — which is precisely the thing people do not do.
 * A psql script cannot read a markdown file, so the property was unguardable
 * where it was written.
 *
 * It had already gone wrong. `activation_stall_state` sat in the array and
 * appeared nowhere in the document, and the SQL guard reported "all 100 public
 * tables are classified" over it. That document is what a subject-access or
 * erasure request is answered from, and §6 promises in as many words that "not
 * in the document always means somebody forgot, never deliberately excluded".
 *
 * ## Both directions
 *
 * A table in the array and not the document is the failure above. A table in
 * the document and not the array is the opposite drift — prose describing
 * something the catalog check no longer covers — and it is worth failing on
 * too, because that is how a list quietly stops being the same list.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");
const SQL = join(REPO, "supabase", "tests", "personal_data_inventory.test.sql");
const DOC = join(REPO, "docs", "PERSONAL-DATA-INVENTORY.md");

/** The `classified text[] := array[ … ]` literal, as a set of table names. */
function classifiedInSql(): Set<string> {
  const source = readFileSync(SQL, "utf8");
  const open = source.indexOf("classified text[] := array[");
  const close = source.indexOf("];", open);
  if (open === -1 || close === -1) return new Set();
  return new Set(
    [...source.slice(open, close).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]),
  );
}

/**
 * Every table the document names.
 *
 * Backticks, because that is how the document writes a table throughout — in
 * the section-6 run-on list and in the tables above it alike. A column name in
 * backticks would be a false member, which is why the comparison below is
 * one-directional on that side: the document may name MORE than the array, and
 * only names it is missing are a failure.
 */
function namedInDoc(): Set<string> {
  const source = readFileSync(DOC, "utf8");
  return new Set(
    [...source.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]),
  );
}

describe("#340 the personal-data inventory document is the inventory", () => {
  const inSql = classifiedInSql();
  const inDoc = namedInDoc();

  it("read both files, so a passing run means something", () => {
    // The failure mode of every file-derived check: a path that resolves to
    // nothing makes each assertion below vacuously true.
    expect(inSql.size, "the SQL classified[] array parsed to nothing").toBeGreaterThan(50);
    expect(inDoc.size, "the document named no tables at all").toBeGreaterThan(50);
  });

  it("names every table the SQL guard counts as classified", () => {
    const missing = [...inSql].filter((table) => !inDoc.has(table)).sort();
    expect(
      missing,
      "These tables are classified by supabase/tests/personal_data_inventory" +
        ".test.sql and appear nowhere in docs/PERSONAL-DATA-INVENTORY.md:\n  " +
        missing.join("\n  ") +
        "\n\nThe SQL guard cannot see this — it compares the live catalog to " +
        "its own array and never opens the document. That document is what a " +
        "subject-access or erasure request is answered from.",
    ).toEqual([]);
  });
});
