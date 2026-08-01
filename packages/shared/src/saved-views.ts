/**
 * #280 — what a saved view is allowed to hold.
 *
 * # Why this is shared rather than living in the API
 *
 * A view is a set of list-query parameters, and four things have to agree on
 * that set: the route that stores it, the route that replays it, and three
 * clients that build one from whatever filter bar the person is looking at. A
 * drift in any of them produces a view that saves fine and then opens something
 * else, which is the worst failure this feature can have — the whole promise is
 * that the thing you saved is the thing you get back.
 *
 * # Why the allow-list is explicit, and validated on the way OUT too
 *
 * `filters` is jsonb in the database, so nothing at the storage layer stops a
 * key that the list endpoint would reject. Validating only on write leaves the
 * rows written before a filter is renamed or removed, and those replay into a
 * 422 on a screen the person cannot fix. So `sanitizeFilters` runs in both
 * directions: an unknown or stale key is DROPPED rather than failing the read.
 * A view that has lost one of its filters still opens; a view that 422s is
 * dead.
 *
 * # What is deliberately not storable
 *
 * `cursor` and `q`. A cursor is a position in one specific result set and means
 * nothing tomorrow. Search text is a question being asked once, not a standing
 * view of the work — and saving it would quietly turn "my open threads" into
 * "my open threads mentioning boiler" for everybody who opened the shared copy.
 */

export const SAVED_VIEW_SURFACES = ["conversations", "tasks"] as const;

export type SavedViewSurface = (typeof SAVED_VIEW_SURFACES)[number];

export function isSavedViewSurface(value: string): value is SavedViewSurface {
  return (SAVED_VIEW_SURFACES as readonly string[]).includes(value);
}

/** The longest a view name may be. Long enough to be a sentence fragment. */
export const SAVED_VIEW_NAME_MAX = 60;

/** How many views one workspace may hold per surface, per scope. Mirrors SQL. */
export const SAVED_VIEWS_PER_SURFACE = 40;

/**
 * The most views one counts request will price.
 *
 * Counts are the cost-risky half of #280: a badge that costs a query per view
 * per poll scales with how organised the customer is, which is precisely
 * backwards. Bounded twice — this many views, and `SAVED_VIEW_COUNT_CEILING`
 * rows each.
 */
export const SAVED_VIEW_COUNT_MAX_VIEWS = 12;

/**
 * Stop counting here and say "99+".
 *
 * A queue badge answers "is there anything, and roughly how much". Nobody
 * behaves differently at 340 than at 99+, and the difference between those two
 * numbers is an unbounded scan.
 */
export const SAVED_VIEW_COUNT_CEILING = 99;

/** Render a bounded count the way every client must render it. */
export function formatViewCount(count: number): string {
  return count > SAVED_VIEW_COUNT_CEILING
    ? `${SAVED_VIEW_COUNT_CEILING}+`
    : String(count);
}

type FilterValue = string | boolean;

/**
 * Each surface's storable filters, and how to recognise a valid value.
 *
 * Mirrors the list endpoints' query schemas (`routes/conversations.ts`
 * `listQuerySchema`, and the task list's query reads). A test asserts the
 * conversation half against that schema so the mirror cannot rot silently.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/;

const isUuid = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
const isIso = (v: unknown) => typeof v === "string" && ISO_RE.test(v);
const isBool = (v: unknown) => typeof v === "boolean";
const oneOf =
  (...allowed: string[]) =>
  (v: unknown) =>
    typeof v === "string" && allowed.includes(v);

const FILTERS: Record<
  SavedViewSurface,
  Record<string, (value: unknown) => boolean>
> = {
  conversations: {
    status: oneOf("new", "open", "waiting", "closed"),
    /**
     * "Assigned to whoever is looking", not to a named person.
     *
     * #280's headline example is "my unassigned threads on the emergency line,
     * unread", and a shared view is the case that makes this necessary rather
     * than convenient: an owner defining the crew's morning queue means each
     * person's own work, not the owner's. Storing a concrete user id would make
     * "Mine" mean one specific human on everybody else's screen, which is both
     * wrong and a way to watch a colleague's inbox fill up.
     *
     * Resolved to the caller's id at request time, by each client and by the
     * counts endpoint. It cannot be stored alongside `assigned_user_id`; see
     * `resolveAssignee`.
     */
    assigned_to_me: isBool,
    assigned_user_id: isUuid,
    tag_id: isUuid,
    is_spam: isBool,
    unread: isBool,
    pinned: oneOf("only", "exclude"),
    snoozed: oneOf("only", "exclude", "all"),
  },
  tasks: {
    status: oneOf("open", "done"),
    assigned_user_id: isUuid,
    unassigned: isBool,
    overdue: isBool,
    has_location: isBool,
    due_before: isIso,
    due_after: isIso,
  },
};

/** The filter keys a surface accepts, for a client building the save payload. */
export function savedViewFilterKeys(surface: SavedViewSurface): string[] {
  return Object.keys(FILTERS[surface]);
}

export type SavedViewFilters = Record<string, FilterValue>;

/**
 * Keep only the filters this surface understands, with values it accepts.
 *
 * Dropping rather than throwing is the whole design (see the header). Called on
 * write so nothing unknown is ever stored, and on read so a row that predates a
 * schema change still opens.
 */
export function sanitizeFilters(
  surface: SavedViewSurface,
  raw: unknown,
): SavedViewFilters {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const allowed = FILTERS[surface];
  const out: SavedViewFilters = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const check = allowed[key];
    if (check && check(value)) out[key] = value as FilterValue;
  }
  // The two assignee filters contradict each other, and the contradiction is
  // silent: whichever the request serialiser happened to read last would win,
  // differently on different clients. `assigned_to_me` is the more specific
  // intent — somebody set it deliberately — so it takes the slot.
  if (out.assigned_to_me === true) delete out.assigned_user_id;
  if (out.assigned_to_me === false) delete out.assigned_to_me;
  return out;
}

/**
 * The `assigned_user_id` a request should carry, given the view and who is
 * asking.
 *
 * Every surface that replays a view calls this: three clients and the counts
 * endpoint. Written once because "Mine" resolving differently in one of the
 * four is exactly the bug that would go unnoticed — the list would simply show
 * somebody else's work, plausibly.
 */
export function resolveAssignee(
  filters: SavedViewFilters,
  viewerUserId: string,
): string | undefined {
  if (filters.assigned_to_me === true) return viewerUserId;
  const explicit = filters.assigned_user_id;
  return typeof explicit === "string" ? explicit : undefined;
}

/**
 * Filters as query-string pairs, ready to append to a list request.
 *
 * Booleans become "true"/"false" because that is what the list endpoints parse;
 * a `false` is dropped rather than sent, since every boolean filter there means
 * "restrict to this" and `is_spam=false` is the default the absence already
 * expresses. Sending it would be harmless today and would become a silent
 * behaviour change the first time one of them gains a third state.
 */
export function filtersToQuery(filters: SavedViewFilters): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "boolean") {
      if (value) pairs.push([key, "true"]);
      continue;
    }
    pairs.push([key, value]);
  }
  return pairs.sort((a, b) => a[0].localeCompare(b[0]));
}

/** True when a view holds no filters — it is the unfiltered list under a name. */
export function isEmptyView(filters: SavedViewFilters): boolean {
  return Object.keys(filters).length === 0;
}

/**
 * Is this name usable?
 *
 * Trimmed length only. Deliberately permissive about content: crews name things
 * in their own words, and a validator that rejects "Mike's" would be rejecting
 * the language the product is for.
 */
export function isValidViewName(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length >= 1 && trimmed.length <= SAVED_VIEW_NAME_MAX;
}

/**
 * Do two names collide?
 *
 * Case- and whitespace-insensitive, matching the unique index. #298 is the tag
 * version of this arriving somewhere worse: a view is a thing one person tells
 * another to open, so "Today" and "today" sitting side by side is a workspace
 * where the instruction no longer identifies a screen.
 */
export function viewNamesCollide(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
