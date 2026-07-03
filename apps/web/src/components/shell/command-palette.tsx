"use client";

import {
  Home,
  Inbox,
  ListChecks,
  MessageSquareText,
  PenSquare,
  Settings,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useSearch } from "@/lib/api/search";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";

/** ts_headline snippets carry <b> markers; the palette renders plain text. */
function plainSnippet(snippet: string): string {
  return snippet.replace(/<\/?b>/g, "");
}

const NAV_ACTIONS = [
  { label: "For You", href: "/for-you", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Templates", href: "/templates", icon: MessageSquareText },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

/**
 * Command-K palette (G3, desktop): navigate, search conversations/contacts
 * via GET /v1/search (debounced 250 ms, ≥2 chars — G4), and start a new
 * conversation.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    // The top-bar search field opens the same palette on click (a prominent,
    // inviting search that shares the Cmd-K flow, APP-SHELL-REDESIGN §3).
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

  function go(href: string) {
    setOpen(false);
    setInput("");
    setQuery("");
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setInput("");
          setQuery("");
        }
      }}
      title="Command palette"
      description="Jump to a conversation, contact, or page"
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
