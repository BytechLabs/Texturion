/**
 * #304 — the work, as a file. Scheduled work is a reporting axis too.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM THE OTHER TWO EXPORTS ──────────────────
 *
 * A task list looks like internal admin, and it is not. Every task hangs off a
 * conversation (`tasks.conversation_id` is NOT NULL — D17: a task promotes a
 * real message), so a row here names a customer, quotes something they asked
 * for, and says who was sent to deal with it. That makes this customer data
 * wearing a project-management hat, and it inherits both rules the history
 * export lives by:
 *
 *   - `contacts.bulk` to ask for it, not `workspace.access`.
 *   - #106 number access resolved at BUILD time, so a task on a phone line the
 *     requester cannot see is not in the file — and the count of what was
 *     withheld is stated, because a file silently missing a job is one somebody
 *     puts in front of a customer believing it is whole.
 *
 * ── DONE IS A JOIN, NOT A COLUMN ──────────────────────────────────────────
 *
 * `tasks` has no completion column. It derives from the source message's
 * `done_at` (D17), which is easy to miss and produces an export where every
 * task looks open forever — the single most useless way this could be wrong,
 * since "what is still outstanding" is the question somebody exports this to
 * answer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberRole } from "@loonext/shared";

import { resolveNumberAccess } from "../auth/number-access";
import { csvSafeText, serializeCsv } from "../routes/core/csv";

/** Sanity bound, matching the history export's posture. */
export const TASK_EXPORT_CAP = 10_000;

export interface TaskExportFilters {
  /** ISO instants, filtering on when the task was raised. */
  from?: string;
  to?: string;
  /** 'open' | 'done' | absent for both. */
  state?: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  due_at: string | null;
  created_at: string;
  assigned_user_id: string | null;
  conversation_id: string;
  messages: { done_at: string | null } | null;
  conversations: {
    phone_number_id: string | null;
    // #291: the number the THREAD is with, not the contact's primary. A
    // customer can have several, and a row labelled with the wrong one is a
    // callback to a number that conversation never used.
    contact_phone_e164: string | null;
    contacts: { name: string | null } | null;
  } | null;
}

/** One row as the file reads it. */
export interface TaskEntry {
  raised: string;
  customer: string;
  title: string;
  detail: string;
  due: string;
  assignedTo: string;
  state: string;
}

export interface TaskExportResult {
  tasks: number;
  withheld: number;
  capped: boolean;
}

export async function buildTaskExport(
  db: SupabaseClient,
  args: {
    companyId: string;
    requestedBy: string;
    filters: TaskExportFilters;
    prefix: string;
    now: Date;
  },
  put: (path: string, body: string, contentType: string) => Promise<void>,
): Promise<TaskExportResult> {
  // The requester's role NOW, for the same reason the history export reads it:
  // an export produced today is read today, and access is a question about
  // today. Somebody who has left does not get a link that still works.
  const { data: member, error: memberError } = await db
    .from("company_members")
    .select("role")
    .eq("company_id", args.companyId)
    .eq("user_id", args.requestedBy)
    // #581/C14: ACTIVE, for the reason the history export states — removing somebody
    // sets `deactivated_at` and never deletes the row, so "no membership" was a state
    // offboarding could not produce and the check below never fired for the case it
    // exists for. Every task hangs off a conversation (D17), so each row names a
    // customer and quotes what they asked for.
    .is("deactivated_at", null)
    .maybeSingle();
  if (memberError) {
    throw new Error(`task export role read failed: ${memberError.message}`);
  }
  if (!member) {
    throw new Error("the member who requested this export is no longer in the workspace");
  }

  const access = await resolveNumberAccess(db, {
    companyId: args.companyId,
    userId: args.requestedBy,
    role: (member as { role: string }).role as MemberRole,
  });
  const hidden = new Set(access.hiddenNumberIds ?? []);

  let query = db
    .from("tasks")
    .select(
      "id,title,description,due_at,created_at,assigned_user_id,conversation_id," +
        "messages(done_at)," +
        "conversations(phone_number_id,contact_phone_e164,contacts(name))",
    )
    .eq("company_id", args.companyId)
    // Soft-deleted work is deleted work. A file that resurrected it would be
    // the one artifact contradicting what the product shows.
    .is("deleted_at", null);
  if (args.filters.from) query = query.gte("created_at", args.filters.from);
  if (args.filters.to) query = query.lte("created_at", args.filters.to);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(TASK_EXPORT_CAP + 1);
  if (error) throw new Error(`task export read failed: ${error.message}`);

  const rows = (data ?? []) as unknown as TaskRow[];
  const capped = rows.length > TASK_EXPORT_CAP;

  let withheld = 0;
  const permitted = rows.slice(0, TASK_EXPORT_CAP).filter((row) => {
    const numberId = row.conversations?.phone_number_id ?? null;
    if (numberId !== null && hidden.has(numberId)) {
      withheld += 1;
      return false;
    }
    return true;
  });

  const names = await memberNames(db, [
    ...new Set(
      permitted
        .map((row) => row.assigned_user_id)
        .filter((id): id is string => id !== null),
    ),
  ]);
  const entries = permitted
    .map((row) => toEntry(row, names))
    // The state filter is applied AFTER the join, because done-ness lives on
    // the source message and PostgREST cannot filter a root row on an embedded
    // column. Doing it in SQL would silently return everything.
    .filter((entry) => matchesState(entry, args.filters.state));

  await put(
    `${args.prefix}/tasks.csv`,
    serializeCsv([
      ["raised", "customer", "task", "detail", "due", "assigned to", "state"],
      ...entries.map((entry) => [
        entry.raised,
        csvSafeText(entry.customer),
        csvSafeText(entry.title),
        csvSafeText(entry.detail),
        entry.due,
        csvSafeText(entry.assignedTo),
        entry.state,
      ]),
    ]),
    "text/csv; charset=utf-8",
  );
  await put(
    `${args.prefix}/tasks.html`,
    renderTaskDocument({
      entries,
      filters: args.filters,
      withheld,
      capped,
      generatedAt: args.now.toISOString(),
    }),
    "text/html; charset=utf-8",
  );

  return { tasks: entries.length, withheld, capped };
}

/**
 * Whether a task counts as done.
 *
 * Exported because the rule is not obvious from the schema — `tasks` carries no
 * completion column and derives it from the source message (D17). A reader who
 * assumed otherwise would produce a file in which nothing was ever finished.
 */
export function isDone(row: Pick<TaskRow, "messages">): boolean {
  return (row.messages?.done_at ?? null) !== null;
}

function matchesState(entry: TaskEntry, state: string | undefined): boolean {
  if (state === "open") return entry.state === "Open";
  if (state === "done") return entry.state === "Done";
  return true;
}

function toEntry(row: TaskRow, names: Map<string, string>): TaskEntry {
  const contact = row.conversations?.contacts ?? null;
  return {
    raised: row.created_at,
    // The phone number is the fallback, not "unknown": a customer who was
    // never given a name is still identifiable to the person reading this.
    // It is the THREAD's number (#291), because that is the one to ring back.
    customer:
      contact?.name?.trim() || row.conversations?.contact_phone_e164 || "—",
    title: row.title,
    detail: row.description,
    // A task with no date is not overdue and not due today. Saying "no date"
    // is the difference between a list somebody can triage and one they cannot.
    due: row.due_at ?? "no date",
    assignedTo:
      row.assigned_user_id === null
        ? "Nobody yet"
        : (names.get(row.assigned_user_id) ?? "Someone who has left"),
    state: isDone(row) ? "Done" : "Open",
  };
}

/**
 * Member display names, so the file says who rather than a UUID.
 *
 * From `profiles`, which is where display names live — `company_members`
 * carries the role and not the person. Scoped to the ids actually on the page
 * rather than the whole table, matching how the calls route resolves actors.
 *
 * Best-effort: a lookup failure costs the names and not the export, because a
 * list of outstanding work is still useful without them and useless if the
 * whole build fails over a display detail.
 */
async function memberNames(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  try {
    const { data } = await db
      .from("profiles")
      .select("user_id,display_name")
      .in("user_id", userIds);
    for (const row of (data ?? []) as { user_id: string; display_name: string | null }[]) {
      if (row.display_name?.trim()) names.set(row.user_id, row.display_name.trim());
    }
  } catch {
    return names;
  }
  return names;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTaskDocument(args: {
  entries: TaskEntry[];
  filters: TaskExportFilters;
  withheld: number;
  capped: boolean;
  generatedAt: string;
}): string {
  const period =
    args.filters.from || args.filters.to
      ? `${args.filters.from ?? "the beginning"} to ${args.filters.to ?? "now"}`
      : "All work";
  const state =
    args.filters.state === "open"
      ? "Still outstanding"
      : args.filters.state === "done"
        ? "Finished"
        : "Outstanding and finished";

  const notes: string[] = [];
  if (args.withheld > 0) {
    notes.push(
      `${args.withheld} task${args.withheld === 1 ? "" : "s"} ` +
        `${args.withheld === 1 ? "is" : "are"} not included: ` +
        `${args.withheld === 1 ? "it belongs" : "they belong"} to a customer on ` +
        `a phone number the person who requested this export cannot see.`,
    );
  }
  if (args.capped) {
    notes.push(
      `This file stops at ${TASK_EXPORT_CAP.toLocaleString()} tasks. Narrow ` +
        `the dates to get the rest.`,
    );
  }

  const rows = args.entries
    .map(
      (entry) => `    <tr>
      <td class="when">${escapeHtml(entry.raised)}</td>
      <td>${escapeHtml(entry.customer)}</td>
      <td>${escapeHtml(entry.title)}</td>
      <td class="when">${escapeHtml(entry.due)}</td>
      <td>${escapeHtml(entry.assignedTo)}</td>
      <td>${escapeHtml(entry.state)}</td>
    </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Work — ${escapeHtml(period)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 32px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #656565; margin-bottom: 20px; }
  .note { border-left: 3px solid #656565; padding: 8px 12px; margin: 12px 0;
          background: #f3f3f3; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e0e0e0; padding: 6px 8px;
           vertical-align: top; text-align: left; }
  .when { white-space: nowrap; color: #656565; }
</style>
</head>
<body>
<h1>Work</h1>
<p class="meta">${escapeHtml(period)} · ${escapeHtml(state)} · ${
    args.entries.length
  } task${args.entries.length === 1 ? "" : "s"} · produced ${escapeHtml(
    args.generatedAt,
  )}</p>
${notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("\n")}
<table>
  <thead><tr><th>Raised</th><th>Customer</th><th>Task</th><th>Due</th><th>Assigned to</th><th>State</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>
`;
}
