"use client";

/**
 * #205 — call history on the contact detail screen. The same row grammar as
 * /calls (the shared CallRow: direction glyph, outcome pill with the inbound
 * missed tint, inline voicemail playback, tap-through to the conversation),
 * scoped to one contact by the server (GET /v1/calls?contact_id=…, which
 * composes the #106 number-access deny list with the contact filter — never
 * filtered client-side). Newest-first from the API's (started_at, id) keyset;
 * folded into contiguous day groups with the gallery's date-label vocabulary.
 */
import { PhoneIncoming } from "lucide-react";
import { Fragment } from "react";

import { CallRow } from "@/components/calls/call-row";
import { CalmEmptyState } from "@/components/settings/empty-state";
import { dateGroupLabel } from "@/components/thread/gallery-grouping";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContactCalls } from "@/lib/api/calls";
import { flattenPages } from "@/lib/api/pagination";
import type { Call } from "@/lib/api/types";

export interface CallDayGroup {
  label: string;
  calls: Call[];
}

/**
 * Fold an already DESC-sorted call list into contiguous day groups ("Today",
 * "Yesterday", "July 2"). Never re-sorts — the API owns the (started_at, id)
 * order, same rule as the gallery's groupByDate.
 */
export function groupCallsByDay(
  calls: Call[],
  now: Date = new Date(),
): CallDayGroup[] {
  const groups: CallDayGroup[] = [];
  for (const call of calls) {
    const label = dateGroupLabel(call.started_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.calls.push(call);
    } else {
      groups.push({ label, calls: [call] });
    }
  }
  return groups;
}

export function ContactCallHistory({ contactId }: { contactId: string }) {
  const calls = useContactCalls(contactId);
  const rows = flattenPages(calls.data);
  const groups = groupCallsByDay(rows);

  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        Call history
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
        {calls.isPending ? (
          <div className="space-y-0" aria-label="Loading call history">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0"
              >
                <Skeleton className="size-[38px] rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : calls.isError ? (
          <CalmEmptyState
            className="py-10"
            icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
            title="Couldn't load their calls."
            description="Check your connection and try again."
            action={
              <Button variant="outline" onClick={() => calls.refetch()}>
                Try again
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <CalmEmptyState
            className="py-10"
            icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
            title="No calls with this contact yet."
            description="Calls between you and this customer will show up here."
          />
        ) : (
          groups.map((group) => (
            <Fragment key={group.label}>
              {/* The day rule — same 11px uppercase rung as the section
                  header, sitting flat in the card so the hairline rhythm of
                  the rows carries through. */}
              <h3 className="border-b border-app-line-soft px-[11px] pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
                {group.label}
              </h3>
              {group.calls.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </Fragment>
          ))
        )}
      </div>
      {calls.hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            onClick={() => calls.fetchNextPage()}
            disabled={calls.isFetchingNextPage}
          >
            {calls.isFetchingNextPage ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </section>
  );
}
