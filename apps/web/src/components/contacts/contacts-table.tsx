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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  contactDetailOptions,
  useContacts,
  type ContactFieldFilter,
} from "@/lib/api/contacts";
import type { ContactListItem } from "@/lib/api/types";
import { ContactActiveFilters, ContactListFilter } from "@/components/contacts/contact-filter";
import { ContactsBulkBar } from "@/components/contacts/contacts-bulk-bar";
import { useContactActions } from "@/components/contacts/contact-record-actions";
import { RecordContextMenu } from "@/components/ui/record-menu";
import { useT } from "@/i18n/provider";
import { useActiveCompany, useCompanyId } from "@/lib/company/provider";
import { flattenPages } from "@/lib/api/pagination";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";
import { SearchField } from "@/components/ui/search-field";
import { updateSearch } from "@/lib/url/search-state";

const SEARCH_DEBOUNCE_MS = 250;
const HOVER_PREFETCH_MS = 100;

/** The list's view lives in the URL, so Back from a contact returns to the same search and filters. */
export function contactsViewFromSearch(params: URLSearchParams): {
  query: string;
  tagId: string | undefined;
  field: ContactFieldFilter | undefined;
} {
  const fieldKey = params.get("field");
  return {
    query: params.get("q") ?? "",
    tagId: params.get("tag") ?? undefined,
    // "" is a real answer on a custom field, so a missing value means "".
    field: fieldKey ? { key: fieldKey, value: params.get("value") ?? "" } : undefined,
  };
}

function writeQuery(query: string) {
  updateSearch((params) => {
    if (query === "") params.delete("q");
    else params.set("q", query);
  });
}

function writeTag(tagId: string | undefined) {
  updateSearch((params) => {
    if (tagId === undefined) params.delete("tag");
    else params.set("tag", tagId);
  });
}

function writeField(field: ContactFieldFilter | undefined) {
  updateSearch((params) => {
    if (field === undefined) {
      params.delete("field");
      params.delete("value");
    } else {
      params.set("field", field.key);
      params.set("value", field.value);
    }
  });
}

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
      containerClassName="min-w-0 max-w-sm flex-1"
      value={input}
      onValueChange={setInput}
      placeholder={t("contacts.searchPlaceholder")}
      aria-label={t("contacts.searchLabel")}
    />
  );
}

const ContactRow = memo(function ContactRow({
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
    void queryClient.prefetchQuery(contactDetailOptions(companyId, contact.id));
  }
  function cancelHover() {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }
  useEffect(() => cancelHover, []);

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
        <TableCell className="font-medium">
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
        </TableCell>
        <TableCell className="tabular-nums text-muted-foreground">
          {formatPhone(contact.phone_e164)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {/* Conversation activity (G6), never updated_at — a
              CSV re-import or notes edit must not read as a
              fresh text (G10). Timestamps recede to the muted
              colour: tertiary fails contrast on card. */}
          {contact.last_activity_at ? (
            <Timestamp at={contact.last_activity_at} style="short" />
          ) : (
            <>
              <span aria-hidden>–</span>
              <span className="sr-only">
                {t("contacts.noTextingActivity")}
              </span>
            </>
          )}
        </TableCell>
      </TableRow>
    </ContactRowMenu>
  );
});

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
  const { query, tagId: tagFilter, field: fieldFilter } =
    contactsViewFromSearch(searchParams);

  // #695: select rows to act on together.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const contacts = useContacts(query, { field: fieldFilter, tagId: tagFilter });
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ContactSearch query={query} onSettle={writeQuery} />
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

      <div className="rounded-lg border bg-card">
        {contacts.isPending ? (
          <SkeletonRows />
        ) : contacts.isError ? (
          <div className="p-4">
            <LoadError onRetry={() => contacts.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          searching ? (
            <EmptyState
              title={t("contacts.noMatchesFor", { query: query.trim() })}
              description={t("contacts.noMatchesDetail")}
            />
          ) : tagFilter !== undefined ? (
            <EmptyState
              title={t("contacts.tagFilteredEmptyTitle")}
              description={t("contacts.tagFilteredEmptyDetail")}
            />
          ) : filtering ? (
            // #291: NOT the brand-new empty state. "Your customers show up
            // here on their own" under an active filter reads as "you have no
            // customers", which is alarming and wrong — they are excluded, not
            // missing.
            <EmptyState
              title={t("contacts.filteredEmptyTitle")}
              description={t("contacts.filteredEmptyDetail")}
            />
          ) : (
            // The §5 kind empty state (delight moment #2): one warm line, one
            // action, generous air — never a generic "No data".
            <EmptyState
              icon={<Users strokeWidth={1.5} aria-hidden />}
              title={t("contacts.emptyTitle")}
              description={t("contacts.emptyDetail")}
              action={emptyAction ?? undefined}
            />
          )
        ) : (
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
                          : selectedRows.length > 0
                            ? "indeterminate"
                            : false
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
                  <TableHead>{t("contacts.fieldNumber")}</TableHead>
                  <TableHead className="text-right">
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
        )}
      </div>
    </div>
  );
}
