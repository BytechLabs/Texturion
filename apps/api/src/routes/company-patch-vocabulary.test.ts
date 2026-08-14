/**
 * One settings field, THREE lists — and only two of them were guarded.
 *
 * `PATCH /v1/company` spreads a single field's registration across:
 *
 *   1. `patchSchema`'s object literal — what the body may contain.
 *   2. The `.refine()` under it — "Provide at least one field to update.",
 *      which is a hand-written disjunction naming every field again.
 *   3. The apply block in the route — what actually reaches the row.
 *   4. `COMPANY_COLUMNS` — what the response reads back.
 *
 * #552 already pins (1) against (4). Nothing pinned (1) against (2), and the
 * failure mode is nasty: a field added to the schema but not the disjunction
 * parses cleanly and is then refused by the refinement as though the request
 * were empty. The client gets `422 validation_failed` saying "Provide at least
 * one field to update" about a request that provided exactly one field.
 *
 * That is not hypothetical. #232's `widget_number_id` shipped through
 * typecheck, lint and the whole unit suite and failed the first time a person
 * clicked the control — the only signal was a 422 in a dev-server log.
 *
 * Checked in BOTH directions. A name in the disjunction that the schema has
 * dropped is dead text that reads as coverage, which is how the next person
 * concludes the list is maintained.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./companies.ts", import.meta.url),
  "utf8",
);

/**
 * The keys `patchSchema` declares.
 *
 * Read from the source rather than from `patchSchema.shape`, because a
 * ZodEffects (which is what `.refine()` returns) does not expose a shape, and
 * unwrapping it would couple this to Zod's internals instead of to the two
 * lists a person actually edits.
 */
function schemaKeys(): Set<string> {
  const start = SOURCE.indexOf("export const patchSchema = z");
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf(".refine(", start);
  expect(end).toBeGreaterThan(start);
  const body = SOURCE.slice(start, end);
  const keys = new Set<string>();
  // Declarations are `    name: z.` at the object's own indent. Anchored to the
  // line start so a key mentioned inside a doc comment is not counted.
  // `z\b`, not `z\.` — several fields wrap the builder onto the next line
  // (`overage_cap_multiplier: z\n      .number()`), and requiring the dot
  // silently dropped six of them. A guard whose extractor under-reads is worse
  // than none: it passes while the thing it checks is broken.
  for (const match of body.matchAll(/^ {4}([a-z_][a-z0-9_]*):\s*z\b/gm)) {
    keys.add(match[1]);
  }
  return keys;
}

/** The keys the "at least one field" disjunction names. */
function refinementKeys(): Set<string> {
  const start = SOURCE.indexOf("Provide at least one field to update.");
  expect(start).toBeGreaterThan(-1);
  // The disjunction sits ABOVE the message, in the predicate.
  const predicateStart = SOURCE.lastIndexOf(".refine(", start);
  expect(predicateStart).toBeGreaterThan(-1);
  const body = SOURCE.slice(predicateStart, start);
  const keys = new Set<string>();
  // Both spellings the list uses: `body.x !== undefined` and `"x" in body`.
  for (const match of body.matchAll(/body\.([a-z_][a-z0-9_]*)\s*!==\s*undefined/g)) {
    keys.add(match[1]);
  }
  for (const match of body.matchAll(/"([a-z_][a-z0-9_]*)"\s+in\s+body/g)) {
    keys.add(match[1]);
  }
  return keys;
}

describe("PATCH /v1/company — one field, one vocabulary", () => {
  it("every schema field can satisfy 'at least one field to update'", () => {
    // The direction that bit. A field the schema accepts and the refinement
    // has never heard of is refused as an empty request.
    const missing = [...schemaKeys()].filter((key) => !refinementKeys().has(key));
    expect(missing).toEqual([]);
  });

  it("the refinement names no field the schema has dropped", () => {
    // The other direction, which never breaks anything and is exactly why it
    // rots: a stale name reads as coverage and teaches the next person that
    // the list maintains itself.
    const stale = [...refinementKeys()].filter((key) => !schemaKeys().has(key));
    expect(stale).toEqual([]);
  });

  it("both lists are non-trivially populated", () => {
    // Without this, a regex that stopped matching would make the two
    // assertions above pass by comparing nothing to nothing — the way a guard
    // reports "none" and reads as "clean".
    expect(schemaKeys().size).toBeGreaterThan(20);
    expect(refinementKeys().size).toBeGreaterThan(20);
    expect(schemaKeys().has("widget_number_id")).toBe(true);
  });
});
