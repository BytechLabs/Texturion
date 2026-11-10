"use client";

import { Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { roleHasCapability, suggestExistingTag } from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useAddContactTag, useRemoveContactTag } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import { useTags } from "@/lib/api/tags";
import type { ContactDetail } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * #695 - the tags a customer carries, on their page.
 *
 * The SAME vocabulary the conversations use (`GET /v1/tags`), so "Warranty" is
 * one word whether it is on a thread or on the person. The picker therefore
 * behaves like the conversation one: pick an existing tag, get nudged away from
 * a near-duplicate, and create a new one only when the workspace has not locked
 * its list.
 *
 * Removing a chip needs no confirmation and no toast: the control that undid it
 * is the one that did it, still on screen (docs/UNDO-AUDIT.md, self-reversing).
 *
 * *Applying: Zen of Clarity - chips and one quiet "+ Tag" affordance; the
 * picker is a popover so the page stays sparse. Relationship Strength - the
 * description sits directly under the title it explains.*
 */
export function ContactTags({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const add = useAddContactTag(contact.id);
  const remove = useRemoveContactTag(contact.id);
  const tags = useTags();
  const company = useCompany();
  const { role } = useActiveCompany();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const attached = contact.tags ?? [];
  const all = tags.data?.data ?? [];
  const available = all.filter((tag) => !attached.some((own) => own.id === tag.id));
  const trimmed = query.trim();

  // Catch a near-duplicate at creation, the same way a conversation's picker
  // does: sprawl is invisible while it happens.
  const suggestion = suggestExistingTag(trimmed, all);
  const suggested =
    suggestion && !attached.some((own) => own.id === suggestion.tag.id)
      ? suggestion
      : null;
  const exactExists = suggestion?.exact === true;
  const mayCreate =
    company.data?.tags_locked !== true ||
    roleHasCapability(role, "settings.manage");

  function attach(input: { tag_id: string } | { name: string }, failure: string) {
    add.mutate(input, { onError: (cause) => onApiError(cause, failure) });
    setOpen(false);
  }

  return (
    <SettingsCard title={t("contacts.contactTagsCard")}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("contacts.contactTagsBlurb")}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {attached.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
            >
              {tag.name}
              <button
                type="button"
                onClick={() =>
                  remove.mutate(tag.id, {
                    onError: (cause) =>
                      onApiError(cause, t("contacts.tagRemoveFailed")),
                  })
                }
                aria-label={t("contacts.removeTag", { name: tag.name })}
                className="tap-target rounded-full p-0.5 hover:bg-background"
              >
                <X className="size-3" strokeWidth={1.75} aria-hidden />
              </button>
            </span>
          ))}
          <Popover
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("contacts.addTag")}
                className="tap-target inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
              >
                <Plus className="size-3" strokeWidth={1.75} aria-hidden />
                {t("contacts.tagChip")}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-0">
              <Command>
                <CommandInput
                  placeholder={t("contacts.tagSearchPlaceholder")}
                  value={query}
                  onValueChange={setQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {trimmed === ""
                      ? t(
                          mayCreate
                            ? "contacts.typeToCreateTag"
                            : "contacts.typeToFindTag",
                        )
                      : !mayCreate
                        ? t("contacts.noTagAskAdmin")
                        : null}
                  </CommandEmpty>
                  <CommandGroup>
                    {available.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() =>
                          attach({ tag_id: tag.id }, t("contacts.tagAddFailed"))
                        }
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{tag.name}</span>
                          {tag.description != null && tag.description !== "" && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {tag.description}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                    {suggested && !suggested.exact && (
                      <CommandItem
                        value={`suggest-${suggested.tag.id}`}
                        onSelect={() =>
                          attach(
                            { tag_id: suggested.tag.id },
                            t("contacts.tagAddFailed"),
                          )
                        }
                      >
                        <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
                        {t("contacts.didYouMean", { name: suggested.tag.name })}
                      </CommandItem>
                    )}
                    {trimmed !== "" && !exactExists && mayCreate && (
                      <CommandItem
                        value={`create-${trimmed}`}
                        onSelect={() =>
                          attach({ name: trimmed }, t("contacts.tagCreateFailed"))
                        }
                      >
                        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
                        {t("contacts.createTag", { name: trimmed })}
                      </CommandItem>
                    )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </SettingsCard>
  );
}
