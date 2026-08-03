/**
 * #280/#519 — a saved view can hold every filter the inbox can be arranged by.
 *
 * `packages/shared/src/saved-views.ts` says its filter table "mirrors the list
 * endpoints' query schemas ... A test asserts the conversation half against
 * that schema so the mirror cannot rot silently." No such test existed. What
 * existed was a second hand-typed copy of the table compared against itself,
 * which catches a key being REMOVED and is blind in the direction that
 * actually costs something: a filter added to `GET /v1/conversations` and not
 * to the table.
 *
 * That failure is silent and specific. `sanitizeFilters` DROPS an unknown key
 * rather than throwing — deliberately, so a stale view still opens — so a
 * filter the table has not been told about is quietly discarded on save. The
 * person names a view "Unanswered", saves it, and it reopens as the unfiltered
 * list. It has already happened once: `awaiting` (#508) shipped on the list
 * endpoint before the table learned it, and the comment beside that key says so.
 *
 * This test lives in `apps/api` rather than in `packages/shared` because shared
 * cannot import a route. That is the whole reason the claim went unchecked for
 * as long as it did — the file making the claim was on the wrong side of the
 * dependency arrow to verify it.
 */
import { savedViewFilterKeys } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { conversationListFilterKeys } from "./conversations";

/**
 * Query parameters that are NOT filters, each with the reason.
 *
 * A saved view holds a standing arrangement of the work. These three are not
 * that, and the reasoning is already written down in `saved-views.ts` — this
 * list exists so that adding a parameter forces somebody to say which kind it
 * is, rather than letting the difference be decided by whoever edits which
 * file first.
 */
const NOT_A_FILTER: Record<string, string> = {
  q: "a question asked once, not a standing view — and saving it would turn 'my open threads' into 'my open threads mentioning boiler' for everybody who opened the shared copy",
  cursor: "a position in one specific result set; it means nothing tomorrow",
  limit: "a page size, which is the client's business and not the view's",
};

/**
 * Filters the saved-view table holds that the list endpoint does not name.
 *
 * One entry, and it is real rather than an oversight: `assigned_to_me` is
 * resolved to the caller's own id BEFORE the request is made, so the endpoint
 * only ever sees `assigned_user_id`. Storing the concrete id instead would make
 * "Mine" mean one specific human on everybody else's screen.
 */
const RESOLVED_BEFORE_THE_REQUEST: Record<string, string> = {
  assigned_to_me:
    "resolved to the caller's id at request time by every client and by the counts endpoint (see resolveAssignee) — the endpoint never sees this key",
};

describe("#280 the saved-view filter table mirrors the inbox list endpoint", () => {
  const endpoint = conversationListFilterKeys();
  const stored = savedViewFilterKeys("conversations");

  it("finds both key sets, so a rename cannot make this vacuous", () => {
    // Either side collapsing to nothing would make the comparisons below pass
    // by comparing two empty sets — the failure mode of every derived check.
    expect(endpoint.length).toBeGreaterThan(5);
    expect(stored.length).toBeGreaterThan(5);
  });

  it("stores every filter the inbox can be arranged by", () => {
    // The direction that was blind, and the one that costs a saved view its
    // filter without saying so.
    const unstorable = endpoint
      .filter((key) => !stored.includes(key))
      .filter((key) => !(key in NOT_A_FILTER));

    expect(
      unstorable,
      `\n\nGET /v1/conversations accepts these and a saved view cannot hold them:\n` +
        unstorable.map((key) => `  ${key}`).join("\n") +
        `\n\n\`sanitizeFilters\` DROPS an unknown key rather than failing, so a view\n` +
        `saved with one of these reopens without it and nobody is told. Either add\n` +
        `it to FILTERS.conversations in packages/shared/src/saved-views.ts, or add\n` +
        `it to NOT_A_FILTER here with the reason it is not a standing view.\n`,
    ).toEqual([]);
  });

  it("stores nothing the inbox would not accept", () => {
    // The other direction: a stored key the endpoint has never heard of is a
    // filter that saves cleanly and then does nothing on read, which reads to
    // the person as the view being ignored.
    const orphaned = stored
      .filter((key) => !endpoint.includes(key))
      .filter((key) => !(key in RESOLVED_BEFORE_THE_REQUEST));

    expect(
      orphaned,
      `\n\nThe saved-view table holds filters GET /v1/conversations does not accept:\n` +
        orphaned.map((key) => `  ${key}`).join("\n") +
        `\n\nA view can be saved with one and it will do nothing on read. Either the\n` +
        `endpoint should accept it, or it belongs in RESOLVED_BEFORE_THE_REQUEST\n` +
        `here with the reason the endpoint never sees it.\n`,
    ).toEqual([]);
  });

  it("keeps the two exemption lists honest", () => {
    // An exemption for a key that no longer exists on either side is a slot a
    // future key can occupy silently — the same staleness the saved-view
    // allow-list itself is guarded against.
    for (const key of Object.keys(NOT_A_FILTER)) {
      // `cursor` and `limit` are read outside the zod schema (parseCursor /
      // parseLimit), so they are exempt from THIS assertion by construction;
      // `q` must still really be a query parameter.
      if (key === "cursor" || key === "limit") continue;
      expect(endpoint, `${key} is exempted but the endpoint no longer takes it`)
        .toContain(key);
    }
    for (const key of Object.keys(RESOLVED_BEFORE_THE_REQUEST)) {
      expect(stored, `${key} is exempted but is no longer a stored filter`)
        .toContain(key);
    }
  });
});
