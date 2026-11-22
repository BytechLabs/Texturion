"use client";

import { PageHeader } from "@/components/ui/page-header";
import { CalendarClock, SquarePen } from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { ConversationsNavigation } from "@/components/shell/conversations-navigation";
import { usePhoneLine } from "@/components/shell/phone-line";
import { useT } from "@/i18n/provider";
import { useSavedViews } from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";
import { inboxHref, mergeInboxListParams } from "@/lib/inbox/thread-href";

import { ConversationList } from "./conversation-list";
import { FilterBar } from "./filter-bar";
import { GettingStartedCard } from "./getting-started-card";
import { hasActiveFilters, isSearchingInbox, parseInboxSearchParams, searchQueryOf, serializeInboxFilters, toConversationFilters } from './filter-url';
import type { InboxUrlFilters } from './filter-url';
import { viewFiltersToUrl } from "./saved-view-filters";
import { SearchResults } from "./search-results";

/**
 * The G4 list pane: filter bar → virtualized conversation list, or grouped
 * search results when a query ≥2 chars is active. (The workspace status banner
 * now lives app-wide in the shell.) URL owns every filter (G3); `router.replace`
 * keeps back-button history clean while filtering.
 */
export function InboxPane({
  compact,
  displayMenu,
}: {
  compact: boolean;
  displayMenu: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const params = useParams<{ conversationId?: string }>();
  const { userId } = useActiveCompany();
  const { selected, select } = usePhoneLine();

  const filters = useMemo(
    () => parseInboxSearchParams(new URLSearchParams(currentQuery)),
    [currentQuery],
  );
  useEffect(() => {
    if (filters.line) select(filters.line);
  }, [filters.line, select]);

  const setFilters = useCallback(
    (next: InboxUrlFilters) => {
      const query = mergeInboxListParams(currentQuery, serializeInboxFilters(next)).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, currentQuery],
  );

  // #280: land on the view this member chose.
  //
  // Only when the URL carries NOTHING. A person who arrived through a link, or
  // who cleared the filters on purpose, has said what they want to see, and a
  // default that overrides that would be a screen that argues with you. The ref
  // makes it a once-per-mount redirect rather than a rule that fights every
  // later navigation back to a bare /inbox.
  const savedViews = useSavedViews("conversations");
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || pathname !== "/inbox" || currentQuery !== "") return;
    const defaultId = savedViews.data?.defaults.conversations ?? null;
    if (defaultId === null) return;
    const view = savedViews.data?.data.find((v) => v.id === defaultId);
    if (!view) return;
    landed.current = true;
    router.replace(
      `${pathname}${serializeInboxFilters(viewFiltersToUrl(view.filters))}`,
      { scroll: false },
    );
  }, [savedViews.data, currentQuery, router, pathname]);

  const q = searchQueryOf(filters);
  // #548: the same rule the filter bar goes quiet on. Written out twice, the
  // bar could leave a status tab lit over results that ignore it.
  const searching = isSearchingInbox(filters);
  const activeConversationId =
    typeof params.conversationId === "string" && params.conversationId !== "new"
      ? params.conversationId
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-ground">
      <ConversationsNavigation />
      {/* #715 / #732: the page's one main action, in the header every page
          shares. Scheduled is a view of this inbox. */}
      <PageHeader
        className="px-4 pb-2 pt-4"
        title={t("inbox.title")}
        secondary={
          <>
            <Button asChild size="icon-sm" variant="ghost" className="size-11 md:size-8">
              <Link href="/inbox/scheduled" aria-label={t("shell.navScheduled")} title={t("shell.navScheduled")}>
                <CalendarClock className="size-4" strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
            {displayMenu}
          </>
        }
        primary={
          <Button asChild size="sm">
            <Link href={inboxHref({ conversationId: "new", listQuery: currentQuery })}>
              <SquarePen className="size-4" strokeWidth={1.75} aria-hidden />
              {t("inbox.newTextAction")}
            </Link>
          </Button>
        }
      />
      <FilterBar filters={filters} onChange={setFilters} />
      {searching ? (
        <SearchResults q={q} listQuery={currentQuery} activeConversationId={activeConversationId} />
      ) : (
        <>
          {/* G7 step 7: the dismissible getting-started checklist sits atop
              the list (renders null while loading, when dismissed, or once
              every step is done). */}
          <div className="px-4 pb-2 pt-1 empty:hidden">
            <GettingStartedCard />
          </div>
          <ConversationList
            compact={compact}
            filters={toConversationFilters({ ...filters, line: filters.line ?? selected?.id }, userId)}
            hasUrlFilters={hasActiveFilters(filters)}
            activeConversationId={activeConversationId}
            listQuery={currentQuery}
          />
        </>
      )}
    </div>
  );
}
