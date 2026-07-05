"use client";

import { Check, ListFilter, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useConversations } from "@/lib/api/conversations";
import { flattenPages } from "@/lib/api/pagination";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import {
  activeChips,
  applySegment,
  clearSecondary,
  formatOpenCount,
  INBOX_SEGMENTS,
  OPEN_COUNT_CAP,
  OPEN_COUNT_FILTERS,
  segmentOf,
  type InboxUrlFilters,
  type SecondaryFilterKey,
} from "./filter-url";

/**
 * The §2 filter bar. There is **no fly-out drawer** — filtering is one-glance:
 *
 *  1. a debounced search field (→ URL `q`, drives the /v1/search view);
 *  2. persistent segmented status tabs (Open | Mine | All | Closed) with a
 *     single quiet stone count on **Open** only (§2.1);
 *  3. always-visible removable chips for the secondary dimensions (§2.2); and
 *  4. a compact `+ Filter` cmdk popover that adds a chip + URL param (§2.3).
 *
 * URL is the state (§2) — this component only calls `onChange` with the next
 * filter object; the parent writes it to the URL.
 */
export function FilterBar({
  filters,
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
  const segment = segmentOf(filters);
  const openCount = useOpenCount();

  return (
    <div className="space-y-2 border-b border-app-line px-3.5 pb-2.5 pt-3">
      <SearchField filters={filters} onChange={onChange} />
      {/* Elevated segment (mockup .segment): a pill track with the selected tab
          lifted to a white pill. Behavior unchanged — these are the real inbox
          segments (Open/Mine/All/Closed), just crafted. */}
      <div
        role="tablist"
        aria-label="Conversation status"
        className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px] dark:bg-white/5"
      >
        {INBOX_SEGMENTS.map(({ id, label }) => {
          const selected = segment === id;
          const countLabel =
            id === "open" ? formatOpenCount(openCount) : "";
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(applySegment(filters, id))}
              className={cn(
                // min-h-11 below md: the ≥44px mobile hit-target bar (§7).
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-[color,background] duration-150 ease-out md:min-h-[28px]",
                selected
                  ? "bg-app-white font-semibold text-app-ink"
                  : "font-medium text-app-muted hover:text-app-ink",
              )}
            >
              {label}
              {countLabel !== "" && (
                // One quiet petrol count on Open only, shown when > 0, capped 9+.
                <span
                  className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10.5px] font-bold tabular-nums text-white"
                  aria-label={`${openCount > OPEN_COUNT_CAP ? `over ${OPEN_COUNT_CAP}` : openCount} open`}
                >
                  {countLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ChipRow filters={filters} onChange={onChange} />
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

/** Debounced search (§2.4): 250ms → URL `q`; ≥2 chars swaps the list for /v1/search. */
function SearchField({
  filters,
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
  const [searchText, setSearchText] = useState(filters.q ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
      />
      <Input
        type="search"
        value={searchText}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search conversations"
        aria-label="Search conversations and contacts"
        className="h-9 pl-8 pr-8"
      />
      {searchText !== "" && (
        <button
          type="button"
          onClick={() => setSearch("")}
          aria-label="Clear search"
          className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
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
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
  const chips = activeChips(filters);
  const tags = useTags();
  const members = useMembers();

  const labelFor = (key: SecondaryFilterKey, value?: string): string => {
    switch (key) {
      case "assignee":
        return (
          members.data?.data.find((m) => m.user_id === value)?.display_name ||
          "Assignee"
        );
      case "tag":
        return tags.data?.data.find((t) => t.id === value)?.name ?? "Tag";
      case "unread":
        return "Unread";
      case "spam":
        return "Spam";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          label={labelFor(chip.key, chip.value)}
          onRemove={() => onChange(clearSecondary(filters, chip.key))}
        />
      ))}
      <FilterPopover filters={filters} onChange={onChange} />
    </div>
  );
}

/** §2.2 removable stone-tinted chip — same tokens as the status pills, not petrol. */
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-medium text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="tap-target rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
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
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add filter"
          className="tap-target inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground"
        >
          <ListFilter className="size-3" strokeWidth={1.75} aria-hidden />
          Filter
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
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
          <CommandInput placeholder="Filter by…" />
          <CommandList>
            <CommandEmpty>No filters.</CommandEmpty>
            <CommandGroup heading="Assignee">
              {assignableMembers.map((m) => {
                const active = filters.assignee === m.user_id;
                return (
                  <CommandItem
                    key={m.user_id}
                    value={`assignee-${m.user_id}`}
                    keywords={[m.display_name || "teammate"]}
                    onSelect={() =>
                      set("assignee", active ? undefined : m.user_id)
                    }
                  >
                    <span className="truncate">
                      {m.display_name || "Teammate"}
                      {m.user_id === userId ? " (you)" : ""}
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
            {availableTags.length > 0 && (
              <CommandGroup heading="Tag">
                {availableTags.map((tag) => {
                  const active = filters.tag === tag.id;
                  return (
                    <CommandItem
                      key={tag.id}
                      value={`tag-${tag.id}`}
                      keywords={[tag.name]}
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
            <CommandGroup heading="More">
              <CommandItem
                value="unread"
                keywords={["unread"]}
                onSelect={() =>
                  set("unread", filters.unread ? undefined : true)
                }
              >
                <span>Unread</span>
                {filters.unread && (
                  <Check
                    className="ml-auto size-4 text-primary"
                    strokeWidth={1.75}
                  />
                )}
              </CommandItem>
              <CommandItem
                value="spam"
                keywords={["spam"]}
                onSelect={() => set("spam", filters.spam ? undefined : true)}
              >
                <span>Spam</span>
                {filters.spam && (
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
