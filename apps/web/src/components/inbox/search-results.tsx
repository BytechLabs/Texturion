"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { ResultsStatus } from "@/components/ui/results-status";
import { Lock, MessageSquarePlus, SearchX } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { useCanOpenSettings } from "@/components/settings/settings-link-guard";
import { useT } from "@/i18n/provider";
import { useInboxSearch } from "@/lib/api/search";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { trackThreadLinkFocus, useInboxFocus } from "@/lib/inbox/navigation-focus";
import { Timestamp } from "@/components/ui/timestamp";

import { StatusPill } from "./status-pill";
import { inboxHref } from "@/lib/inbox/thread-href";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Button } from "@/components/ui/button";
import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
import { SegmentedControl } from "@/components/ui/segmented-control";

type SearchScope = "all" | "texts" | "tasks" | "contacts";

interface SearchLink {
  id: string;
  title: string;
  href: string;
  conversationId?: string;
  snippet?: string;
  phone?: string | null;
}

/**
 * ts_headline emits <b>…</b> around matches (api_search SQL). Parse just
 * that — never inject server HTML — and render highlights as semibold.
 */
export function renderSnippet(snippet: string): React.ReactNode[] {
  const parts = snippet.split(/<\/?b>/);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={index}
        className="rounded-none bg-transparent font-semibold text-foreground"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export function SearchResults({
  q,
  listQuery = "",
  activeConversationId,
}: {
  q: string;
  listQuery?: string;
  activeConversationId?: string | null;
}) {
  const t = useT();
  const search = useInboxSearch(q);
  const canOpenSettings = useCanOpenSettings();
  const [scope, setScope] = useState<SearchScope>("all");
  const focus = useInboxFocus();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeConversationId || !search.data || !focus || !list.current || window.location.pathname !== "/inbox") {
      return;
    }
    const request = focus.current;
    if (!request?.searchResultId || request.headingPending) return;
    const links = list.current.querySelectorAll<HTMLAnchorElement>("a[data-inbox-result]");
    const link = Array.from(links).find((item) => item.dataset.inboxResult === request.searchResultId);
    if (!link || link.closest('[aria-hidden="true"]')) return;
    focus.current = null;
    link.focus({ preventScroll: true });
  }, [activeConversationId, focus, scope, search.data]);

  if (search.isPending) {
    return <SearchSkeleton />;
  }
  if (search.isError && !search.data) {
    return (
      <LoadError
        variant="fill"
        message={t("inbox.searchFailed")}
        onRetry={() => void search.refetch()}
      />
    );
  }
  if (!search.data) return <SearchSkeleton />;

  const [firstPage] = search.data.pages;
  const showTexts = scope === "all" || scope === "texts";
  const conversations = showTexts ? search.data.pages.flatMap((page) => page.conversations) : [];
  const seenConversations = new Set<string>();
  const uniqueConversations = conversations.filter(({ id }) => {
    if (seenConversations.has(id)) return false;
    seenConversations.add(id);
    return true;
  });
  const { tasks, attachments, voicemails, templates } = firstPage;
  const contacts = scope === "all" || scope === "contacts" ? firstPage.contacts : [];
  const otherGroups = [
    {
      scope: "tasks",
      heading: t("shell.navTasks"),
      hits: tasks.map((task) => ({ id: task.id, title: task.title, href: `/tasks?task=${task.id}` })),
    },
    {
      heading: t("shell.groupVoicemails"),
      hits: voicemails.map((hit) => ({
        id: hit.id,
        title: hit.caller_e164 ? formatPhone(hit.caller_e164) : t("shell.voicemail"),
        phone: hit.caller_e164,
        href: `/calls/${hit.call_session_id}`,
        snippet: hit.snippet,
      })),
    },
    {
      heading: t("shell.groupAttachments"),
      hits: attachments.flatMap((hit) => hit.conversation_id ? [{
        id: hit.id,
        title: hit.file_name,
        href: inboxHref({ conversationId: hit.conversation_id, listQuery }),
        conversationId: hit.conversation_id,
      }] : []),
    },
    {
      heading: t("shell.groupTemplates"),
      hits: canOpenSettings("templates") ? templates.map((hit) => ({
        id: hit.id,
        title: hit.name,
        href: "/settings/templates",
        snippet: hit.snippet,
      })) : [],
    },
  ].filter((group) => scope === "all" || group.scope === scope);
  const count = uniqueConversations.length + contacts.length +
    otherGroups.reduce((sum, group) => sum + group.hits.length, 0);

  function handleThreadLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    const { threadId, inboxResult } = event.currentTarget.dataset;
    if (threadId && inboxResult) {
      trackThreadLinkFocus(event, focus, threadId, threadId === activeConversationId, inboxResult);
    }
  }

  return (
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
      <ResultsStatus query={q} count={search.isPlaceholderData ? null : count} />
      <div className="sticky top-0 z-10 bg-app-ground px-4 py-2">
        <SegmentedControl
          value={scope}
          onChange={setScope}
          ariaLabel={t("inbox.searchScope")}
          size="sm"
          fill
          options={[
            { value: "all", label: t("inbox.searchScopeAll") },
            { value: "texts", label: t("inbox.searchScopeTexts") },
            { value: "tasks", label: t("shell.navTasks") },
            { value: "contacts", label: t("shell.navContacts") },
          ]}
        />
      </div>
      {count === 0 && (
        <EmptyState
          className="min-h-44"
          icon={<SearchX strokeWidth={1.75} />}
          title={t("inbox.searchNoMatches", { query: q.trim() })}
        />
      )}
      {uniqueConversations.length > 0 && (
        <section aria-label={t("inbox.searchConversationsAria")}>
          <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            {t("inbox.searchConversationsHeading")}
          </h3>
          {uniqueConversations.map((hit) => (
            <Link
              key={hit.id}
              data-thread-id={hit.id}
              data-inbox-result={`conversation:${hit.id}`}
              onClick={handleThreadLinkClick}
              href={inboxHref({
                conversationId: hit.id,
                listQuery,
                target: { messageId: hit.matched_message_id, findQuery: q },
              })}
              className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {contactDisplayName(hit.contact)}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {/* The matched message is an internal note (D29 direction) —
                      the same amber lock the conversation rows use. */}
                  {hit.direction === "note" && (
                    <Lock
                      className="size-3 shrink-0 text-app-amber"
                      strokeWidth={1.75}
                      aria-label={t("inbox.rowNoteAria")}
                    />
                  )}
                  <span className="min-w-0 truncate">
                    {renderSnippet(hit.snippet)}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Timestamp
                  at={hit.matched_at}
                  style="short"
                  className="text-xs text-foreground-tertiary"
                />
                <StatusPill status={hit.status} />
              </span>
            </Link>
          ))}
        </section>
      )}
      {contacts.length > 0 && (
        <section aria-label={t("inbox.searchContactsAria")}>
          <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            {t("inbox.searchContactsHeading")}
          </h3>
          {contacts.map((contact) => {
            const compose = inboxHref({ conversationId: "new", listQuery, contactId: contact.id });
            const thread = contact.conversation?.id;
            return (
              <div key={contact.id} className="flex items-center border-b border-border-subtle">
                <Link
                  href={thread ? inboxHref({ conversationId: thread, listQuery }) : compose}
                  data-thread-id={thread}
                  data-inbox-result={thread ? `contact:${contact.id}` : undefined}
                  onClick={thread ? handleThreadLinkClick : undefined}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {contactDisplayName(contact)}
                  </span>
                  <span className="truncate text-xs tabular-nums text-foreground-tertiary">
                    {contact.matched_line ?? formatPhone(contact.phone_e164)}
                  </span>
                </Link>
                {(!contact.name || !contact.matched_line) && (
                  <CopyablePhoneNumber number={contact.phone_e164} iconOnly className="p-2" />
                )}
                {thread && (
                  <Link
                    href={compose}
                    aria-label={t("recordMenu.text")}
                    className="grid min-h-11 min-w-11 place-items-center text-muted-foreground hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <MessageSquarePlus className="size-4" strokeWidth={1.75} aria-hidden />
                  </Link>
                )}
              </div>
            );
          })}
        </section>
      )}
      {otherGroups.map(({ heading, hits }) => (
        <SearchLinkGroup key={heading} heading={heading} hits={hits} onThreadLinkClick={handleThreadLinkClick} />
      ))}
      {showTexts && search.hasNextPage && (
        <div className="px-4 py-3">
          {search.isFetchNextPageError && (
            <p className="mb-2 text-sm text-destructive" role="alert">{t("inbox.searchFailed")}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            {t("inbox.searchMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function SearchLinkGroup({
  heading,
  hits,
  onThreadLinkClick,
}: {
  heading: string;
  hits: SearchLink[];
  onThreadLinkClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <section aria-label={heading}>
      <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">{heading}</h3>
      {hits.map((hit) => (
        <div key={hit.id} className="flex items-center border-b border-border-subtle">
          <Link
            href={hit.href}
            data-thread-id={hit.conversationId}
            data-inbox-result={hit.conversationId ? `attachment:${hit.id}` : undefined}
            onClick={hit.conversationId ? onThreadLinkClick : undefined}
            className="block min-w-0 flex-1 px-4 py-3 hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="block truncate text-sm font-medium text-foreground">{hit.title}</span>
            {hit.snippet && (
              <span className="block truncate text-sm text-muted-foreground">{renderSnippet(hit.snippet)}</span>
            )}
          </Link>
          {hit.phone && <CopyablePhoneNumber number={hit.phone} iconOnly className="mx-2 p-2" />}
        </div>
      ))}
    </section>
  );
}

function SearchSkeleton() {
  return <ListSkeleton rows={4} lines={2} className="flex-1 space-y-4 p-4" />;
}
