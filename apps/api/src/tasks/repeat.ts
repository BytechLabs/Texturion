/**
 * Repeating jobs, priority and labels on the API side (#693, D153).
 *
 * The rule is stored and validated in SQL (`api_set_task_repeat`); this file
 * owns the request shape, the response shape, and the batch loader that puts
 * `labels` and `repeat` on task rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { unwrap } from "../routes/core/http";

export const PRIORITIES = ["none", "low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

export const prioritySchema = z.enum(PRIORITIES);

/** Sort rank of a priority, matching `tasks.priority_rank`. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

/** The repeat control's request body. The rule is checked again in SQL. */
export const repeatSchema = z
  .object({
    kind: z.enum(["schedule", "after_done"]),
    unit: z.enum(["day", "week", "month", "year"]),
    every: z.number().int().min(1).max(365).optional(),
    /** ISO weekdays, 1 = Monday .. 7 = Sunday. Weekly schedules. */
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    /** Monthly on a date. */
    month_day: z.number().int().min(1).max(31).optional(),
    /** Monthly on the nth weekday; -1 is the last one. */
    nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).optional(),
    nth_weekday: z.number().int().min(1).max(7).optional(),
    ends: z
      .object({
        kind: z.enum(["never", "on", "after"]),
        on: z.iso.date().optional(),
        after: z.number().int().min(1).max(1000).optional(),
      })
      .optional(),
    paused: z.boolean().optional(),
  })
  .strict();

export type RepeatInput = z.infer<typeof repeatSchema>;

/** "This one" or "this and future", for an edit or a delete on an occurrence. */
export const scopeSchema = z.enum(["this", "future"]);

const SERIES_COLUMNS =
  "id,kind,unit,every,weekdays,month_day,nth,nth_weekday,ends_kind,ends_on,ends_after,paused,stopped_at";

interface SeriesRow {
  id: string;
  kind: "schedule" | "after_done";
  unit: "day" | "week" | "month" | "year";
  every: number;
  weekdays: number[] | null;
  month_day: number | null;
  nth: number | null;
  nth_weekday: number | null;
  ends_kind: "never" | "on" | "after";
  ends_on: string | null;
  ends_after: number | null;
  paused: boolean;
  stopped_at: string | null;
}

/** A series as clients see it. */
export function publicRepeat(row: SeriesRow) {
  return {
    id: row.id,
    kind: row.kind,
    unit: row.unit,
    every: row.every,
    weekdays: row.weekdays,
    month_day: row.month_day,
    nth: row.nth,
    nth_weekday: row.nth_weekday,
    ends: { kind: row.ends_kind, on: row.ends_on, after: row.ends_after },
    paused: row.paused,
    stopped: row.stopped_at !== null,
  };
}

export type PublicRepeat = ReturnType<typeof publicRepeat>;

export interface TaskLabel {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Put `labels` and `repeat` on task rows with two queries however many rows
 * there are. A row keeps its other fields; `series_id` stays for clients that
 * group by series.
 */
export async function withLabelsAndRepeat<T extends Record<string, unknown>>(
  db: SupabaseClient,
  companyId: string,
  rows: T[],
): Promise<(T & { labels: TaskLabel[]; repeat: PublicRepeat | null })[]> {
  if (rows.length === 0) return [];
  const taskIds = rows.map((row) => row.id as string);
  const seriesIds = [
    ...new Set(
      rows
        .map((row) => row.series_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const [tagRows, seriesRows] = await Promise.all([
    db
      .from("task_tags")
      .select("task_id,tag:tags(id,name,color)")
      .eq("company_id", companyId)
      .in("task_id", taskIds)
      .then((res) =>
        unwrap<{ task_id: string; tag: TaskLabel | null }[]>(res, "task labels"),
      ),
    seriesIds.length === 0
      ? Promise.resolve([] as SeriesRow[])
      : db
          .from("task_series")
          .select(SERIES_COLUMNS)
          .eq("company_id", companyId)
          .in("id", seriesIds)
          .then((res) => unwrap<SeriesRow[]>(res, "task repeats")),
  ]);

  const labelsByTask = new Map<string, TaskLabel[]>();
  for (const row of tagRows) {
    if (!row.tag) continue;
    const list = labelsByTask.get(row.task_id) ?? [];
    list.push(row.tag);
    labelsByTask.set(row.task_id, list);
  }
  for (const list of labelsByTask.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const series =
      typeof row.series_id === "string" ? seriesById.get(row.series_id) : undefined;
    return {
      ...row,
      labels: labelsByTask.get(row.id as string) ?? [],
      repeat: series ? publicRepeat(series) : null,
    };
  });
}

/** One row, same loader. */
export async function withLabelsAndRepeatOne<T extends Record<string, unknown>>(
  db: SupabaseClient,
  companyId: string,
  row: T,
) {
  return (await withLabelsAndRepeat(db, companyId, [row]))[0];
}
