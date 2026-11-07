"use client";

import { Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CalmEmptyState } from "@/components/settings/empty-state";
import { LoadError } from "@/components/settings/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ContactFilter } from "@/components/contacts/contact-filter";
import { useT } from "@/i18n/provider";
import { flattenPages } from "@/lib/api/pagination";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

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
}: {
  /** Rendered inside the brand-new empty state (e.g. the import button). */
  emptyAction?: React.ReactNode;
  /**
   * Lifts the debounced search query so the toolbar's CSV export can mirror
   * "what I'm looking at" (D20 §3.1) — the table stays the owner of the input.
   */
  onQueryChange?: (query: string) => void;
}) {
  const t = useT();
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

  const contacts = useContacts(query, { field: fieldFilter });
  const rows = flattenPages(contacts.data);
  const searching = query.trim() !== "";
  const filtering = fieldFilter !== undefined;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
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

      {/* #291: beside the search box, because both answer "show me less".
          Absent entirely unless the workspace defined a field with a closed
          set of answers, so most lists look exactly as they did. */}
      <ContactFilter value={fieldFilter} onChange={setFieldFilter} />

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("contacts.fieldName")}</TableHead>
                  <TableHead>{t("contacts.fieldNumber")}</TableHead>
                  <TableHead className="text-right">
                    {t("contacts.fieldLastActivity")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contact) => (
                  <TableRow
                    key={contact.id}
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
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
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
                        <span
                          title={formatAbsoluteDateTime(
                            contact.last_activity_at,
                            undefined,
                            t.locale,
                          )}
                        >
                          {formatRelativeTime(contact.last_activity_at, undefined, t)}
                        </span>
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
