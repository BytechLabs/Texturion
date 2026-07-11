"use client";

import {
  Ban,
  CircleDot,
  FileText,
  Home,
  Image as ImageIcon,
  Inbox,
  ListChecks,
  MessageSquareText,
  PenSquare,
  PhoneIncoming,
  Settings,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useConversation, useUpdateConversation } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useSearch } from "@/lib/api/search";
import { useMembers } from "@/lib/api/team";
import type { ConversationStatus } from "@/lib/api/types";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";

/** ts_headline snippets carry <b> markers; the palette renders plain text. */
function plainSnippet(snippet: string): string {
  return snippet.replace(/<\/?b>/g, "");
}

/** image/* files get the image glyph; everything else the document glyph. */
function isImageType(contentType: string | null): boolean {
  return (contentType ?? "").toLowerCase().startsWith("image/");
}

/** A quiet metadata chip at the end of a search row (Note / Task / Done). */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto shrink-0 rounded-[5px] border border-app-line bg-app-line-soft px-1.5 py-0.5 text-[10px] font-medium text-app-muted">
      {children}
    </span>
  );
}

const NAV_ACTIONS = [
  { label: "For you", href: "/for-you", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Calls", href: "/calls", icon: PhoneIncoming },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

const STATUS_LABELS: Record<ConversationStatus, string> = {
  new: "New",
  open: "Open",
  waiting: "Waiting",
  closed: "Closed",
};

/** The `/inbox/:id` conversation id currently on the stage, or null. */
function openConversationId(pathname: string): string | null {
  const match = pathname.match(/^\/inbox\/([^/]+)$/);
  if (!match) return null;
  const id = match[1];
  return id === "new" ? null : id;
}

/**
 * The "Actions on this conversation" group (PORTAL-UX §1.2), rendered only when
 * a conversation is open. A context chip names the target; every row runs a
 * real mutation the thread header also exposes (done / assign / unassign /
 * status), so nothing here promises an action the palette can't perform. No row
 * prints an accelerator key: the app binds no single-letter hotkeys (the only
 * document keydown handler is the palette's own ⌘K toggle), so a printed letter
 * would advertise a shortcut that never fires. Kept in its own component so the
 * useUpdateConversation/useConversation hooks mount only with an id. Exported
 * for the palette's unit test.
 */
export function ConversationActions({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) {
  const detail = useConversation(conversationId);
  const update = useUpdateConversation(conversationId);
  const members = useMembers();
  const name = detail.data ? contactDisplayName(detail.data.contact) : "this conversation";

  const patch = (
    body: Parameters<typeof update.mutate>[0],
    label: string,
  ) => {
    update.mutate(body, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : "Couldn't update."),
      onSuccess: () => toast.success(label),
    });
    onDone();
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <CircleDot className="size-3 text-app-petrol" strokeWidth={2} aria-hidden />
        <span className="truncate text-[11px] font-medium text-app-muted">
          {name} · actions apply to this conversation
        </span>
      </div>
      <CommandGroup heading="Actions on this conversation">
        <CommandItem
          value="mark done conversation"
          onSelect={() => patch({ status: "closed" }, "Conversation closed")}
        >
          <ListChecks className="size-4" strokeWidth={1.75} />
          Mark done
        </CommandItem>
        {/* "Make a task" (T) and "Send template" (R) used to live here, but the
            palette can't perform either from outside the thread: make-a-task is
            a per-message popover (thread/message-actions) and the template
            picker lives in the composer, and neither exposes a trigger the
            palette can fire. Their old handlers only router.push'd to the very
            conversation this group already renders over (§1.2: shown solely when
            /inbox/:id is on the stage), so the accelerator keys promised an
            action that never ran. Removed rather than ship a control that lies;
            they return once the thread grows a compose trigger the palette can
            invoke. */}
        <CommandItem
          value="unassign conversation"
          onSelect={() => patch({ assigned_user_id: null }, "Unassigned")}
        >
          <Ban className="size-4" strokeWidth={1.75} />
          Unassign
        </CommandItem>
        {(members.data?.data ?? [])
          .filter((m) => m.deactivated_at === null)
          .map((member) => (
            <CommandItem
              key={member.user_id}
              value={`assign to ${member.display_name || "teammate"} ${member.user_id}`}
              onSelect={() =>
                patch(
                  { assigned_user_id: member.user_id },
                  `Assigned to ${member.display_name || "teammate"}`,
                )
              }
            >
              <UserRoundPlus className="size-4" strokeWidth={1.75} />
              Assign to {member.display_name || "Teammate"}
            </CommandItem>
          ))}
      </CommandGroup>
      <CommandGroup heading="Change status">
        {(["new", "open", "waiting", "closed"] as ConversationStatus[]).map(
          (status) => (
            <CommandItem
              key={status}
              value={`change status ${status}`}
              onSelect={() =>
                patch({ status }, `Marked ${STATUS_LABELS[status]}`)
              }
            >
              <CircleDot className="size-4" strokeWidth={1.75} />
              {STATUS_LABELS[status]}
            </CommandItem>
          ),
        )}
      </CommandGroup>
      <CommandSeparator />
    </>
  );
}

/**
 * The context-aware command palette (PORTAL-UX §1.2): the real navigator. Opens
 * over any screen (⌘K, or the search glyphs dispatching `loonext:open-command`).
 * When a conversation is open it leads with "Actions on this conversation", then
 * global search (D29: conversations, contacts, tasks, attachments, templates —
 * sections, never a blended list; a section with no hits renders nothing) and
 * Go-to navigation. A calm floating layer (the one permitted subtle shadow, on
 * the dialog surface).
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const conversationId = openConversationId(pathname);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    function onOpenRequest() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("loonext:open-command", onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("loonext:open-command", onOpenRequest);
    };
  }, []);

  // Debounce the search query (250 ms — G4) so the API sees settled input.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const search = useSearch(open ? query : "");
  const searching = query.trim().length >= 2;

  // cmdk's <CommandEmpty> is driven by its own filtered count, which is
  // meaningless while `shouldFilter` is off (the API already ranked). So in
  // search mode we render the empty/loading line ourselves: "Searching…" until
  // the first arm lands, "No matches." once every arm is in and empty.
  const results = search.data;
  const noHits =
    !!results &&
    results.conversations.length === 0 &&
    results.contacts.length === 0 &&
    results.tasks.length === 0 &&
    results.attachments.length === 0 &&
    results.templates.length === 0;
  const searchStatus: "searching" | "empty" | null = searching
    ? search.isFetching && !results
      ? "searching"
      : noHits && !search.isFetching
        ? "empty"
        : null
    : null;

  const reset = () => {
    setInput("");
    setQuery("");
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title="Command palette"
      description="Jump to a conversation, contact, task, file, template, or page, or act on the open conversation"
      // The API search already ranked results; don't re-filter them away.
      commandProps={{ shouldFilter: !searching }}
    >
      <CommandInput
        placeholder="Search conversations, contacts, tasks, files…"
        value={input}
        onValueChange={setInput}
      />
      <CommandList>
        {/* Local-filter mode (nav + actions): cmdk's own filtered count drives
            this. In search mode shouldFilter is off, so it never fires — the
            explicit row below owns that state instead. */}
        {!searching && <CommandEmpty>No matches.</CommandEmpty>}
        {searchStatus && (
          <div className="py-6 text-center text-sm text-app-muted">
            {searchStatus === "searching" ? "Searching…" : "No matches."}
          </div>
        )}

        {/* Context actions on the open conversation lead the palette (§1.2). */}
        {conversationId && !searching && (
          <ConversationActions conversationId={conversationId} onDone={close} />
        )}

        {searching && search.data && search.data.conversations.length > 0 && (
          <CommandGroup heading="Conversations">
            {search.data.conversations.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`conversation-${hit.id}`}
                onSelect={() => go(`/inbox/${hit.id}`)}
              >
                <Inbox className="size-4" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {contactDisplayName(hit.contact)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {plainSnippet(hit.snippet)}
                  </span>
                </span>
                {/* The matched message is an internal note, not the customer. */}
                {hit.direction === "note" && <Chip>Note</Chip>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && search.data && search.data.contacts.length > 0 && (
          <CommandGroup heading="Contacts">
            {search.data.contacts.map((contact) => (
              <CommandItem
                key={contact.id}
                value={`contact-${contact.id}`}
                onSelect={() => go(`/contacts/${contact.id}`)}
              >
                <Users className="size-4" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {contactDisplayName(contact)}
                  </span>
                  {contact.name && (
                    <span className="ml-2 text-muted-foreground tabular-nums">
                      {formatPhone(contact.phone_e164)}
                    </span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && search.data && search.data.tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {search.data.tasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`task-${task.id}`}
                // `?task=` opens the URL-driven drawer (TASKS-V2 D-A); the
                // drawer itself carries the conversation context and link.
                onSelect={() => go(`/tasks?task=${task.id}`)}
              >
                <ListChecks className="size-4" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {task.title}
                </span>
                {task.done && <Chip>Done</Chip>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && search.data && search.data.attachments.length > 0 && (
          <CommandGroup heading="Attachments">
            {search.data.attachments.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`attachment-${hit.id}`}
                // A file lives on the thing that was said (D28) — the deep
                // link lands on its thread.
                onSelect={() =>
                  go(hit.conversation_id ? `/inbox/${hit.conversation_id}` : "/inbox")
                }
              >
                {isImageType(hit.content_type) ? (
                  <ImageIcon className="size-4" strokeWidth={1.75} />
                ) : (
                  <FileText className="size-4" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {hit.file_name}
                </span>
                <Chip>{hit.owner_type === "note" ? "Note" : "Task"}</Chip>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && search.data && search.data.templates.length > 0 && (
          <CommandGroup heading="Templates">
            {search.data.templates.map((template) => (
              <CommandItem
                key={template.id}
                value={`template-${template.id}`}
                onSelect={() => go("/settings/templates")}
              >
                <MessageSquareText className="size-4" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{template.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {template.snippet}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Actions">
          <CommandItem
            value="new conversation"
            onSelect={() => go("/inbox/new")}
          >
            <PenSquare className="size-4" strokeWidth={1.75} />
            New conversation
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {NAV_ACTIONS.map((action) => (
            <CommandItem
              key={action.href}
              value={`go to ${action.label}`}
              onSelect={() => go(action.href)}
            >
              <action.icon className="size-4" strokeWidth={1.75} />
              {action.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
