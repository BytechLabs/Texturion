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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTemplates } from "@/lib/api/templates";
import { usePointerCoarse } from "@/lib/use-pointer-coarse";

/**
 * Saved-replies picker (APP-LAYOUT-V2 §3.1). Selecting inserts the template
 * BODY into the draft — the §5 footer/attestation rules still apply
 * server-side untouched.
 *
 * Two presentations (#123): on a pointer device it is an anchor-based popover
 * over the composer with an autofocused search. On TOUCH that model breaks —
 * the popover anchors near the bottom of the screen and the autofocus
 * keyboard slides up over it. So on coarse pointers it becomes a bottom Sheet
 * (top-anchored list, search at the top) with NO autofocus: the list is
 * immediately tappable, and if the user does tap Search the keyboard pushes
 * against the sheet from below instead of burying it.
 *
 * The picker renders no trigger of its own; the composer owns the `+`/toolbar
 * affordance and (on desktop) anchors this popover via `children`.
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
  /** Anchor element the desktop popover positions against (the composer pill). */
  children?: React.ReactNode;
}) {
  const templates = useTemplates();
  const rows = templates.data?.data ?? [];
  const coarse = usePointerCoarse();

  const list = (autoFocus: boolean) => (
    <Command>
      <CommandInput placeholder="Search saved replies…" autoFocus={autoFocus} />
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
  );

  if (coarse) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[70svh] gap-0 rounded-t-2xl border-app-line bg-app-white p-0 pb-[env(safe-area-inset-bottom)]"
          // Do not steal focus to the search on open — that is what raised the
          // keyboard over the list. The user taps a reply directly, or taps
          // Search deliberately.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b border-app-line-soft px-4 py-3">
            <SheetTitle className="text-[15px]">Saved replies</SheetTitle>
            <SheetDescription className="sr-only">
              Pick a saved reply to insert into your message.
            </SheetDescription>
          </SheetHeader>
          {list(false)}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children ? <PopoverAnchor asChild>{children}</PopoverAnchor> : null}
      <PopoverContent align="start" side="top" className="w-80 p-0">
        {list(true)}
      </PopoverContent>
    </Popover>
  );
}
