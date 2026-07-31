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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMentionableMembers } from "@/lib/api/conversations";
import type { MentionableMember } from "@/lib/api/types";
import { usePointerCoarse } from "@/lib/use-pointer-coarse";

/**
 * Names a teammate on an internal note, opened by typing "@" in the note
 * composer.
 *
 * The list is the SERVER's answer to who may be named here, not a filter over
 * the whole team: a teammate who cannot open this thread must not be offered,
 * because the note quotes the customer.
 *
 * Presentation mirrors the saved-replies picker (#123): an anchored popover on
 * a pointer device, a bottom sheet on touch, where an autofocused search would
 * raise the keyboard over the list.
 */
export function MentionPicker({
  conversationId,
  open,
  onOpenChange,
  onPick,
  children,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (member: MentionableMember) => void;
  /** Anchor the desktop popover positions against (the composer pill). */
  children?: React.ReactNode;
}) {
  // Only fetched while the picker is open: a thread that never mentions anyone
  // should not cost a request.
  const members = useMentionableMembers(conversationId, open);
  const rows = members.data?.data ?? [];
  const coarse = usePointerCoarse();

  const label = (member: MentionableMember) =>
    member.display_name.trim() || "Teammate";
  const labels = new Map(rows.map((member) => [member.user_id, label(member)]));

  const list = (autoFocus: boolean) => (
    // Filter on the NAME only. Using the row value meant the uuid was
    // searchable, so any hex-looking query ("abc", "1234") matched every
    // teammate at once.
    <Command
      filter={(value, search) => {
        const name = labels.get(value) ?? "";
        return name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
      }}
    >
      <CommandInput placeholder="Search teammates…" autoFocus={autoFocus} />
      <CommandList>
        <CommandEmpty>
          {members.isPending
            ? "Loading teammates…"
            : members.isError
              ? "Couldn't load teammates."
              : rows.length === 0
                ? "No teammates can see this conversation."
                : "No teammates match."}
        </CommandEmpty>
        {rows.length > 0 && (
          <CommandGroup heading="Mention">
            {rows.map((member) => (
              <CommandItem
                key={member.user_id}
                // The id alone: two teammates who share a display name must
                // stay two rows, and the filter above matches on the name.
                value={member.user_id}
                onSelect={() => {
                  onPick(member);
                  onOpenChange(false);
                }}
              >
                <span className="truncate text-sm">{label(member)}</span>
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
          className="max-h-[70svh] gap-0 rounded-t-2xl border-app-line bg-app-paper p-0 pb-[env(safe-area-inset-bottom)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b border-app-line-soft px-4 py-3">
            <SheetTitle className="text-[15px]">Mention a teammate</SheetTitle>
            <SheetDescription className="sr-only">
              Pick a teammate to name on this note. They will be notified.
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
      <PopoverContent align="start" side="top" className="w-72 p-0">
        {list(true)}
      </PopoverContent>
    </Popover>
  );
}
