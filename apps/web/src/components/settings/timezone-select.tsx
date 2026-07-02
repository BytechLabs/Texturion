"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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
import {
  groupTimezones,
  supportedTimezones,
  timezoneLabel,
} from "@/lib/settings/timezone-options";
import { cn } from "@/lib/utils";

/**
 * Searchable, grouped IANA timezone picker (D15 — Settings → Workspace).
 * Combobox pattern: Popover + cmdk with one group per IANA area. The stored
 * value may predate the runtime's list (server default, another browser) —
 * it is prepended to its group so the current choice is always visible.
 */
export function TimezoneSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const zones = supportedTimezones();
    return groupTimezones(zones.includes(value) ? zones : [value, ...zones]);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Timezone"
          disabled={disabled}
          className="w-full justify-between font-normal sm:w-80"
        >
          {timezoneLabel(value)}
          <ChevronsUpDown
            className="size-4 shrink-0 opacity-50"
            strokeWidth={1.75}
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone matches that.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.region} heading={group.region}>
                {group.zones.map((zone) => (
                  <CommandItem
                    key={zone}
                    value={zone}
                    // The closure zone, not cmdk's callback arg — some cmdk
                    // versions normalize the value's casing.
                    onSelect={() => {
                      setOpen(false);
                      if (zone !== value) onChange(zone);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        zone === value ? "opacity-100" : "opacity-0",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {timezoneLabel(zone)}
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
