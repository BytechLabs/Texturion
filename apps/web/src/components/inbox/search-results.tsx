"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { Lock, SearchX } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { useT } from "@/i18n/provider";
import { useSearch } from "@/lib/api/search";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";

import { StatusPill } from "./status-pill";
import { threadHref } from "@/lib/inbox/thread-href";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";

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

/**
 * G4 search view: replaces the list when the query is ≥2 chars. Results
 * grouped Conversations / Contacts with snippet highlights; contacts open
 * the compose flow pre-filled.
 */
export function SearchResults({ q }: { q: string }) {
  const t = useT();
  const search = useSearch(q);

  if (search.isPending) {
    return <SearchSkeleton />;
  }
  if (search.isError) {
    return (
      <LoadError
        variant="fill"
        message={t("inbox.searchFailed")}
        onRetry={() => void search.refetch()}
      />
    );
  }
  if (!search.data) return <SearchSkeleton />;

  const { conversations, contacts } = search.data;
  if (conversations.length === 0 && contacts.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        icon={<SearchX strokeWidth={1.75} />}
        title={t("inbox.searchNoMatches", { query: q.trim() })}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {conversations.length > 0 && (
        <section aria-label={t("inbox.searchConversationsAria")}>
          <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            {t("inbox.searchConversationsHeading")}
          </h3>
          {conversations.map((hit) => (
            <Link
              key={hit.id}
              href={threadHref(hit.id, { messageId: hit.matched_message_id })}
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
          {contacts.map((contact) => (
            <Link
              key={contact.id}
              href={`/inbox/new?contact=${contact.id}`}
              className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate text-sm font-medium text-foreground">
                {contactDisplayName(contact)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-foreground-tertiary">
                {formatPhone(contact.phone_e164)}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return <ListSkeleton rows={4} lines={2} className="flex-1 space-y-4 p-4" />;
}
