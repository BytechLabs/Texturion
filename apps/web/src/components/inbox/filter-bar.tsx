"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import {
  applySegment,
  hasActiveFilters,
  INBOX_SEGMENTS,
  segmentOf,
  type InboxUrlFilters,
} from "./filter-url";

const NONE = "__none__";

/**
 * G4 filter bar: search (debounced 250ms → URL `q`), segmented
 * "Open | Mine | All | Closed", overflow sheet (status, assignee, tag,
 * unread, spam chip). URL is the state (G3/G12) — this component only calls
 * `onChange` with the next filter object.
 */
export function FilterBar({
  filters,
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
  const segment = segmentOf(filters);
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

  const sheetFilterCount = [
    filters.tag,
    filters.unread,
    filters.spam,
    filters.assignee && filters.assignee !== "me" ? filters.assignee : undefined,
    filters.status && filters.status !== "open" && filters.status !== "closed"
      ? filters.status
      : undefined,
  ].filter(Boolean).length;

  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
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
            className="h-9 pl-8"
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
        <FilterSheet filters={filters} onChange={onChange} count={sheetFilterCount} />
      </div>
      <div
        role="group"
        aria-label="Conversation filters"
        className="flex rounded-lg bg-muted p-0.5"
      >
        {INBOX_SEGMENTS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={segment === id}
            onClick={() => onChange(applySegment(filters, id))}
            className={cn(
              // min-h-11 below md: the G11 ≥44px mobile hit-target bar.
              "min-h-11 flex-1 rounded-md px-2 py-1 text-[13px] font-medium transition-colors duration-150 ease-out md:min-h-0",
              segment === id
                ? "bg-card text-primary shadow-none"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {hasActiveFilters(filters) && sheetFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <ActiveChips filters={filters} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className="tap-target rounded-full p-0.5 hover:bg-background"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

function ActiveChips({
  filters,
  onChange,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
}) {
  const tags = useTags();
  const members = useMembers();
  const drop = (key: keyof InboxUrlFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  return (
    <>
      {filters.status && filters.status !== "open" && filters.status !== "closed" && (
        <Chip
          label={filters.status === "new" ? "New" : "Waiting"}
          onRemove={() => drop("status")}
        />
      )}
      {filters.assignee && filters.assignee !== "me" && (
        <Chip
          label={
            members.data?.data.find((m) => m.user_id === filters.assignee)
              ?.display_name || "Assignee"
          }
          onRemove={() => drop("assignee")}
        />
      )}
      {filters.tag && (
        <Chip
          label={
            tags.data?.data.find((t) => t.id === filters.tag)?.name ?? "Tag"
          }
          onRemove={() => drop("tag")}
        />
      )}
      {filters.unread && <Chip label="Unread" onRemove={() => drop("unread")} />}
      {filters.spam && <Chip label="Spam" onRemove={() => drop("spam")} />}
    </>
  );
}

/** Overflow filter sheet (G4): status, assignee, tag, unread + the spam chip. */
function FilterSheet({
  filters,
  onChange,
  count,
}: {
  filters: InboxUrlFilters;
  onChange: (next: InboxUrlFilters) => void;
  count: number;
}) {
  const tags = useTags();
  const members = useMembers();
  const { userId } = useActiveCompany();
  const [open, setOpen] = useState(false);

  const set = <K extends keyof InboxUrlFilters>(
    key: K,
    value: InboxUrlFilters[K] | undefined,
  ) => {
    const next = { ...filters };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const activeMembers = (members.data?.data ?? []).filter(
    (m) => m.deactivated_at === null,
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Filters${count > 0 ? ` (${count} active)` : ""}`}
          className="relative shrink-0"
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:max-w-[300px]">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the conversation list.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="space-y-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select
              value={filters.status ?? NONE}
              onValueChange={(v) =>
                set(
                  "status",
                  v === NONE ? undefined : (v as InboxUrlFilters["status"]),
                )
              }
            >
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any status</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-assignee">Assignee</Label>
            <Select
              value={filters.assignee ?? NONE}
              onValueChange={(v) => set("assignee", v === NONE ? undefined : v)}
            >
              <SelectTrigger id="filter-assignee" className="w-full">
                <SelectValue placeholder="Anyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Anyone</SelectItem>
                {activeMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name || "Teammate"}
                    {m.user_id === userId ? " (you)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-tag">Tag</Label>
            <Select
              value={filters.tag ?? NONE}
              onValueChange={(v) => set("tag", v === NONE ? undefined : v)}
            >
              <SelectTrigger id="filter-tag" className="w-full">
                <SelectValue placeholder="Any tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any tag</SelectItem>
                {(tags.data?.data ?? []).map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="filter-unread"
              checked={filters.unread === true}
              onCheckedChange={(checked) =>
                set("unread", checked === true ? true : undefined)
              }
            />
            <Label htmlFor="filter-unread" className="font-normal">
              Unread only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="filter-spam"
              checked={filters.spam === true}
              onCheckedChange={(checked) =>
                set("spam", checked === true ? true : undefined)
              }
            />
            <Label htmlFor="filter-spam" className="font-normal">
              Show spam
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              onChange({});
              setOpen(false);
            }}
          >
            Clear all filters
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
