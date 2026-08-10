"use client";

import { X } from "lucide-react";

import { useT } from "@/i18n/provider";
import { useContactFields } from "@/lib/api/contact-fields";
import type { ContactFieldFilter } from "@/lib/api/contacts";

/**
 * #291 — narrow the list to one answer in one of the workspace's own fields.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent unless there is something worth filtering on.** Only a dropdown
 *   or a yes/no field has a closed set of answers; a serial number does not,
 *   and offering to filter by one would be a text box that returns nothing
 *   until it is typed perfectly. A workspace with neither kind sees no control
 *   at all rather than an empty one. *Applying: Zen of Clarity, and Prioritize
 *   Intent — complexity expands with the user's intent, not ahead of it.*
 *
 * - **One field at a time.** Two conditions combined is a report, and a report
 *   is a different screen with different expectations about accuracy.
 *
 * - **The active filter is a chip you can see and clear.** A list quietly
 *   filtered is a list that looks wrong: somebody scrolls for a customer who
 *   is not missing, they are excluded. *Applying: the Safety principle — the
 *   state of the view is always legible.*
 *
 * - **"Not set" is a choice.** Empty is a real answer on a custom field ("we
 *   asked, there is no gate code"), and it is the most useful filter of the
 *   lot: it lists exactly the customers somebody still has to ask.
 */
export function ContactFilter({
  value,
  onChange,
}: {
  value?: ContactFieldFilter;
  onChange: (next: ContactFieldFilter | undefined) => void;
}) {
  const t = useT();
  const fields = useContactFields();

  // Only the kinds with a closed set of answers. A text or number field would
  // need a free-text box, which is search — and search already reads them.
  const filterable = (fields.data?.data ?? []).filter(
    (field) => field.kind === "select" || field.kind === "checkbox",
  );
  if (filterable.length === 0) return null;

  const active = value
    ? filterable.find((field) => field.key === value.key)
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="contact-filter-field">
        {t("contacts.filterNarrowBy")}
      </label>
      <select
        id="contact-filter-field"
        value={value?.key ?? ""}
        onChange={(event) => {
          const key = event.target.value;
          if (!key) {
            onChange(undefined);
            return;
          }
          // A field with no answer chosen yet is not a filter — the server
          // refuses that pair, and it should: "has any answer" and "has none"
          // are different questions.
          onChange({ key, value: "" });
        }}
        className="h-9 rounded-app-ctrl border border-app-line bg-app-paper px-2 text-[13px] text-app-ink"
      >
        <option value="">{t("contacts.filterEveryone")}</option>
        {filterable.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </select>

      {active && (
        <>
          <label className="sr-only" htmlFor="contact-filter-value">
            {active.label}
          </label>
          <select
            id="contact-filter-value"
            value={value?.value ?? ""}
            onChange={(event) =>
              onChange({ key: active.key, value: event.target.value })
            }
            className="h-9 rounded-app-ctrl border border-app-line bg-app-paper px-2 text-[13px] text-app-ink"
          >
            {/* The most useful filter of the lot: exactly the customers
                somebody still has to ask. */}
            <option value="">{t("contacts.notSet")}</option>
            {active.kind === "checkbox"
              ? [
                  <option key="yes" value="yes">
                    {t("contacts.yes")}
                  </option>,
                  <option key="no" value="no">
                    {t("contacts.no")}
                  </option>,
                ]
              : (active.options ?? []).map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
          </select>
          <button
            type="button"
            aria-label={t("contacts.filterShowEveryone")}
            onClick={() => onChange(undefined)}
            className="tap-target rounded-app-ctrl px-2 py-1 text-[12px] text-app-muted-2 transition-colors duration-150 hover:bg-app-line-soft hover:text-app-ink"
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
