/**
 * #519 — a filter the saved-view allow-list has not been told about is dropped
 * in silence.
 *
 * `sanitizeFilters` keeps only the keys `FILTERS[surface]` names, and dropping
 * rather than throwing is the right design: a view saved last year must still
 * open after a schema change. The cost is that the allow-list going stale has
 * no symptom. Somebody arranges the inbox by a new filter, saves it as a view,
 * and the view reopens as the UNFILTERED list — no error, no empty state, just
 * every conversation where they expected a few.
 *
 * The `awaiting` key carries a comment saying exactly this, written when it
 * happened (#508). A comment is not a check: the next filter will be added by
 * somebody who has not read it.
 *
 * WHAT THIS COMPARES. The list endpoints are the definition of "a filter this
 * surface has" — they are what the clients call, and a saved view is a stored
 * call to one. So the roster is read out of the route source rather than
 * restated here, because a second hand-written list is the same failure again.
 */
import { join } from "node:path";

import { savedViewFilterKeys } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { sourceText, stripComments } from "../test/source-tree";

const ROUTES = join(import.meta.dirname);

/**
 * Every `c.req.query("x")` a route reads.
 *
 * Comments stripped first, so prose naming a parameter is not a parameter.
 */
function queryKeys(file: string): Set<string> {
  const source = stripComments(sourceText(join(ROUTES, file)));
  return new Set(
    [...source.matchAll(/c\.req\.query\(\s*"([^"]+)"/g)].map((m) => m[1]),
  );
}

/**
 * Query parameters that are not FILTERS, and so are correctly absent from a
 * saved view. Each says why, because "it is not a filter" is a judgement.
 */
// `limit` and `view_id` are deliberately absent: neither is read through
// `c.req.query`, so exempting them would be dead weight covering a name
// nothing uses. The staleness check below is what said so.
const NOT_A_FILTER: Record<string, string> = {
  cursor: "a position in one result set — meaningless in a stored view",
  q: "a question asked once. A saved search is a different feature from a " +
    "saved view, and storing the text would make the view answer a question " +
    "nobody is asking any more",
  t9: "a hint about how to read the digits in `q`, so it goes with `q`",
  ids: "the specific rows a badge request is about",
  conversation_id:
    "scopes the task list to one thread, which is how the thread screen " +
    "embeds it — not a lens somebody chooses",
  surface: "which saved-view surface is being asked about, not a filter on it",
  field: "#291 contact-field filter — the contacts list is not a saved-view " +
    "surface",
  value: "the answer for `field`, same surface",
};

describe("#519 the saved-view allow-list knows every filter its surface has", () => {
  it("reads the routes at all, so a passing run means something", () => {
    // A regex that matched nothing would make both assertions below vacuous —
    // which is the exact family of failure this file belongs to.
    expect(queryKeys("conversations.ts").size).toBeGreaterThan(5);
    expect(queryKeys("tasks.ts").size).toBeGreaterThan(5);
  });

  it.each([
    ["conversations", "conversations.ts"],
    ["tasks", "tasks.ts"],
  ])("%s: every filter the list accepts can be saved", (surface, file) => {
    const saveable = new Set(
      savedViewFilterKeys(surface as "conversations" | "tasks"),
    );
    const missing = [...queryKeys(file)]
      .filter((key) => !saveable.has(key))
      .filter((key) => !(key in NOT_A_FILTER));

    expect(
      missing,
      `GET /v1/${surface} accepts these, and a saved view cannot hold them:\n` +
        `  ${missing.join("\n  ")}\n\n` +
        `A view saved with one reopens as the UNFILTERED list — no error, no ` +
        `empty state, just every row where somebody expected a few. Add it to ` +
        `FILTERS in packages/shared/src/saved-views.ts, or to NOT_A_FILTER ` +
        `here with the reason it is not one.`,
    ).toEqual([]);
  });

  it("keeps the not-a-filter list honest — every entry is still a parameter", () => {
    // A stale exemption reads as a considered decision about something that no
    // longer exists, and silently covers whatever takes that name next.
    const all = new Set([
      ...queryKeys("conversations.ts"),
      ...queryKeys("tasks.ts"),
      ...queryKeys("saved-views.ts"),
      ...queryKeys("contacts.ts"),
    ]);
    const gone = Object.keys(NOT_A_FILTER).filter((key) => !all.has(key));
    expect(gone, "Exempted parameters no route reads any more:").toEqual([]);
  });

  it("the allow-list holds nothing the list endpoint would ignore", () => {
    // The other direction. A filter a view can store but the list does not
    // read is a lens that appears to work and changes nothing — worse than
    // being unable to save it, because it looks applied.
    for (const [surface, file] of [
      ["conversations", "conversations.ts"],
      ["tasks", "tasks.ts"],
    ] as const) {
      const accepted = queryKeys(file);
      const dead = savedViewFilterKeys(surface).filter(
        (key) =>
          !accepted.has(key) &&
          // #508: resolved to the caller at request time by each client, so it
          // is never a query parameter of its own.
          key !== "assigned_to_me",
      );
      expect(
        dead,
        `${surface} views can store these, and GET /v1/${surface} does not ` +
          `read them — the filter would look applied and do nothing:`,
      ).toEqual([]);
    }
  });
});
