"use client";

import { SquarePen } from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useSavedViews } from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";

import { ConversationList } from "./conversation-list";
import { FilterBar } from "./filter-bar";
import { GettingStartedCard } from "./getting-started-card";
import {
  hasActiveFilters,
  isSearchingInbox,
  parseInboxSearchParams,
  searchQueryOf,
  serializeInboxFilters,
  toConversationFilters,
  type InboxUrlFilters,
} from "./filter-url";
import { SavedViewsBar } from "./saved-views-bar";
import { viewFiltersToUrl } from "./saved-view-filters";
import { SearchResults } from "./search-results";

/**
 * The G4 list pane: filter bar → virtualized conversation list, or grouped
 * search results when a query ≥2 chars is active. (The workspace status banner
 * now lives app-wide in the shell.) URL owns every filter (G3); `router.replace`
 * keeps back-button history clean while filtering.
 */
export function InboxPane() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ conversationId?: string }>();
  const { userId } = useActiveCompany();

  const filters = useMemo(
    () => parseInboxSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: InboxUrlFilters) => {
      // Filters live on /inbox itself; changing them from a thread keeps the
      // thread open (the list and the URL query string share the route tree).
      router.replace(`${pathname}${serializeInboxFilters(next)}`, {
        scroll: false,
      });
    },
    [router, pathname],
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
    if (landed.current || searchParams.toString() !== "") return;
    const defaultId = savedViews.data?.defaults.conversations ?? null;
    if (defaultId === null) return;
    const view = savedViews.data?.data.find((v) => v.id === defaultId);
    if (!view) return;
    landed.current = true;
    router.replace(
      `${pathname}${serializeInboxFilters(viewFiltersToUrl(view.filters))}`,
      { scroll: false },
    );
  }, [savedViews.data, searchParams, router, pathname]);

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
      {/* Mobile-only list header (title + New). On desktop the sidebar's
          "New message" button owns compose; below lg the floating FAB does. The
          segment + search below carry the filtering. */}
      <header className="flex items-center justify-between px-4 pb-1 pt-4 md:hidden">
        <h1 className="text-lg font-semibold text-app-ink">Inbox</h1>
        <Button asChild size="sm" variant="ghost" aria-label="New conversation">
          <Link href="/inbox/new">
            <SquarePen className="size-4" strokeWidth={1.75} />
            New
          </Link>
        </Button>
      </header>
      <FilterBar filters={filters} onChange={setFilters} />
      <SavedViewsBar filters={filters} onApply={setFilters} />
      {searching ? (
        <SearchResults q={q} />
      ) : (
        <>
          {/* G7 step 7: the dismissible getting-started checklist sits atop
              the list (renders null while loading, when dismissed, or once
              every step is done). */}
          <div className="px-4 pb-2 pt-1 empty:hidden">
            <GettingStartedCard />
          </div>
          <ConversationList
            filters={toConversationFilters(filters, userId)}
            hasUrlFilters={hasActiveFilters(filters)}
            activeConversationId={activeConversationId}
          />
        </>
      )}
    </div>
  );
}
