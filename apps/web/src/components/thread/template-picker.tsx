"use client";

import { FileText } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTemplates } from "@/lib/api/templates";

/**
 * Saved-replies picker (G5): toolbar button, and `/` in an empty composer
 * opens it inline. Selecting inserts the template BODY into the draft — the
 * §5 footer/attestation rules still apply server-side untouched.
 */
export function TemplatePicker({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (body: string) => void;
}) {
  const templates = useTemplates();
  const rows = templates.data?.data ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Insert a saved reply"
            >
              <FileText className="size-4" strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Saved replies — or type “/”</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search saved replies…" autoFocus />
          <CommandList>
            <CommandEmpty>
              {templates.isPending
                ? "Loading saved replies…"
                : templates.isError
                  ? "Couldn't load saved replies."
                  : "No saved replies yet. Create them under Templates."}
            </CommandEmpty>
            {rows.length > 0 && (
              <CommandGroup heading="Saved replies">
                {rows.map((template) => (
                  <CommandItem
                    key={template.id}
                    value={`${template.name} ${template.body}`}
                    onSelect={() => {
                      onInsert(template.body);
                      onOpenChange(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {template.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {template.body}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
