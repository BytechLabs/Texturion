"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FilterButton } from "@/components/ui/filter-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT, type Translate } from "@/i18n/provider";
import { useContactFields, type ContactFieldDef } from "@/lib/api/contact-fields";
import type { ContactFieldFilter } from "@/lib/api/contacts";
import { useTags } from "@/lib/api/tags";

/**
 * #291 / #711: narrowing the contacts list, behind the same Filter button the
 * inbox and Tasks use. A tag, or one answer to a custom field.
 *
 * Only the field kinds with a closed set of answers are offered. A text or
 * number field would need a free-text box, which is search, and search already
 * reads them. "Not set" is a real answer and comes first: it is exactly the
 * customers somebody still has to ask.
 */
export function ContactListFilter({
  field,
  onField,
  tag,
  onTag,
}: {
  field?: ContactFieldFilter;
  onField: (next: ContactFieldFilter | undefined) => void;
  tag?: string;
  onTag: (next: string | undefined) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const filterable = useFilterableFields();
  const tags = useTags().data?.data ?? [];
  if (filterable.length === 0 && tags.length === 0) return null;

  const count = (field ? 1 : 0) + (tag ? 1 : 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton count={count} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 shadow-lg">
        <Command>
          <CommandInput placeholder={t("inbox.filterByPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("inbox.filterNone")}</CommandEmpty>
            {tags.length > 0 && (
              <CommandGroup heading={t("contacts.tagFilterLabel")}>
                {tags.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={`tag-${row.name}`}
                    onSelect={() => {
                      onTag(tag === row.id ? undefined : row.id);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{row.name}</span>
                    {tag === row.id && (
                      <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filterable.map((definition) => (
              <CommandGroup key={definition.key} heading={definition.label}>
                {answersOf(definition, t).map((answer) => {
                  const chosen = field?.key === definition.key && field?.value === answer.value;
                  return (
                    <CommandItem
                      key={answer.value}
                      value={`${definition.label} ${answer.label}`}
                      onSelect={() => {
                        onField(chosen ? undefined : { key: definition.key, value: answer.value });
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{answer.label}</span>
                      {chosen && (
                        <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** #711: the applied contact filters as removable chips, only while any is on. */
export function ContactActiveFilters({
  field,
  onField,
  tag,
  onTag,
}: {
  field?: ContactFieldFilter;
  onField: (next: ContactFieldFilter | undefined) => void;
  tag?: string;
  onTag: (next: string | undefined) => void;
}) {
  const t = useT();
  const filterable = useFilterableFields();
  const tags = useTags().data?.data ?? [];
  if (!field && !tag) return null;

  const definition = field ? filterable.find((row) => row.key === field.key) : undefined;
  const answer =
    field && definition
      ? answersOf(definition, t).find((row) => row.value === field.value)?.label
      : undefined;
  const tagName = tag ? tags.find((row) => row.id === tag)?.name : undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tag && (
        <Chip
          label={tagName ?? t("contacts.tagFilterLabel")}
          onRemove={() => onTag(undefined)}
        />
      )}
      {field && (
        <Chip
          label={`${definition?.label ?? field.key}: ${answer ?? field.value}`}
          onRemove={() => onField(undefined)}
        />
      )}
      <button
        type="button"
        onClick={() => {
          onField(undefined);
          onTag(undefined);
        }}
        className="tap-target inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("inbox.clearAll")}
      </button>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-medium text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("inbox.removeFilterAria", { label })}
        className="tap-target rounded-full p-0.5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

function useFilterableFields(): ContactFieldDef[] {
  const fields = useContactFields();
  return (fields.data?.data ?? []).filter(
    (field) => field.kind === "select" || field.kind === "checkbox",
  );
}

/** A field's answers, "Not set" first. */
function answersOf(field: ContactFieldDef, t: Translate): { value: string; label: string }[] {
  const answers =
    field.kind === "checkbox"
      ? [
          { value: "yes", label: t("contacts.yes") },
          { value: "no", label: t("contacts.no") },
        ]
      : (field.options ?? []).map((choice) => ({ value: choice, label: choice }));
  return [{ value: "", label: t("contacts.notSet") }, ...answers];
}
