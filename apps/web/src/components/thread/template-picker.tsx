"use client";

import Link from "next/link";

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
              {templates.isPending ? (
                "Loading saved replies…"
              ) : templates.isError ? (
                "Couldn't load saved replies."
              ) : rows.length === 0 ? (
                // #66: templates live under Settings now — one human line plus
                // the actual door, never a dead end (APP-UI-ELEVATION §5).
                <span className="flex flex-col items-center gap-1.5">
                  No saved replies yet.
                  <Link
                    href="/settings/templates"
                    onClick={() => onOpenChange(false)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Create one in Settings › Templates
                  </Link>
                </span>
              ) : (
                // Rows exist but the search matched none.
                "No saved replies match."
              )}
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
