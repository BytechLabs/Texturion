"use client";

import Link from "next/link";
import { Fragment } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useSearch } from "@/lib/api/search";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

import { StatusPill } from "./status-pill";

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
  const search = useSearch(q);

  if (search.isPending) {
    return <SearchSkeleton />;
  }
  if (search.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Search isn&apos;t responding. Try again in a moment.
        </p>
      </div>
    );
  }
  if (!search.data) return <SearchSkeleton />;

  const { conversations, contacts } = search.data;
  if (conversations.length === 0 && contacts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          No matches for “{q.trim()}”.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {conversations.length > 0 && (
        <section aria-label="Matching conversations">
          <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            Conversations
          </h3>
          {conversations.map((hit) => (
            <Link
              key={hit.id}
              href={`/inbox/${hit.id}`}
              className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-150 ease-out hover:bg-secondary/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {contactDisplayName(hit.contact)}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {renderSnippet(hit.snippet)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className="text-xs tabular-nums text-foreground-tertiary"
                  title={formatAbsoluteDateTime(hit.matched_at)}
                >
                  {formatRelativeTime(hit.matched_at)}
                </span>
                <StatusPill status={hit.status} />
              </span>
            </Link>
          ))}
        </section>
      )}
      {contacts.length > 0 && (
        <section aria-label="Matching contacts">
          <h3 className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">
            Contacts
          </h3>
          {contacts.map((contact) => (
            <Link
              key={contact.id}
              href={`/inbox/new?contact=${contact.id}`}
              className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-150 ease-out hover:bg-secondary/60"
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
  return (
    <div aria-hidden className="flex-1 space-y-4 p-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
