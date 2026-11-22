"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { roleHasCapability } from "@loonext/shared";

import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactDetailOptions, useContacts } from '@/lib/api/contacts';
import type { ContactSort } from '@/lib/api/contacts';
import type { ContactListItem } from "@/lib/api/types";
import { ContactActiveFilters, ContactListFilter } from "@/components/contacts/contact-filter";
import { ContactsBulkBar } from "@/components/contacts/contacts-bulk-bar";
import { useContactActions } from "@/components/contacts/contact-record-actions";
import { RecordContextMenu } from "@/components/ui/record-menu";
import { useT } from "@/i18n/provider";
import { useActiveCompany, useCompanyId } from "@/lib/company/provider";
import { flattenPages } from "@/lib/api/pagination";
import { contactDisplayName } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";
import { SearchField } from "@/components/ui/search-field";
import { ResultsStatus } from "@/components/ui/results-status";
import { SimpleSelect } from "@/components/ui/simple-select";
import { contactsViewFromSearch, writeField, writeQuery, writeSort, writeTag } from "@/lib/url/contact-list-url";

const SEARCH_DEBOUNCE_MS = 250;
const HOVER_PREFETCH_MS = 100;

/**
 * #712: right-click, long-press or the menu key on a contact row opens the
 * contact's one action list (the same one the contact page's ⋯ opens).
 */
function ContactRowMenu({
  contact,
  children,
}: {
  contact: Parameters<typeof useContactActions>[0]["contact"];
  children: React.ReactElement;
}) {
  const { actions, dialogs } = useContactActions({
    contact,
    openHref: `/contacts/${contact.id}`,
  });
  return (
    <>
      <RecordContextMenu actions={actions}>{children}</RecordContextMenu>
      {dialogs}
    </>
  );
}

function SkeletonRows() {
  const t = useT();
  return (
    <ListSkeleton
      rows={6}
      label={t("contacts.loadingContacts")}
      className="p-4"
    />
  );
}

/** Owns the typed text, so a keystroke re-renders the box and not the table. */
function ContactSearch({
  query,
  onSettle,
}: {
  query: string;
  onSettle: (query: string) => void;
}) {
  const t = useT();
  const [input, setInput] = useState(query);
  const written = useRef(query);
  const [seen, setSeen] = useState(query);
  // A URL this box did not write, such as the nav link to plain /contacts, replaces the text.
  if (query !== seen) {
    setSeen(query);
    if (query !== written.current) setInput(query);
  }
  useEffect(() => {
    const handle = setTimeout(() => {
      written.current = input.trim();
      onSettle(written.current);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input, onSettle]);
  return (
    <SearchField
      containerClassName="min-w-0 basis-full sm:max-w-sm sm:flex-1"
      value={input}
      onValueChange={setInput}
      placeholder={t("contacts.searchPlaceholder")}
      aria-label={t("contacts.searchLabel")}
    />
  );
}

const ContactRow = memo(ContactRowView);

function ContactRowView({
  contact,
  selected,
  onToggle,
}: {
  contact: ContactListItem;
  selected: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const companyId = useCompanyId();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const href = `/contacts/${contact.id}`;

  // Starts the detail read before the route lands, so the page opens on it.
  function prefetch() {
    void queryClient.query(contactDetailOptions(companyId, contact.id)).catch(() => undefined);
  }
  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  useEffect(() => cancelHover, [cancelHover]);

  // A CSV import or note edit does not count as conversation activity.
  const activity = contact.last_activity_at ? (
    <Timestamp at={contact.last_activity_at} style="short" />
  ) : (
    <>
      <span aria-hidden>–</span>
      <span className="sr-only">{t("contacts.noTextingActivity")}</span>
    </>
  );

  return (
    <ContactRowMenu contact={contact}>
      <TableRow
        className="cursor-pointer"
        onFocus={prefetch}
        onTouchStart={prefetch}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          cancelHover();
          hoverTimer.current = setTimeout(prefetch, HOVER_PREFETCH_MS);
        }}
        onPointerLeave={cancelHover}
        // Mouse convenience only. Keyboard and screen reader users get the
        // real link in the name cell, so the row itself stays a plain table row.
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            target.closest("button")
          ) {
            return;
          }
          prefetch();
          // The name link navigates by itself and prevents the default.
          if (event.defaultPrevented || target.closest("a")) return;
          router.push(href);
        }}
      >
        <TableCell className="w-10">
          <Checkbox
            aria-label={t("contacts.selectContact", {
              name: contactDisplayName(contact, t),
            })}
            checked={selected}
            onCheckedChange={(on) => onToggle(contact.id, on === true)}
          />
        </TableCell>
        <TableCell className="font-medium whitespace-normal">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {contactDisplayName(contact)}
            </Link>
            {contact.opted_out && (
              // G6 opted-out badge — same treatment as the
              // contact detail header.
              <Badge variant="outline" className="border-destructive text-foreground">
                {t("contacts.optedOut")}
              </Badge>
            )}
            {/* #695: the tags this customer carries, quietly -
                three at most, so a heavily tagged row does not
                outgrow its neighbours. */}
            {(contact.tags ?? []).slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
              >
                {tag.name}
              </span>
            ))}
            {(contact.tags ?? []).length > 3 && (
              <span className="text-[11px] text-muted-foreground">
                +{(contact.tags ?? []).length - 3}
              </span>
            )}
          </span>
          {contact.business_name && (
            <div className="text-xs text-muted-foreground">{contact.business_name}</div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs font-normal tabular-nums text-muted-foreground md:hidden">
            <CopyablePhoneNumber number={contact.phone_e164} />
            <span className="ml-auto">
              <span className="sr-only">{t("contacts.fieldLastActivity")} </span>
              {activity}
            </span>
          </div>
        </TableCell>
        <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
          <CopyablePhoneNumber number={contact.phone_e164} />
        </TableCell>
        <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
          {activity}
        </TableCell>
      </TableRow>
    </ContactRowMenu>
  );
}

/**
 * The G6 contacts table: trgm search (debounced 250ms), name / number /
 * last activity / opted-out badge, cursor pagination. Rows open the
 * contact detail page.
 */
export function ContactsTable({
  emptyAction,
}: {
  /** Rendered inside the brand-new empty state (e.g. the import button). */
  emptyAction?: React.ReactNode;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const canEdit = roleHasCapability(role, "conversations.note");
  const canMerge = roleHasCapability(role, "settings.manage");
  // #291 / #695: the search, the tag and the one-field answer, from the URL.
  const searchParams = useSearchParams();
  const { query, tagId: tagFilter, field: fieldFilter, sort } =
    contactsViewFromSearch(searchParams);

  // #695: select rows to act on together.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const contacts = useContacts(query, { field: fieldFilter, tagId: tagFilter, sort });
  const rows = useMemo(() => flattenPages(contacts.data), [contacts.data]);
  const searching = query.trim() !== "";
  const filtering = fieldFilter !== undefined;

  // The selection is only ever rows still on screen: a delete, a merge or a
  // new filter drops the ones that left, so the bar never counts a ghost.
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const toggleRow = useCallback((id: string, on: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  let tableBody;
  if (contacts.isPending) {
    tableBody = <SkeletonRows />;
  } else if (contacts.isError) {
    tableBody = (
      <div className="p-4">
        <LoadError onRetry={() => void contacts.refetch()} />
      </div>
    );
  } else if (rows.length === 0) {
    if (searching) {
      tableBody = (
        <EmptyState
          title={t("contacts.noMatchesFor", { query: query.trim() })}
          description={t("contacts.noMatchesDetail")}
        />
      );
    } else if (tagFilter !== undefined) {
      tableBody = (
        <EmptyState
          title={t("contacts.tagFilteredEmptyTitle")}
          description={t("contacts.tagFilteredEmptyDetail")}
        />
      );
    } else if (filtering) {
      tableBody = (
        <EmptyState
          title={t("contacts.filteredEmptyTitle")}
          description={t("contacts.filteredEmptyDetail")}
        />
      );
    } else {
      tableBody = (
        <EmptyState
          icon={<Users strokeWidth={1.5} aria-hidden />}
          title={t("contacts.emptyTitle")}
          description={t("contacts.emptyDetail")}
          action={emptyAction ?? undefined}
        />
      );
    }
  } else {
    tableBody = (
      <>
        {selectedRows.length > 0 && (
          <ContactsBulkBar
            selected={selectedRows}
            canEdit={canEdit}
            canMerge={canMerge}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t("contacts.selectAllOnPage")}
                  checked={
                    allSelected
                      ? true
                      : (selectedRows.length > 0
                        ? "indeterminate"
                        : false)
                  }
                  onCheckedChange={(on) =>
                    setSelectedIds(
                      on === true
                        ? new Set(rows.map((row) => row.id))
                        : new Set(),
                    )
                  }
                />
              </TableHead>
              <TableHead>{t("contacts.fieldName")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("contacts.fieldNumber")}</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                {t("contacts.fieldLastActivity")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                selected={selectedIds.has(contact.id)}
                onToggle={toggleRow}
              />
            ))}
          </TableBody>
        </Table>
        {contacts.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={contacts.isFetchingNextPage}
              onClick={() => void contacts.fetchNextPage()}
            >
              {contacts.isFetchingNextPage
                ? t("contacts.loading")
                : t("contacts.loadMore")}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <ContactSearch query={query} onSettle={writeQuery} />
        <SimpleSelect
          ariaLabel={t("contacts.sort")}
          className="w-auto"
          value={sort}
          onValueChange={(value) => writeSort(value as ContactSort)}
          options={[
            { value: "name", label: t("contacts.sortName") },
            { value: "recent", label: t("contacts.sortRecent") },
            { value: "added", label: t("contacts.sortAdded") },
          ]}
        />
        {/* #291 / #711: beside the search box, because both answer "show me
            less", behind the same Filter button every list uses. */}
        <ContactListFilter
          field={fieldFilter}
          onField={writeField}
          tag={tagFilter}
          onTag={writeTag}
        />
      </div>
      <ContactActiveFilters
        field={fieldFilter}
        onField={writeField}
        tag={tagFilter}
        onTag={writeTag}
      />

      <ResultsStatus
        query={query}
        count={contacts.isSuccess && !contacts.isPlaceholderData ? rows.length : null}
      />
      <div className="rounded-lg border bg-card">
        {tableBody}
      </div>
    </div>
  );
}
