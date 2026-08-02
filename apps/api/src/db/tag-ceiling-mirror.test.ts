/**
 * #298 — the tag ceiling exists in two places, and they have to agree.
 *
 * `api_find_or_create_tag` enforces it (a count in the Worker would leave a
 * window where two concurrent attaches both saw 199), and the API's refusal
 * message quotes `TAGS_PER_WORKSPACE` at the person. A drift between them is
 * invisible until somebody is told "your workspace has hit its 200-tag limit"
 * by a function that actually refused at 500 — a sentence that is worse than
 * silence, because it sends them looking for tags that are not there.
 *
 * Pinned here rather than in SQL because only this side can read the shared
 * constant. This is the mirror guard the pricing report already uses (#255).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TAGS_PER_WORKSPACE } from "@loonext/shared";
import { describe, expect, it } from "vitest";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260801170000_tag_descriptions.sql",
    import.meta.url,
  ),
);

describe("#298 the tag ceiling mirrors the shared constant", () => {
  it("refuses at exactly TAGS_PER_WORKSPACE", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = /if v_count >= (\d+) then/.exec(sql);
    expect(match, "the ceiling check moved or was renamed").not.toBeNull();
    expect(Number(match?.[1])).toBe(TAGS_PER_WORKSPACE);
  });

  it("is high enough to be a runaway signal, not a taxonomy limit", () => {
    // #298's own words: "high enough that nobody legitimate hits it and low
    // enough to catch runaway automation". Forty already makes a tag list
    // unusable by hand, so anything near that would be a limit on crews rather
    // than on integrations — which is the opposite of what it is for.
    expect(TAGS_PER_WORKSPACE).toBeGreaterThanOrEqual(100);
    expect(TAGS_PER_WORKSPACE).toBeLessThanOrEqual(1000);
  });
});
