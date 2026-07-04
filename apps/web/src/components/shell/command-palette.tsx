"use client";

import {
  Ban,
  CircleDot,
  Home,
  Inbox,
  ListChecks,
  MessageSquareText,
  PenSquare,
  Settings,
  Star,
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

const NAV_ACTIONS = [
  { label: "For you", href: "/for-you", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox },
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

/** A tiny inline accelerator key printed in a palette row (§1.2). */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-auto rounded-[5px] border border-app-line bg-app-line-soft px-1.5 py-0.5 text-[10px] font-semibold text-app-muted">
      {children}
    </kbd>
  );
}

/**
 * The "Actions on this conversation" group (PORTAL-UX §1.2), rendered only when
 * a conversation is open. A context chip names the target; the rows run the same
 * mutations the thread header uses (assign / status / done) plus deep-links for
 * make-a-task / template / review. Accelerator letters are printed inline so the
 * keyboard model teaches itself. Kept in its own component so the
 * useUpdateConversation/useConversation hooks mount only with an id.
 */
function ConversationActions({
  conversationId,
  onDone,
  onNavigate,
}: {
  conversationId: string;
  onDone: () => void;
  onNavigate: (href: string) => void;
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
          <Key>E</Key>
        </CommandItem>
        <CommandItem
          value="make a task"
          onSelect={() => onNavigate(`/inbox/${conversationId}`)}
        >
          <ListChecks className="size-4" strokeWidth={1.75} />
          Make a task
          <Key>T</Key>
        </CommandItem>
        <CommandItem
          value="send template"
          onSelect={() => onNavigate(`/inbox/${conversationId}`)}
        >
          <MessageSquareText className="size-4" strokeWidth={1.75} />
          Send template
          <Key>R</Key>
        </CommandItem>
        <CommandItem
          value="send review request"
          onSelect={() => onNavigate(`/inbox/${conversationId}`)}
        >
          <Star className="size-4" strokeWidth={1.75} />
          Send review request
        </CommandItem>
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
 * over any screen (⌘K, or the search glyphs dispatching `jobtext:open-command`).
 * When a conversation is open it leads with "Actions on this conversation", then
 * global search (conversations, contacts) and Go-to navigation. A calm floating
 * layer (the one permitted subtle shadow, on the dialog surface).
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
    window.addEventListener("jobtext:open-command", onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("jobtext:open-command", onOpenRequest);
    };
  }, []);

  // Debounce the search query (250 ms — G4) so the API sees settled input.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const search = useSearch(open ? query : "");
  const searching = query.trim().length >= 2;

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
      description="Jump to a conversation, contact, or page — or act on the open conversation"
      // The API search already ranked results; don't re-filter them away.
      commandProps={{ shouldFilter: !searching }}
    >
      <CommandInput
        placeholder="Search conversations and contacts…"
        value={input}
        onValueChange={setInput}
      />
      <CommandList>
        <CommandEmpty>
          {searching && search.isFetching ? "Searching…" : "No matches."}
        </CommandEmpty>

        {/* Context actions on the open conversation lead the palette (§1.2). */}
        {conversationId && !searching && (
          <ConversationActions
            conversationId={conversationId}
            onDone={close}
            onNavigate={go}
          />
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
