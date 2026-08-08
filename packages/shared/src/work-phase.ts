/**
 * #294 — before and after, the one classification the trade actually uses.
 *
 * ## Where it lives, and why that is not an implementation detail
 *
 * D28 decided that attachments enter through exactly two doors — a text, or a note —
 * and that a task's files are a DERIVED view over those, never a third upload path.
 * So "mark this photo as an after" cannot be a property of the photo without
 * inventing the ingress D28 removed.
 *
 * It is a property of the NOTE instead. A note is already the link between a set of
 * files and a job: it has an author, a moment, and a task. A tech does not photograph
 * one thing before and a different thing after — they take a handful of pictures when
 * they arrive and a handful when they finish, and each handful arrives together on
 * one note. Labelling the note is therefore both the smaller change and the truer
 * model of the work.
 *
 * ## Why grouping and attribution come free
 *
 * Once the note carries the label, a job's photo set groups by note, orders by the
 * note's time, and attributes to the note's author with nothing further stored. The
 * "flat list with no structure" this issue complains about is structured by the same
 * column.
 *
 * ## Why the order is chronological rather than before-then-after
 *
 * A job record should read as what happened, in the order it happened. Chronological
 * ordering puts the befores first anyway, because that is when they were taken — and
 * when somebody mislabels one, the timeline stays honest instead of quietly
 * reordering the day to match the label.
 */

/** The two labels, in the order they appear on a job. */
export const WORK_PHASES = ["before", "after"] as const;

export type WorkPhase = (typeof WORK_PHASES)[number];

/** What each is called on screen. */
export const WORK_PHASE_LABELS: Record<WorkPhase, string> = {
  before: "Before",
  after: "After",
};

/**
 * The choice offered when there is no label yet.
 *
 * Named rather than "None", because most notes are neither: a note saying the part
 * is on order is not an unlabelled before. Offering "None" invites a tech to think
 * they have failed to fill something in.
 */
export const WORK_PHASE_UNSET_LABEL = "Not a before or after";

/** One line under the control, for somebody who has never seen it. */
export const WORK_PHASE_HINT =
  "Marks these photos as how it looked when you arrived, or how you left it.";

export function isWorkPhase(value: unknown): value is WorkPhase {
  return typeof value === "string" && (WORK_PHASES as readonly string[]).includes(value);
}

/**
 * One item of a task's derived photo set, in the shape the grouping needs.
 *
 * Deliberately structural rather than importing the API's row type: the same rule
 * runs on three clients that each model the row their own way.
 */
export interface JobPhotoLike {
  id: string;
  /** The note it arrived on. Null for the customer's own texted media. */
  note_id?: string | null;
  work_phase?: WorkPhase | null;
  /** Who added it. Null when the customer sent it. */
  added_by_user_id?: string | null;
  created_at: string;
}

/** A set of files that arrived together, at one moment, from one person. */
export interface JobPhotoGroup<T extends JobPhotoLike> {
  /**
   * The note they came in on, or null for the customer's own texted media.
   *
   * Also the group's identity: two notes written in the same second are still two
   * visits' worth of photos and must not merge.
   */
  note_id: string | null;
  work_phase: WorkPhase | null;
  added_by_user_id: string | null;
  /** The earliest item in the group — what the group is ordered by. */
  at: string;
  items: T[];
}

/**
 * Group a task's derived files into what a person would call visits.
 *
 * Everything the customer texted lands in ONE group with a null note, because it did
 * not arrive in visits and pretending otherwise would invent structure that is not
 * there. Everything else groups by the note it arrived on.
 *
 * Stable: items keep their relative order inside a group, and groups are ordered by
 * their earliest item. Ties break on the group key so two notes written in the same
 * second do not swap places between renders.
 */
export function groupJobPhotos<T extends JobPhotoLike>(
  items: readonly T[],
): JobPhotoGroup<T>[] {
  const groups = new Map<string, JobPhotoGroup<T>>();
  for (const item of items) {
    const noteId = item.note_id ?? null;
    const key = noteId ?? "";
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        note_id: noteId,
        work_phase: item.work_phase ?? null,
        added_by_user_id: item.added_by_user_id ?? null,
        at: item.created_at,
        items: [item],
      });
      continue;
    }
    existing.items.push(item);
    // The group's time is its earliest file, so a slow second upload does not
    // move a visit later in the day than it happened.
    if (item.created_at < existing.at) existing.at = item.created_at;
  }
  return [...groups.values()].sort((left, right) => {
    if (left.at !== right.at) return left.at < right.at ? -1 : 1;
    return (left.note_id ?? "") < (right.note_id ?? "") ? -1 : 1;
  });
}

/**
 * The one-line summary of a job's photo set: "3 before, 5 after".
 *
 * Returns null when there is nothing labelled, so a caller renders no summary at all
 * rather than "0 before, 0 after" — which reads as a broken count rather than as an
 * unlabelled job.
 */
export function jobPhaseSummary(items: readonly JobPhotoLike[]): string | null {
  let before = 0;
  let after = 0;
  for (const item of items) {
    if (item.work_phase === "before") before += 1;
    if (item.work_phase === "after") after += 1;
  }
  if (before === 0 && after === 0) return null;
  const parts: string[] = [];
  if (before > 0) parts.push(`${before} before`);
  if (after > 0) parts.push(`${after} after`);
  return parts.join(", ");
}
