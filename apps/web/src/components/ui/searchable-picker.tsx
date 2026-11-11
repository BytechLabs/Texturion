"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useMemo, useState } from "react";

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
import { SELECT_TRIGGER_CLASS } from "@/components/ui/select";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label: string;
  /** Section heading in the open list (the time zone's area). */
  group?: string;
  /** One line under the label in the open list. */
  description?: string;
};

/**
 * #746: the one searchable picker, for a long list somebody finds by typing:
 * time zones, countries, teammates.
 *
 * It is a combobox. The closed field is drawn exactly like `SimpleSelect`'s
 * and shows the chosen label only; the open list has a search box, optional
 * group headings and an optional description per option. A stored value that is
 * not in the list is shown as it is. With `allowCustom`, whatever was typed
 * and matches nothing can be used as typed (a country that is not on the
 * list is still an address).
 */
export function SearchablePicker({
  value,
  onValueChange,
  options,
  ariaLabel,
  id,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled,
  allowCustom,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly PickerOption[];
  ariaLabel?: string;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();

  const chosen = options.find((option) => option.value === value);
  const groups = useMemo(() => {
    const out: { heading: string | undefined; items: PickerOption[] }[] = [];
    for (const option of options) {
      const last = out[out.length - 1];
      if (last && last.heading === option.group) last.items.push(option);
      else out.push({ heading: option.group, items: [option] });
    }
    return out;
  }, [options]);

  const typed = query.trim();
  const offerTyped =
    allowCustom === true &&
    typed !== "" &&
    !options.some(
      (option) => option.label.toLowerCase() === typed.toLowerCase(),
    );

  function choose(next: string) {
    setOpen(false);
    if (next !== value) onValueChange(next);
  }

  const shown = chosen?.label ?? (value === "" ? undefined : value);

  return (
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
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          data-value={value}
          data-placeholder={shown === undefined ? "" : undefined}
          className={cn(SELECT_TRIGGER_CLASS, "w-full", className)}
        >
          <span className="line-clamp-1 text-left">{shown ?? placeholder}</span>
          <ChevronsUpDown
            className="size-4 shrink-0 opacity-50"
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
        align="start"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder ?? t("misc.pickerSearchPlaceholder")}
          />
          <CommandList id={listId}>
            <CommandEmpty>{emptyLabel ?? t("misc.pickerNoMatch")}</CommandEmpty>
            {offerTyped && (
              <CommandGroup>
                <CommandItem
                  value={`typed ${typed}`}
                  forceMount
                  onSelect={() => choose(typed)}
                >
                  {t("misc.pickerUseTyped", { value: typed })}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((group, index) => (
              <CommandGroup key={group.heading ?? index} heading={group.heading}>
                {group.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    data-value={option.value}
                    // The closure's value, not cmdk's argument: some cmdk
                    // versions normalise the casing.
                    onSelect={() => choose(option.value)}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        option.value === value ? "opacity-100" : "opacity-0",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
