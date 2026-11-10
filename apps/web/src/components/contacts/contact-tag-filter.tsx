"use client";

import { X } from "lucide-react";

import { useT } from "@/i18n/provider";
import { useTags } from "@/lib/api/tags";

/**
 * #695 - narrow the customer list to one tag.
 *
 * Absent until the workspace has a tag at all, so a crew that has never tagged
 * anything sees the list exactly as before. Once chosen, the active tag is a
 * chip you can see and clear: a list that is quietly filtered looks like one
 * with customers missing.
 *
 * *Applying: the Safety principle - the state of the view is always legible.
 * Zen of Clarity - one native select beside the search box.*
 */
export function ContactTagFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
}) {
  const t = useT();
  const tags = useTags();
  const list = tags.data?.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="contact-filter-tag">
        {t("contacts.tagFilterLabel")}
      </label>
      <select
        id="contact-filter-tag"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-9 rounded-app-ctrl border border-app-line bg-app-paper px-2 text-[13px] text-app-ink"
      >
        <option value="">{t("contacts.tagFilterAll")}</option>
        {list.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
      {value && (
        <button
          type="button"
          aria-label={t("contacts.tagFilterClear")}
          onClick={() => onChange(undefined)}
          className="tap-target rounded-app-ctrl px-2 py-1 text-[12px] text-app-muted-2 transition-colors duration-150 hover:bg-app-line-soft hover:text-app-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
