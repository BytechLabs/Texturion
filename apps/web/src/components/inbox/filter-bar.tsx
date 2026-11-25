"use client";

import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatNanpNumber } from "@loonext/shared";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SavedViewsMenu } from "@/components/saved-views/saved-views-menu";
import { CountPill } from "@/components/ui/count-pill";
import { FilterButton } from "@/components/ui/filter-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useConversations } from "@/lib/api/conversations";
import { flattenPages } from "@/lib/api/pagination";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import type { ConversationStatus } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { activeChips, applySegment, clearAllFilters, clearSecondary, formatOpenCount, INBOX_SEGMENTS, isSearchingInbox, OPEN_COUNT_CAP, OPEN_COUNT_FILTERS, segmentOf, serializeInboxFilters, STATUS_CHIP_KEYS } from './filter-url';
import type { ActiveChip, InboxSegment, InboxUrlFilters, SecondaryFilterKey } from './filter-url';
import {
  suggestViewName,
  urlFiltersToView,
  viewFiltersToUrl,
  viewMatchesUrl,
} from "./saved-view-filters";
import { MemberAvatar } from "./member-avatar";

interface InboxLine {
  id: string;
  label: string;
}

export function FilterBar({
  filters,
  onChange,
  searchOpen = false,
  searchFocusNonce = 0,
  onCloseSearch,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
  searchOpen?: boolean;
  searchFocusNonce?: number;
  onCloseSearch?: () => void;
}) {
  const t = useT();
  const segment = segmentOf(filters);
  const openCount = useOpenCount();
  const company = useCompany();
  const lines = company.data?.numbers?.flatMap(({ id, number_e164 }) =>
    number_e164 ? [{ id, label: formatNanpNumber(number_e164) }] : [],
  ) ?? [];
  const selectedLine = lines.find((line) => line.id === filters.line);
  // #548: a search reads every conversation, so while one is running these
  // controls cannot narrow anything.
  const searching = isSearchingInbox(filters);
  const chips = activeChips(filters);
  const showSearch = searchOpen || (filters.q ?? "") !== "";

  return (
    <div className="space-y-2 border-b border-app-line px-3.5 pb-2 pt-1">
      <div className="flex items-center gap-1">
        <SimpleSelect
          size="sm"
          ariaLabel={t("inbox.statusTablistAria")}
          disabled={searching}
          value={segment}
          onValueChange={(id) => onChange(applySegment(filters, id as InboxSegment))}
          className="mr-auto w-auto border-transparent bg-transparent px-1.5 font-medium text-app-ink shadow-none hover:bg-accent/60 dark:bg-transparent dark:hover:bg-accent/60"
          options={INBOX_SEGMENTS.map(({ id, labelKey }) => {
            const countLabel = id === "open" ? formatOpenCount(openCount) : "";
            return {
              value: id,
              label: t(labelKey),
              trailing: countLabel === "" ? undefined : (
                <CountPill
                  aria-label={
                    openCount > OPEN_COUNT_CAP
                      ? t("inbox.openCountOverAria", { cap: OPEN_COUNT_CAP })
                      : t("inbox.openCountAria", { count: openCount })
                  }
                >
                  {countLabel}
                </CountPill>
              ),
            };
          })}
        />
        <SavedViewsMenu
          surface="conversations"
          isCurrent={(view) => viewMatchesUrl(view, filters)}
          onApply={(view) => onChange(viewFiltersToUrl(view, filters))}
          currentFilters={() => urlFiltersToView(filters)}
          suggestName={() => suggestViewName(filters, {
            unassigned: t("inbox.shortcutUnassigned"),
            line: selectedLine?.label ?? t("inbox.filterGroupLine"),
          })}
          hasFilters={serializeInboxFilters(filters) !== ""}
          saveDescription={t("inbox.viewSaveDescription")}
          shareNote={t("inbox.viewShareNote")}
        />
        <FilterPopover
          filters={filters}
          lines={lines}
          activeCount={chips.length}
          onChange={onChange}
          disabled={searching}
        />
      </div>
      {showSearch && (
        <InboxSearch
          filters={filters}
          onChange={onChange}
          focusNonce={searchFocusNonce}
          onClose={onCloseSearch}
        />
      )}
      {chips.length > 0 && (
        <ChipRow
          filters={filters}
          chips={chips}
          lines={lines}
          onChange={onChange}
          disabled={searching}
        />
      )}
      {searching && (
        <p className="px-0.5 text-[11px] text-app-muted">
          {t("inbox.searchPausesFilters")}
        </p>
      )}
    </div>
  );
}

/**
 * §2.1 Open count: the bare open queue, counted from the real
 * GET /v1/conversations endpoint. The `9+` cap means the first page is always
 * enough, so we never page for a number — we count the loaded rows and, if the
 * first page is full and there's more, the cap swallows the difference.
 */
function useOpenCount(): number {
  const query = useConversations(OPEN_COUNT_FILTERS);
  const rows = flattenPages(query.data);
  // Once past the cap the exact number is irrelevant (it renders "9+"), so a
  // full first page + a next cursor is already "> cap".
  if (rows.length > OPEN_COUNT_CAP) return OPEN_COUNT_CAP + 1;
  if (query.hasNextPage) return OPEN_COUNT_CAP + 1;
  return rows.length;
}

/** Debounced search: 250ms to URL `q`; 2+ chars swaps the list for /v1/search. */
function InboxSearch({
  filters,
  onChange,
  focusNonce,
  onClose,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
  focusNonce: number;
  onClose?: () => void;
}) {
  const t = useT();
  const [searchText, setSearchText] = useState(filters.q ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // External URL change (back button, cleared filters) syncs the input.
  const urlQ = filters.q ?? "";
  const lastUrlQ = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setSearchText(urlQ);
    }
  }, [urlQ]);

  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  const setSearch = (value: string) => {
    setSearchText(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      lastUrlQ.current = value;
      const next = { ...filtersRef.current };
      if (value.trim() === "") delete next.q;
      else next.q = value;
      onChange(next);
    }, 250);
  };
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  return (
    <SearchField
      ref={inputRef}
      data-inbox-search
      containerClassName="min-w-0 flex-1"
      value={searchText}
      onValueChange={setSearch}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (searchText === "") {
          onClose?.();
        } else {
          setSearch("");
        }
      }}
      placeholder={t("inbox.searchShortPlaceholder")}
      aria-label={t("inbox.searchAria")}
      clearLabel={t("inbox.clearSearchAria")}
    />
  );
}

/**
 * §2.2 + §2.3: the always-visible removable chips followed by the `+ Filter`
 * button. The chips are the state made visible; the button opens the popover
 * that adds more. The whole row is one wrapping flex so a long chip list wraps
 * (or, on mobile, the chip row scrolls with the container) rather than pushing
 * the list down unpredictably.
 */
function ChipRow({
  filters,
  chips,
  lines,
  onChange,
  disabled,
}: {
  filters: InboxUrlFilters;
  chips: readonly ActiveChip[];
  lines: readonly InboxLine[];
  onChange: (next: InboxUrlFilters) => void;
  disabled: boolean;
}) {
  const t = useT();
  const tags = useTags();
  const members = useMembers();

  const labelFor = (key: SecondaryFilterKey, value?: string): string => {
    switch (key) {
      case "status": {
        // #548: only ever a status the segments cannot show, so the word alone
        // would sit beside four tabs meaning the same kind of thing.
        return t("inbox.statusChipLabel", {
          label: value
            ? t(STATUS_CHIP_KEYS[value as ConversationStatus])
            : t("inbox.statusChipUnset"),
        });
      }
      case "assignee": {
        if (value === "none") return t("inbox.shortcutUnassigned");
        return (
          members.data?.data.find((m) => m.user_id === value)?.display_name ||
          t("inbox.chipAssignee")
        );
      }
      case "line": {
        return lines.find((line) => line.id === value)?.label ?? t("inbox.filterGroupLine");
      }
      case "tag": {
        return (
          tags.data?.data.find((tag) => tag.id === value)?.name ??
          t("inbox.chipTag")
        );
      }
      case "unread": {
        return t("inbox.chipUnread");
      }
      case "spam": {
        return t("inbox.chipSpam");
      }
      case "snoozed": {
        return t("inbox.chipSnoozed");
      }
      case "awaiting": {
        return t("inbox.chipUnanswered");
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Only the NARROWING controls go quiet during a search — they are the
          ones a search overrules. Clear all stays live below, because it also
          clears the query, which makes it the way out rather than another
          control that does nothing. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 transition-opacity duration-150 ease-out",
          disabled && "opacity-45",
        )}
      >
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            label={labelFor(chip.key, chip.value)}
            memberId={chip.key === "assignee" && chip.value !== "none" ? chip.value : undefined}
            disabled={disabled}
            onRemove={() => onChange(clearSecondary(filters, chip.key))}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange(clearAllFilters())}
        className="tap-target ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-app-muted underline decoration-app-line underline-offset-2 transition-colors duration-150 ease-out hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("inbox.clearAll")}
      </button>
    </div>
  );
}

/** §2.2 removable stone-tinted chip — same tokens as the status pills, not petrol. */
function Chip({
  label,
  memberId,
  onRemove,
  disabled,
}: {
  label: string;
  memberId?: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-medium text-secondary-foreground">
      {memberId && <MemberAvatar name={label} memberId={memberId} />}
      {label}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t("inbox.removeFilterAria", { label })}
        className="tap-target rounded-full p-0.5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

/**
 * §2.3 the `+ Filter` command popover. It reuses the cmdk surface (the same one
 * that backs Cmd-K — no second menu is invented) inside a Popover: type to
 * filter properties, arrow-key to a value, Enter adds the chip + URL param and
 * closes. It is the one place a `shadow-lg` overlay is allowed in this region;
 * it closes on select / ESC / outside-click and leaves the applied filter
 * visible as a chip.
 */
function FilterPopover({
  filters,
  lines,
  activeCount,
  onChange,
  disabled,
}: {
  filters: InboxUrlFilters;
  lines: readonly InboxLine[];
  activeCount: number;
  onChange: (next: InboxUrlFilters) => void;
  disabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tags = useTags();
  const members = useMembers();
  const { userId } = useActiveCompany();

  const set = <K extends keyof InboxUrlFilters>(
    key: K,
    value: InboxUrlFilters[K],
  ) => {
    onChange({ ...filters, [key]: value });
    setOpen(false);
  };

  const assignableMembers = useMemo(
    () =>
      (members.data?.data ?? []).filter((m) => m.deactivated_at === null),
    [members.data],
  );
  const availableTags = tags.data?.data ?? [];
  const userFilter = filters.assignee === "me" ? userId : filters.assignee;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton compact count={activeCount} disabled={disabled} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 p-0 shadow-lg"
      >
        <Command
          // Match on the human keywords (member/tag names, "unread", "spam")
          // rather than the opaque `assignee-<uuid>` item values.
          filter={(_value, search, keywords) => {
            const haystack = (keywords ?? []).join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase().trim()) ? 1 : 0;
          }}
        >
          <CommandInput aria-label={t("inbox.filterAction")} placeholder={t("inbox.filterByPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("inbox.filterNone")}</CommandEmpty>
            <CommandGroup heading={t("inbox.filterGroupAssignee")}>
              <CommandItem
                value="assignee-none"
                keywords={[t("inbox.shortcutUnassigned"), t("inbox.filterGroupAssignee")]}
                onSelect={() => set("assignee", filters.assignee === "none" ? undefined : "none")}
              >
                {t("inbox.shortcutUnassigned")}
                {filters.assignee === "none" && (
                  <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                )}
              </CommandItem>
              {assignableMembers.map((m) => {
                const active = userFilter === m.user_id;
                const name = m.display_name || t("inbox.teammateFallback");
                return (
                  <CommandItem
                    key={m.user_id}
                    value={`assignee-${m.user_id}`}
                    keywords={[name, t("inbox.filterGroupAssignee")]}
                    onSelect={() =>
                      set("assignee", active ? undefined : m.user_id)
                    }
                  >
                    <MemberAvatar name={name} memberId={m.user_id} />
                    <span className="truncate">
                      {name}
                      {m.user_id === userId ? t("inbox.youSuffix") : ""}
                    </span>
                    {active && (
                      <Check
                        className="ml-auto size-4 text-primary"
                        strokeWidth={1.75}
                      />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {lines.length > 1 && (
              <CommandGroup heading={t("inbox.filterGroupLine")}>
                {lines.map((line) => {
                  const active = filters.line === line.id;
                  return (
                    <CommandItem
                      key={line.id}
                      value={`line-${line.id}`}
                      keywords={[line.label, t("inbox.filterGroupLine")]}
                      onSelect={() => set("line", active ? undefined : line.id)}
                    >
                      <span className="truncate">{line.label}</span>
                      {active && (
                        <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {availableTags.length > 0 && (
              <CommandGroup heading={t("inbox.filterGroupTag")}>
                {availableTags.map((tag) => {
                  const active = filters.tag === tag.id;
                  return (
                    <CommandItem
                      key={tag.id}
                      value={`tag-${tag.id}`}
                      keywords={[tag.name, t("inbox.filterGroupTag")]}
                      onSelect={() => set("tag", active ? undefined : tag.id)}
                    >
                      <span className="truncate">{tag.name}</span>
                      {active && (
                        <Check
                          className="ml-auto size-4 text-primary"
                          strokeWidth={1.75}
                        />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading={t("inbox.filterGroupMore")}>
              <CommandItem
                value="awaiting"
                keywords={[
                  t("inbox.chipUnanswered"),
                  "unanswered",
                  "awaiting",
                  "needs reply",
                  "waiting",
                  "no reply",
                ]}
                onSelect={() =>
                  set("awaiting", filters.awaiting ? undefined : true)
                }
              >
                <span>{t("inbox.chipUnanswered")}</span>
                {filters.awaiting && (
                  <Check
                    className="ml-auto size-4 text-primary"
                    strokeWidth={1.75}
                  />
                )}
              </CommandItem>
              <CommandItem
                value="unread"
                keywords={[t("inbox.chipUnread"), "unread"]}
                onSelect={() =>
                  set("unread", filters.unread ? undefined : true)
                }
              >
                <span>{t("inbox.chipUnread")}</span>
                {filters.unread && (
                  <Check
                    className="ml-auto size-4 text-primary"
                    strokeWidth={1.75}
                  />
                )}
              </CommandItem>
              <CommandItem
                value="spam"
                keywords={[t("inbox.chipSpam"), "spam"]}
                onSelect={() => set("spam", filters.spam ? undefined : true)}
              >
                <span>{t("inbox.chipSpam")}</span>
                {filters.spam && (
                  <Check
                    className="ml-auto size-4 text-primary"
                    strokeWidth={1.75}
                  />
                )}
              </CommandItem>
              <CommandItem
                value="snoozed"
                keywords={[
                  t("inbox.chipSnoozed"),
                  "snoozed",
                  "snooze",
                  "later",
                  "deferred",
                ]}
                onSelect={() =>
                  set("snoozed", filters.snoozed ? undefined : true)
                }
              >
                <span>{t("inbox.chipSnoozed")}</span>
                {filters.snoozed && (
                  <Check
                    className="ml-auto size-4 text-primary"
                    strokeWidth={1.75}
                  />
                )}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
