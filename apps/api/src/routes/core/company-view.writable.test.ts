import { describe, expect, it } from "vitest";

import { patchSchema } from "../companies";
import { COMPANY_COLUMNS } from "./company-view";

/**
 * #552 — a setting you can change but cannot read back is worse than one you
 * cannot change.
 *
 * ## The defect this exists for, twice over
 *
 * The founder reported that Settings > Notifications could not be changed. Two
 * causes, and the second was this shape: the save echoed two of eight columns
 * while every client replaces its whole state with the reply, so the grouping
 * vanished from the screen and the next save wrote the emptied state back.
 *
 * He also asked us to "find and discover all issues of this kind", and there was
 * one waiting in the calling screen: `PATCH /v1/company` had accepted
 * `after_hours_calls`, `after_hours_greeting_id`, `ring_strategy`,
 * `ring_seconds` and `voicemail_greeting_id` for months, and `COMPANY_COLUMNS`
 * selected none of them. So the
 * value saved, the GET never returned it, and the control fell back to its
 * declared default — on Android permanently ("All at once", forever, whatever was
 * stored), on web as a group with nothing selected.
 *
 * Both are the same bug: two lists describing one object, and nothing comparing
 * them.
 *
 * ## Why this compares objects rather than parsing source
 *
 * `patchSchema` is imported and its keys read off the Zod shape, so the moment a
 * writable field is added it is in this test's input without anybody editing this
 * file. A regex over the route source would be a second roster that goes stale —
 * which is the class of failure being fixed, reintroduced as its own guard.
 */

/** Every key `PATCH /v1/company` will accept. */
function writableFields(): string[] {
  // The schema is `z.object(...).refine(...)`. Zod 4 records a refinement as a
  // CHECK and leaves the shape on `_def.shape`; Zod 3 wrapped the object and put
  // it at `_def.schema.shape`. Both are read, because a major-version bump should
  // not silently turn this guard into a no-op — and if neither is there it throws
  // rather than reporting zero writable fields, which is the failure mode a guard
  // must never have.
  const def = patchSchema._def as {
    shape?: Record<string, unknown>;
    schema?: { shape?: Record<string, unknown> };
  };
  const shape = def.shape ?? def.schema?.shape;
  if (!shape) {
    throw new Error(
      "patchSchema's shape is reachable at neither _def.shape (Zod 4) nor " +
        "_def.schema.shape (Zod 3) — point this test at it rather than letting " +
        "it pass on an empty list.",
    );
  }
  return Object.keys(shape);
}

/** Every column `GET /v1/company` selects. */
function readableColumns(): Set<string> {
  return new Set(COMPANY_COLUMNS.split(",").map((column) => column.trim()));
}

/**
 * Writable fields that are deliberately NOT columns on the company view.
 *
 * A reason is required rather than encouraged: an allowlist of bare names becomes
 * a list nobody can audit, and the whole point of recording an accepted asymmetry
 * is that the next person can tell it apart from the defect above.
 */
const NOT_A_READABLE_COLUMN: Record<string, string> = {
  // Pre-checkout onboarding fields. Read through the numbers summary and the
  // registration summary rather than off the company row.
  requested_area_code: "read from the pending number's summary, not the company row",
  chosen_number_e164: "read from the pending number's summary, not the company row",
};

describe("#552 every writable company field is also readable", () => {
  it("finds the schema's fields at all", () => {
    // The guard's own smoke test. A version of this that reported an empty list
    // would pass forever while checking nothing — the exact failure the
    // conversation-events guard shipped with and had to be fixed for.
    const fields = writableFields();
    expect(fields.length).toBeGreaterThan(20);
    expect(fields).toContain("name");
  });

  it("selects every field the PATCH accepts", () => {
    const readable = readableColumns();
    const missing = writableFields().filter(
      (field) => !readable.has(field) && !(field in NOT_A_READABLE_COLUMN),
    );
    expect(
      missing,
      "These fields can be SAVED and never READ BACK, so the control that writes " +
        "them shows its default forever (#552). Add each to COMPANY_COLUMNS, or " +
        "to NOT_A_READABLE_COLUMN with the reason it is read from somewhere else.",
    ).toEqual([]);
  });

  it("keeps the five calling fields #552 turned up", () => {
    // Named explicitly as well as covered by the rule above, because these are
    // the ones a person noticed: "Settings > notifications can't change to
    // grouped up ... find and discover all issues of this kind and fix".
    const readable = readableColumns();
    for (const column of [
      "after_hours_calls",
      "after_hours_greeting_id",
      "ring_strategy",
      "ring_seconds",
      // Found by the rule above on its first run, not by a person in production.
      "voicemail_greeting_id",
    ]) {
      expect(readable.has(column), column).toBe(true);
    }
  });

  it("has no stale entries in the allowlist", () => {
    // A reason recorded for a field that no longer exists is a reason nobody can
    // check, and it hides the day that field comes back.
    const fields = new Set(writableFields());
    for (const field of Object.keys(NOT_A_READABLE_COLUMN)) {
      expect(fields.has(field), `${field} is allowlisted but not writable`).toBe(
        true,
      );
    }
  });
});
