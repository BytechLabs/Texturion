import type { Template } from "@/lib/api/types";

/**
 * #274 — templates in their groups, for the SETTINGS list.
 *
 * The half of "a flat list collapses at thirty" that ordering cannot fix:
 * somebody maintaining templates is looking for a GROUP of them ("all the
 * quoting ones"), and no sort answers that.
 *
 * Ungrouped rows come LAST, under no heading. They are not a category called
 * "Other" — a heading invents a group the crew did not make, and in a workspace
 * that never uses categories it would label every single row.
 */
export function groupTemplates(
  rows: Template[],
): { label: string | null; rows: Template[] }[] {
  const byCategory = new Map<string, Template[]>();
  const ungrouped: Template[] = [];
  for (const row of rows) {
    const category = row.category?.trim();
    if (!category) {
      ungrouped.push(row);
      continue;
    }
    const existing = byCategory.get(category);
    if (existing) existing.push(row);
    else byCategory.set(category, [row]);
  }
  const groups = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupRows]) => ({ label: label as string | null, rows: groupRows }));
  if (ungrouped.length > 0) groups.push({ label: null, rows: ungrouped });
  return groups;
}
