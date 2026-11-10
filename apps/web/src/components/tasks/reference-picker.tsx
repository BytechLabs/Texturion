"use client";

import { recordReferenceText, taskNumberLabel, taskReferenceText } from "@loonext/shared";
import { useEffect, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useT } from "@/i18n/provider";
import { flattenPages } from "@/lib/api/pagination";
import { useSearch } from "@/lib/api/search";
import { useTasks } from "@/lib/api/tasks";
import { usePointerCoarse } from "@/lib/use-pointer-coarse";

/**
 * #690: the picker `#` opens in a note, a task description or a task comment.
 *
 * It offers tasks (number, title, customer), and, unless the caller only wants
 * tasks, customers and conversations. Picking one hands back the text to put in
 * the draft (`#T-142`, `#contact-1a2b3c4d`, `#conv-1a2b3c4d`): a reference is
 * plain text, so a client that has never heard of references shows it as typed.
 *
 * Never mounted next to a text to a customer. A `#` there stays a `#`.
 *
 * Presentation mirrors the mention picker: an anchored popover on a pointer
 * device, a bottom sheet on touch.
 */
/** What was picked, for a caller that needs the record and not only the words. */
export interface PickedReference {
  kind: "task" | "contact" | "conversation";
  id: string;
}

export function ReferencePicker({
  open,
  onOpenChange,
  onPick,
  tasksOnly = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text to insert in place of the `#`, and what it points at. */
  onPick: (text: string, picked: PickedReference) => void;
  tasksOnly?: boolean;
  /** Anchor the desktop popover positions against. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const coarse = usePointerCoarse();

  const list = (autoFocus: boolean) => (
    <PickerList
      autoFocus={autoFocus}
      tasksOnly={tasksOnly}
      onPick={(text, picked) => {
        onPick(text, picked);
        onOpenChange(false);
      }}
    />
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
            <SheetTitle className="text-[15px]">{t("tasks.refPickTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("tasks.refPickDescription")}
            </SheetDescription>
          </SheetHeader>
          {open && list(false)}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children ? <PopoverAnchor asChild>{children}</PopoverAnchor> : null}
      <PopoverContent align="start" side="top" className="w-80 p-0">
        {open && list(true)}
      </PopoverContent>
    </Popover>
  );
}

function PickerList({
  autoFocus,
  tasksOnly,
  onPick,
}: {
  autoFocus: boolean;
  tasksOnly: boolean;
  onPick: (text: string, picked: PickedReference) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  // The server is asked once the typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Every assignee's open tasks, filtered by what was typed; a task number finds itself.
  const tasks = useTasks({ assigned_user_id: "all", ...(asked ? { q: asked } : {}) });
  const found = useSearch(tasksOnly ? "" : asked);
  const taskRows = flattenPages(tasks.data).slice(0, 8);
  const contactRows = tasksOnly ? [] : (found.data?.contacts ?? []).slice(0, 4);
  const conversationRows = tasksOnly ? [] : (found.data?.conversations ?? []).slice(0, 4);
  const empty =
    taskRows.length + contactRows.length + conversationRows.length === 0;

  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder={t(tasksOnly ? "tasks.refSearchTasks" : "tasks.refSearch")}
        autoFocus={autoFocus}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {empty && (
          <CommandEmpty>
            {tasks.isPending ? t("tasks.refLoading") : t("tasks.refNothing")}
          </CommandEmpty>
        )}
        {taskRows.length > 0 && (
          <CommandGroup heading={t("tasks.refTasks")}>
            {taskRows.map((task) => (
              <CommandItem
                key={task.id}
                value={`task-${task.id}`}
                disabled={task.number === undefined}
                onSelect={() =>
                  task.number !== undefined &&
                  onPick(taskReferenceText(task.number), { kind: "task", id: task.id })
                }
              >
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {task.number !== undefined ? taskNumberLabel(task.number) : ""}
                </span>
                <span className="truncate text-sm">{task.title}</span>
                {task.contact?.name && (
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {task.contact.name}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {contactRows.length > 0 && (
          <CommandGroup heading={t("tasks.refContacts")}>
            {contactRows.map((contact) => (
              <CommandItem
                key={contact.id}
                value={`contact-${contact.id}`}
                onSelect={() =>
                  onPick(recordReferenceText("contact", contact.id), {
                    kind: "contact",
                    id: contact.id,
                  })
                }
              >
                <span className="truncate text-sm">{contact.name ?? contact.phone_e164}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {conversationRows.length > 0 && (
          <CommandGroup heading={t("tasks.refConversations")}>
            {conversationRows.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`conv-${hit.id}`}
                onSelect={() =>
                  onPick(recordReferenceText("conversation", hit.id), {
                    kind: "conversation",
                    id: hit.id,
                  })
                }
              >
                <span className="truncate text-sm">
                  {hit.contact.name ?? hit.contact.phone_e164}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
