import type { MessageKey } from "@/i18n/provider";
import type { TaskListFilters } from "@/lib/api/task-filters";
import type { TaskPriority } from "@/lib/api/types";

/**
 * URL is the state for the /tasks page (D25): the view switcher and every
 * filter round-trip through `?view=&tab=&assignee=&due=&q=` so a view is
 * shareable and the back button works. These pure functions translate between
 * the search params, the segmented tabs (Open | Mine | All | Done, TASKS.md
 * T6.3), the one-glance filter chips (assignee / due / overdue / unassigned),
 * and the `GET /v1/tasks` filter object (`useTasks`). Unit-tested directly.
 */

// ---------------------------------------------------------------------------
// View switch (?view=)
// ---------------------------------------------------------------------------

export type TaskView = "list" | "board" | "calendar" | "map";

/**
 * #228: the switcher carries a catalogue KEY, not a word. A label baked in here
 * is a label no translator sees, and the id is what the URL and every predicate
 * below actually run on — so the two were never the same thing.
 */
export const TASK_VIEWS: readonly { id: TaskView; labelKey: MessageKey }[] = [
  { id: "list", labelKey: "tasks.viewList" },
  { id: "board", labelKey: "tasks.viewBoard" },
  { id: "calendar", labelKey: "tasks.viewCalendar" },
  { id: "map", labelKey: "tasks.viewMap" },
];

const VIEW_IDS = new Set<TaskView>(["list", "board", "calendar", "map"]);

export function parseView(raw: string | null): TaskView {
  return raw !== null && VIEW_IDS.has(raw as TaskView)
    ? (raw as TaskView)
    : "list"; // List is the default (D25).
}

// ---------------------------------------------------------------------------
// Segmented tabs (?tab=) — the shared 4-segment contract (T6.3)
// ---------------------------------------------------------------------------

export type TaskTab = "open" | "mine" | "all" | "done";

export const TASK_TABS: readonly { id: TaskTab; labelKey: MessageKey }[] = [
  { id: "open", labelKey: "tasks.tabOpen" },
  { id: "mine", labelKey: "tasks.tabMine" },
  { id: "all", labelKey: "tasks.tabAll" },
  { id: "done", labelKey: "tasks.tabDone" },
];

const TAB_IDS = new Set<TaskTab>(["open", "mine", "all", "done"]);

/**
 * #113: which status tabs actually DO something in each view. Board organizes
 * by status (its own columns) and Map shows every status (status: undefined),
 * so the Open/Done status dimension is a no-op there — only the assignee
 * dimension (Mine | All) applies. List and Calendar consume all four. The
 * filter bar renders exactly this set per view instead of always showing four,
 * two of which silently did nothing on Board/Map.
 */
export function tabsForView(view: TaskView): readonly TaskTab[] {
  return view === "board" || view === "map"
    ? (["mine", "all"] as const)
    : (["open", "mine", "all", "done"] as const);
}

/**
 * #113: coerce a tab to one the target view supports. Switching from
 * List(Open) to Board keeps "my tasks" (open/done → mine) rather than carrying
 * an Open pill the board ignores.
 */
export function coerceTabForView(tab: TaskTab, view: TaskView): TaskTab {
  return tabsForView(view).includes(tab) ? tab : "mine";
}

function parseTab(raw: string | null): TaskTab {
  return raw !== null && TAB_IDS.has(raw as TaskTab)
    ? (raw as TaskTab)
    : "open"; // "Open" is the default landing tab (T6.1 "what needs me now").
}

// ---------------------------------------------------------------------------
// Due chip (?due=)
// ---------------------------------------------------------------------------

export type DueFilter = "overdue" | "today" | "week";

const DUE_IDS = new Set<DueFilter>(["overdue", "today", "week"]);

function parseDue(raw: string | null): DueFilter | undefined {
  return raw !== null && DUE_IDS.has(raw as DueFilter)
    ? (raw as DueFilter)
    : undefined;
}

export const DUE_LABEL_KEYS: Record<DueFilter, MessageKey> = {
  overdue: "tasks.overdue",
  today: "tasks.dueToday",
  week: "tasks.dueThisWeek",
};

// ---------------------------------------------------------------------------
// The parsed page state
// ---------------------------------------------------------------------------

export interface TaskPageState {
  view: TaskView;
  tab: TaskTab;
  /** A specific member user id (chip); the Mine tab owns the `me` assignee. */
  assignee?: string;
  /** The unassigned chip. */
  unassigned?: boolean;
  /** The due chip (overdue / today / this week). */
  due?: DueFilter;
  /** Title search. */
  q?: string;
  /** #693: only these priorities. */
  priority?: TaskPriority[];
  /** #693: only tasks carrying this workspace tag (its id). */
  tag?: string;
  /** #693: list order; absent is newest first. */
  sort?: TaskSort;
}

export type TaskSort = "created" | "due" | "priority";

const PRIORITY_VALUES: readonly TaskPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
  "none",
];

const SORT_VALUES = new Set<TaskSort>(["created", "due", "priority"]);

/** `high,urgent` -> the known priorities, most pressing first, no repeats. */
export function parsePriorities(raw: string | null): TaskPriority[] {
  if (!raw) return [];
  const asked = new Set(raw.split(","));
  return PRIORITY_VALUES.filter((p) => asked.has(p));
}

/** Parse the /tasks search params; unknown values fall back to defaults. */
export function parseTaskSearchParams(
  params: URLSearchParams,
): TaskPageState {
  const state: TaskPageState = {
    view: parseView(params.get("view")),
    tab: parseTab(params.get("tab")),
  };
  const assignee = params.get("assignee");
  if (assignee) state.assignee = assignee;
  if (params.get("unassigned") === "1" || params.get("unassigned") === "true") {
    state.unassigned = true;
  }
  const due = parseDue(params.get("due"));
  if (due) state.due = due;
  const q = params.get("q");
  if (q !== null && q.trim() !== "") state.q = q;
  const priority = parsePriorities(params.get("priority"));
  if (priority.length > 0) state.priority = priority;
  const tag = params.get("tag");
  if (tag) state.tag = tag;
  const sort = params.get("sort");
  if (sort !== null && SORT_VALUES.has(sort as TaskSort) && sort !== "created") {
    state.sort = sort as TaskSort;
  }
  return state;
}

/** Serialize back to a query string ("" when everything is default). */
export function serializeTaskState(state: TaskPageState): string {
  const params = new URLSearchParams();
  // `view` is always present so a shared link keeps its view; `tab` only when
  // it isn't the default (keeps the common List·Open URL clean).
  if (state.view !== "list") params.set("view", state.view);
  if (state.tab !== "open") params.set("tab", state.tab);
  if (state.assignee) params.set("assignee", state.assignee);
  if (state.unassigned) params.set("unassigned", "1");
  if (state.due) params.set("due", state.due);
  if (state.q !== undefined && state.q.trim() !== "") params.set("q", state.q);
  if (state.priority && state.priority.length > 0) {
    params.set("priority", state.priority.join(","));
  }
  if (state.tag) params.set("tag", state.tag);
  if (state.sort && state.sort !== "created") params.set("sort", state.sort);
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

// ---------------------------------------------------------------------------
// Map the page state → the GET /v1/tasks filter object (useTasks)
// ---------------------------------------------------------------------------

/** Start of the current day / seven-day window, as ISO instants for the API. */
function dueRange(due: DueFilter, now: Date): Pick<
  TaskListFilters,
  "due_before" | "due_after" | "overdue"
> {
  if (due === "overdue") return { overdue: true };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (due === "today") {
    end.setDate(end.getDate() + 1);
  } else {
    end.setDate(end.getDate() + 7);
  }
  return { due_after: start.toISOString(), due_before: end.toISOString() };
}

/**
 * The `useTasks` filter for the current page state. The tab owns `status` +
 * the `me` assignee; chips add assignee / unassigned / due. `all` is the
 * escape-hatch assignee sugar (`useTasks` normalizes it away while forcing an
 * explicit non-defaulting param).
 */
export function toTaskFilters(
  state: TaskPageState,
  now: Date = new Date(),
): TaskListFilters {
  const filters: TaskListFilters = {};

  // Tab → status + assignee baseline.
  if (state.tab === "open") {
    filters.status = "open";
    filters.assigned_user_id = "me";
  } else if (state.tab === "mine") {
    filters.assigned_user_id = "me";
  } else if (state.tab === "done") {
    filters.status = "done";
    filters.assigned_user_id = "me";
  } else {
    // All — every assignee. The `all` sugar drops the assignee pin and (via
    // taskSearchParams) injects a `status=open` sentinel so the frozen route's
    // Open·Mine default isn't re-applied.
    filters.assigned_user_id = "all";
  }

  // Chips refine. A specific-member assignee overrides the tab baseline (you
  // asked for that person's tasks); unassigned is its own dimension.
  if (state.assignee) {
    filters.assigned_user_id = state.assignee;
  } else if (state.unassigned) {
    filters.assigned_user_id = undefined;
    filters.unassigned = true;
  }

  if (state.due) Object.assign(filters, dueRange(state.due, now));
  if (state.q && state.q.trim() !== "") filters.q = state.q.trim();
  if (state.priority && state.priority.length > 0) {
    filters.priority = state.priority;
  }
  if (state.tag) filters.tag_id = state.tag;
  if (state.sort && state.sort !== "created") filters.sort = state.sort;

  return filters;
}

/** True when any refining chip is active (drives the "clear filters" affordance). */
export function hasActiveChips(state: TaskPageState): boolean {
  return Boolean(
    state.assignee ||
      state.unassigned ||
      state.due ||
      state.q ||
      (state.priority && state.priority.length > 0) ||
      state.tag,
  );
}
