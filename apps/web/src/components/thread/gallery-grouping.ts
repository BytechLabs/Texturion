import { differenceInCalendarDays, format, isSameYear } from "date-fns";

import type { GalleryItem, GallerySource } from "@/lib/api/types";

/**
 * Client-side view logic for the attachments gallery (§5.2): the Images | Files
 * split and the date grouping, kept pure so they're unit-testable and the React
 * component stays about rendering.
 */

/** The two category tabs, trimmed to a tradesperson's reality (§5.2). */
export type GalleryTab = "images" | "files";

/** Keep only the items for the active tab. `kind` is the API's own split. */
export function itemsForTab(items: GalleryItem[], tab: GalleryTab): GalleryItem[] {
  const kind = tab === "images" ? "image" : "file";
  return items.filter((item) => item.kind === kind);
}

/** Origin `source` → the display tag shown on a thumbnail (UI layer only). */
export function sourceLabel(source: GallerySource): string {
  switch (source) {
    case "mms":
      return "Message";
    case "note":
      return "Note";
    case "task":
      return "Task";
  }
}

/**
 * A date-group heading: "Today", "Yesterday", "July 2" (same year), or
 * "July 2, 2025" (older) — the calm date grouping from §5.2. The gallery is
 * already sorted (created_at, id) DESC by the API, so consecutive items with the
 * same heading form one contiguous group.
 */
export function dateGroupLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  // Calendar-day delta in local time, honoring the passed `now` (date-fns
  // isToday/isYesterday ignore a reference date and read the wall clock).
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (isSameYear(date, now)) return format(date, "MMMM d");
  return format(date, "MMMM d, yyyy");
}

export interface GalleryDateGroup {
  label: string;
  items: GalleryItem[];
}

/**
 * Fold a (already DESC-sorted) item list into contiguous date groups. Preserves
 * order; never re-sorts (the API owns the sort, §5.2 / conversations-gallery).
 */
export function groupByDate(
  items: GalleryItem[],
  now: Date = new Date(),
): GalleryDateGroup[] {
  const groups: GalleryDateGroup[] = [];
  for (const item of items) {
    const label = dateGroupLabel(item.created_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

/** Human file size for the Files list ("1.2 MB", "8 KB"). Tabular-friendly. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * A readable file label for the Files list / download link: the stored file
 * name when present, else a plain fallback derived from the content type.
 */
export function fileLabel(item: GalleryItem): string {
  if (item.file_name && item.file_name.trim() !== "") return item.file_name;
  const subtype = item.content_type?.split("/")[1]?.toUpperCase();
  return subtype ? `${subtype} file` : "File";
}
