"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { useContacts } from "@/lib/api/contacts";
import { flattenPages } from "@/lib/api/pagination";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

function SkeletonRows() {
  return (
    <div className="space-y-2 p-4" aria-label="Loading contacts">
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
}: {
  /** Rendered inside the brand-new empty state (e.g. the import button). */
  emptyAction?: React.ReactNode;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const contacts = useContacts(query);
  const rows = flattenPages(contacts.data);
  const searching = query.trim() !== "";

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
          placeholder="Search name or number"
          aria-label="Search contacts"
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border bg-card">
        {contacts.isPending ? (
          <SkeletonRows />
        ) : contacts.isError ? (
          <div className="p-4">
            <LoadError onRetry={() => contacts.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-3 px-4 py-10 text-center">
            {searching ? (
              <p className="text-sm text-muted-foreground">
                No matches for &quot;{query.trim()}&quot;.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No contacts yet — they&apos;re added automatically when a
                  customer texts you.
                </p>
                {emptyAction && (
                  <div className="flex justify-center">{emptyAction}</div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead className="text-right">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contact) => (
                  <TableRow
                    key={contact.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${contactDisplayName(contact)}`}
                    className="cursor-pointer"
                    onClick={() => router.push(`/contacts/${contact.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/contacts/${contact.id}`);
                      }
                    }}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {contactDisplayName(contact)}
                        {contact.opted_out && (
                          // G6 opted-out badge — same treatment as the
                          // contact detail header.
                          <Badge className="border-transparent bg-destructive/10 text-destructive">
                            Opted out
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
                          fresh text (G10). */}
                      {contact.last_activity_at ? (
                        <span
                          title={formatAbsoluteDateTime(
                            contact.last_activity_at,
                          )}
                        >
                          {formatRelativeTime(contact.last_activity_at)}
                        </span>
                      ) : (
                        <>
                          <span aria-hidden>—</span>
                          <span className="sr-only">No texting activity yet</span>
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
                  {contacts.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
