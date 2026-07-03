"use client";

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
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useTemplates } from "@/lib/api/templates";

/**
 * Saved-replies picker (APP-LAYOUT-V2 §3.1): a controlled, anchor-based popover
 * so it can open from the composer's `+` overflow (desktop toolbar / mobile
 * sheet) AND from `/` typed in an empty draft (G5 lock). Selecting inserts the
 * template BODY into the draft — the §5 footer/attestation rules still apply
 * server-side untouched.
 *
 * The picker renders no trigger of its own; the composer owns the `+`/toolbar
 * affordance and anchors this popover to the field via `children`.
 */
export function TemplatePicker({
  open,
  onOpenChange,
  onInsert,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (body: string) => void;
  /** Anchor element the popover positions against (the composer pill). */
  children?: React.ReactNode;
}) {
  const templates = useTemplates();
  const rows = templates.data?.data ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children ? <PopoverAnchor asChild>{children}</PopoverAnchor> : null}
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
