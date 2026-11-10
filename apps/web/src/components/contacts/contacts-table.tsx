"use client";

import { Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { roleHasCapability } from "@loonext/shared";

import { CalmEmptyState } from "@/components/settings/empty-state";
import { LoadError } from "@/components/settings/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useContacts,
  type ContactFieldFilter,
} from "@/lib/api/contacts";
import { ContactActiveFilters, ContactListFilter } from "@/components/contacts/contact-filter";
import { ContactsBulkBar } from "@/components/contacts/contacts-bulk-bar";
import { useContactActions } from "@/components/contacts/contact-record-actions";
import { RecordContextMenu } from "@/components/ui/record-menu";
import { useT } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";
import { flattenPages } from "@/lib/api/pagination";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";

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
    <div className="space-y-2 p-4" aria-label={t("contacts.loadingContacts")}>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * The G6 contacts table: trgm search (debounced 250ms), name / number /
 * last activity / opted-out badge, cursor pagination. Rows open the
 * contact detail page.
 */
export function ContactsTable({
  emptyAction,
  onQueryChange,
  onTagFilterChange,
}: {
  /** Rendered inside the brand-new empty state (e.g. the import button). */
  emptyAction?: React.ReactNode;
  /**
   * Lifts the debounced search query so the toolbar's CSV export can mirror
   * "what I'm looking at" (D20 §3.1) — the table stays the owner of the input.
   */
  onQueryChange?: (query: string) => void;
  /** #695: lifts the tag filter too, so the toolbar export mirrors the view. */
  onTagFilterChange?: (tagId: string | undefined) => void;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const canEdit = roleHasCapability(role, "conversations.note");
  const canMerge = roleHasCapability(role, "settings.manage");
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  // #291: narrow to one answer in one of the workspace's own fields.
  const [fieldFilter, setFieldFilter] = useState<
    ContactFieldFilter | undefined
  >(undefined);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  // #695: narrow to one tag, and select rows to act on together.
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    onTagFilterChange?.(tagFilter);
  }, [tagFilter, onTagFilterChange]);

  const contacts = useContacts(query, { field: fieldFilter, tagId: tagFilter });
  const rows = flattenPages(contacts.data);
  const searching = query.trim() !== "";
  const filtering = fieldFilter !== undefined;

  // The selection is only ever rows still on screen: a delete, a merge or a
  // new filter drops the ones that left, so the bar never counts a ghost.
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  function toggleRow(id: string, on: boolean) {
    const next = new Set(selectedIds);
    if (on) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("contacts.searchPlaceholder")}
            aria-label={t("contacts.searchLabel")}
            className="pl-9"
          />
        </div>
        {/* #291 / #711: beside the search box, because both answer "show me
            less", behind the same Filter button every list uses. */}
        <ContactListFilter
          field={fieldFilter}
          onField={setFieldFilter}
          tag={tagFilter}
          onTag={setTagFilter}
        />
      </div>
      <ContactActiveFilters
        field={fieldFilter}
        onField={setFieldFilter}
        tag={tagFilter}
        onTag={setTagFilter}
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
            <CalmEmptyState
              title={t("contacts.noMatchesFor", { query: query.trim() })}
              description={t("contacts.noMatchesDetail")}
            />
          ) : tagFilter !== undefined ? (
            <CalmEmptyState
              title={t("contacts.tagFilteredEmptyTitle")}
              description={t("contacts.tagFilteredEmptyDetail")}
            />
          ) : filtering ? (
            // #291: NOT the brand-new empty state. "Your customers show up
            // here on their own" under an active filter reads as "you have no
            // customers", which is alarming and wrong — they are excluded, not
            // missing.
            <CalmEmptyState
              title={t("contacts.filteredEmptyTitle")}
              description={t("contacts.filteredEmptyDetail")}
            />
          ) : (
            // The §5 kind empty state (delight moment #2): one warm line, one
            // action, generous air — never a generic "No data".
            <CalmEmptyState
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
                  <ContactRowMenu key={contact.id} contact={contact}>
                  <TableRow
                    className="cursor-pointer"
                    // Mouse convenience only. Keyboard and screen reader users
                    // get the real link in the name cell, so the row itself
                    // stays a plain table row.
                    onClick={(event) => {
                      if (
                        event.defaultPrevented ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey ||
                        (event.target as HTMLElement).closest("a,button")
                      ) {
                        return;
                      }
                      router.push(`/contacts/${contact.id}`);
                    }}
                  >
                    <TableCell className="w-10">
                      <Checkbox
                        aria-label={t("contacts.selectContact", {
                          name: contactDisplayName(contact, t),
                        })}
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={(on) => toggleRow(contact.id, on === true)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/contacts/${contact.id}`}
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
